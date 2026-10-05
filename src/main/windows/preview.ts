import { app, BrowserWindow, session } from 'electron'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'
import type { Post } from '@shared/types'
import { loadAppIcon } from './icon'

let previewWindow: BrowserWindow | null = null
let activeWorker: Worker | null = null
let request = 0
let networkBlocked = false

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!))
}

function previewPage(post: Post, content: string): string {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; media-src data:; object-src 'self'; frame-src 'self' chrome-extension:; style-src 'unsafe-inline'; connect-src 'none'">
  <title>${escapeHtml(post.title)} · PasteMan</title><style>
  :root{color-scheme:light dark}*{box-sizing:border-box}body{margin:0;font:15px/1.65 system-ui;background:Canvas;color:CanvasText}
  header{padding:14px 22px;border-bottom:1px solid #8884;position:sticky;top:0;background:Canvas;z-index:2}header strong{display:block;font-size:16px;overflow-wrap:anywhere}header small{display:block;color:GrayText;overflow-wrap:anywhere}
  main{padding:20px 22px}pre{white-space:pre-wrap;overflow-wrap:anywhere;margin:0;font:14px/1.7 Consolas,monospace}img{display:block;max-width:100%;max-height:calc(100vh - 140px);object-fit:contain;margin:auto}embed{width:100%;height:calc(100vh - 135px)}video{width:100%;max-height:calc(100vh - 140px)}audio{width:100%}
  ul{list-style:none;padding:0;margin:0}li{padding:9px 0;border-bottom:1px solid #8883}li span{display:inline-block;width:70px;color:GrayText}h2{font-size:16px}section{padding-bottom:15px;border-bottom:1px solid #8883}.table-wrap{overflow:auto}table{border-collapse:collapse}td{border:1px solid #8884;padding:7px 12px;min-width:100px;white-space:pre-wrap;vertical-align:top}.notice{color:GrayText;padding:12px 0}
  </style></head><body><header><strong>${escapeHtml(post.title)}</strong><small>${escapeHtml(post.type === 'file' || post.type === 'folder' ? post.contentPath ?? '' : '')}</small></header><main>${content}</main></body></html>`
}

function readInWorker(post: Post, directory: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const workerPath = app.isPackaged
      ? join(process.resourcesPath, 'app.asar.unpacked/out/main/preview-worker.js')
      : join(__dirname, 'preview-worker.js')
    const worker = new Worker(workerPath, { workerData: { post, directory } })
    activeWorker = worker
    const timer = setTimeout(() => {
      void worker.terminate().catch(error => console.error('[pasteman] 预览任务终止失败', error))
      reject(new Error('预览读取超时'))
    }, 15_000)
    worker.once('message', (content: unknown) => {
      clearTimeout(timer)
      if (typeof content === 'string') resolve(content)
      else reject(new Error('预览内容无效'))
    })
    worker.once('error', error => { clearTimeout(timer); reject(error) })
    worker.once('exit', () => {
      clearTimeout(timer)
      if (activeWorker === worker) activeWorker = null
      reject(new Error('预览任务已结束'))
    })
  })
}

function createPreviewWindow(directory: string): BrowserWindow {
  const previewSession = session.fromPartition('pasteman-preview')
  if (!networkBlocked) {
    previewSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, done) => done({ cancel: true }))
    previewSession.setPermissionRequestHandler((_contents, _permission, done) => done(false))
    networkBlocked = true
  }
  const win = new BrowserWindow({ width: 880, height: 650, minWidth: 420, minHeight: 320,
    title: 'PasteMan 预览', icon: loadAppIcon(), autoHideMenuBar: true, show: true,
    webPreferences: { session: previewSession, nodeIntegration: false, contextIsolation: true, sandbox: true, plugins: true },
  })
  win.webContents.on('did-fail-load', (_event, code, description) => {
    console.error('[pasteman] 预览页面加载失败', code, description)
  })
  win.webContents.on('before-input-event', (_event, input) => { if (input.type === 'keyDown' && input.key === 'Escape') win.close() })
  win.on('closed', () => {
    if (previewWindow === win) {
      request++
      previewWindow = null
      if (activeWorker) void activeWorker.terminate().catch(error => console.error('[pasteman] 预览任务终止失败', error))
    }
    void rm(directory, { recursive: true, force: true }).catch(error => console.error('[pasteman] 清理预览文件失败', error))
  })
  return win
}

export async function openPostPreview(post: Post): Promise<boolean> {
  try {
    console.log('[pasteman] 打开内容预览', post.id, post.type)
    // 关闭上一个预览后再创建，避免连续点击积累解析任务和临时文件。
    previewWindow?.close()
    previewWindow = null
    if (activeWorker) {
      await activeWorker.terminate()
      activeWorker = null
    }
    const token = ++request
    const directory = await mkdtemp(join(app.getPath('temp'), 'pasteman-preview-'))
    if (token !== request) {
      await rm(directory, { recursive: true, force: true })
      return false
    }
    const win = createPreviewWindow(directory)
    previewWindow = win
    await writeFile(join(directory, 'index.html'), previewPage(post, '<p class="notice">正在读取文件…</p>'), 'utf8')
    await win.loadFile(join(directory, 'index.html'))
    // Windows 隐藏启动会影响首次显示，页面加载后显式显示并聚焦。
    if (token !== request || win.isDestroyed()) return false
    win.center()
    win.show()
    win.focus()
    console.log('[pasteman] 预览窗口已显示', win.isVisible())
    const content = await readInWorker(post, directory)
    if (token !== request || win.isDestroyed()) return false
    await writeFile(join(directory, 'index.html'), previewPage(post, content), 'utf8')
    await win.loadFile(join(directory, 'index.html'))
    console.log('[pasteman] 预览内容加载完成', { id: post.id, type: post.type, visible: win.isVisible() })
    return true
  } catch (error) {
    console.error('[pasteman] 打开预览失败', error)
    return false
  }
}
