import { app, BrowserWindow, dialog, nativeTheme, screen } from 'electron'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import '@main/core/appName'
import { dbPath, ensureDirs, imagesDir } from '@main/core/paths'
import { initFileLogging } from '@main/core/logger'
import { initStore } from '@main/core/store'
import {
  bindShellStore,
  createPanelWindow,
  setLayout,
  showPanel,
  togglePanel,
} from '@main/windows/panel'
import { createSettingsWindow, openSettingsWindow } from '@main/windows/settings'
import { createTray } from '@main/windows/tray'
import { initShortcuts } from '@main/core/shortcuts'
import { initRetention } from '@main/core/retention'
import { applyLaunchAtLogin } from '@main/core/launch'
import { initUpdater } from '@main/core/updater'
import { registerIpcHandlers } from '@main/ipc'
import { startCapture } from '@main/capture'
import { createPasteEngine } from '@main/paste'
import { startBrowserBridge } from '@main/bridge/server'
import { createJevPipeline } from '@main/intelligence/jev'
import { getDecisionBackend } from '@main/intelligence/onnx'
import { createHub } from '@main/intelligence/hub'
import { startWebManager, type WebManagerHandle } from '@main/web/manager'
import { IPC } from '@shared/types'
import type { CaptureEvent, ClipStore, NewPost, Settings } from '@shared/types'

const SMOKE = process.argv.includes('--smoke')

app.disableHardwareAcceleration()
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')

                                                      
for (const stream of [process.stdout, process.stderr]) {
  stream?.on?.('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EPIPE') return
    throw err
  })
}
                                       
process.on('uncaughtException', err => {
  console.error('[clipnest] uncaught exception:', err?.message ?? err)
})
process.on('unhandledRejection', reason => {
  console.error('[clipnest] unhandled rejection:', reason)
})

          
if (!app.requestSingleInstanceLock()) {
  app.quit()
  process.exit(0)
}
app.on('second-instance', () => {
  const w = BrowserWindow.getAllWindows()[0]
  if (w) {
    if (w.isMinimized()) w.restore()
    w.focus()
  }
})

                                          
app.on('web-contents-created', (_e, contents) => {
  contents.on('will-navigate', event => event.preventDefault())
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))
})

let store: ClipStore
let capture: { stop(): void } | null = null
let panelWindow: BrowserWindow | null = null
let browserBridgeStop: (() => void) | null = null
let webManager: WebManagerHandle | null = null

async function bootstrap(): Promise<void> {
  ensureDirs()
  initFileLogging()
  store = initStore()
  bindShellStore(store)
  const settings: Settings = store.getSettings()
  applyLaunchAtLogin(settings.general.launchAtLogin)

                                                     
  const hub = createHub(store)
  hub.refresh()

  const panel = createPanelWindow()
  panelWindow = panel
  createSettingsWindow()
  if (settings.webManager.enabled) {
    webManager = startWebManager({ store, port: settings.webManager.port })
  }
  createTray(panel)

  const paste = createPasteEngine()
  registerIpcHandlers({ store, panel, paste, hub })

                                                   
  if (settings.browser.enabled) {
    browserBridgeStop = startBrowserBridge({
      store,
      panel,
      jev: createJevPipeline(store, hub, getDecisionBackend()),
    }).stop
  }

  initShortcuts(panel, store)
  initRetention(store, settings)
  initUpdater(panel)

                                        
  capture = startCapture(store, (e: CaptureEvent) => {
    if (e.reason === 'created') {
      hub.indexPost(e.post)
      panel.webContents.send(IPC.evtPostCaptured, e)
    } else {
      panel.webContents.send(IPC.evtPostTouched, e.post.id)
    }
  })

  if (SMOKE) {
    console.log('[clipnest] smoke: bootstrap ok')
                                         
    setTimeout(async () => {
      const w = BrowserWindow.getAllWindows().find(x => !x.isDestroyed())
      if (!w) {
        console.error('[clipnest] smoke: no window')
        return
      }
      try {
        const result = await w.webContents.executeJavaScript(`(async () => {
          const b = window.clipnest
          if (!b) return 'no-bridge'
          const v = await b.getVersion()
          const s = await b.querySettings()
          const g = await b.queryGroups()
          const p = await b.queryPosts({ limit: 5 })
          const st = await b.intelligenceStatus()
          const q = await b.intelligenceQuery({ keyword: '邮箱', limit: 3 })
          return 'bridge-ok version=' + v + ' theme=' + s.clipboard.theme + ' groups=' + g.length + ' posts=' + p.items.length + ' tier=' + st.tier + '/' + st.state + ' indexed=' + st.indexed + '/' + st.total + ' semanticHits=' + q.length
        })()`)
        console.log('[clipnest] smoke: renderer check ->', result)
      } catch (e) {
        console.error('[clipnest] smoke: renderer check FAILED', e)
      }
    }, 2500)
    setTimeout(() => {
      console.log('[clipnest] smoke: done')
      app.quit()
    }, 4500)
  }
}

app.whenReady().then(async () => {
                                                  
  if (process.argv.includes('--force-dark')) nativeTheme.themeSource = 'dark'
  await bootstrap()
                          
  if (SMOKE) {
    const panel = panelWindow && !panelWindow.isDestroyed() ? panelWindow : null
    setTimeout(() => {
      if (panel) togglePanel(panel)
    }, 1500)
  }
                                                 
  if (process.argv.includes('--seed-demo') && store && panelWindow) {
    setTimeout(() => {
      const pw = panelWindow
      if (!pw || pw.isDestroyed()) return
      const appPath = app.getAppPath()
      const add = (input: NewPost): void => {
        try {
          const { post, created } = store.insertPost(input)
          if (created) pw.webContents.send(IPC.evtPostCaptured, { post, reason: 'created' })
        } catch (e) {
          console.error('[seed-demo] insert failed', e)
        }
      }
      const seedImage = (src: string, tag: string, sourceApp: string): void => {
        try {
          const buf = readFileSync(resolve(appPath, src))
          const hash = createHash('sha256').update(buf).update(tag).digest('hex')
          const file = join(imagesDir, `img_${hash.slice(0, 16)}.png`)
          writeFileSync(file, buf)
          add({
            hash,
            type: 'image',
            title: '图片',
            preview: `${(buf.length / 1024).toFixed(1)} KB`,
            contentPath: file,
            size: buf.length,
            sourceApp,
            groupId: null,
            tags: [],
          })
        } catch (e) {
          console.error('[seed-demo] image failed', src, e)
        }
      }
      const seedText = (text: string, sourceApp: string): void => {
        const hash = createHash('sha256').update(text).digest('hex')
        add({
          hash,
          type: text.startsWith('http') ? 'link' : 'text',
          title: text.slice(0, 40),
          preview: text,
          contentPath: null,
          size: Buffer.byteLength(text, 'utf8'),
          sourceApp,
          groupId: null,
          tags: [],
        })
      }
      seedText('todo: refine the panel card layout and spacing before release', 'ZCode')
      seedText('https://github.com/clipnest/clipnest', 'Microsoft Edge')
      seedText('ClipNest is a local-first clipboard manager built with Electron 38 and Vue 3.', 'ZCode')
      seedImage('resources/icon.png', 'a', 'ZCode')
      seedImage('resources/iconTemplate_win.png', 'b', 'PixPin')
      console.log('[seed-demo] done')
    }, 2200)
  }
                                                                        
  const SHOT = process.argv.find((a) => a.startsWith('--shot='))?.slice(7)
  const SHOT_SECTION = process.argv.find((a) => a.startsWith('--section='))?.slice(10)
  if (process.argv.includes('--show-settings') || SHOT) {
    let sw: BrowserWindow | null = null
    setTimeout(() => {
      sw = openSettingsWindow()
      if (sw && !sw.isDestroyed()) {
        const wa = screen.getPrimaryDisplay().workArea
        sw.setBounds({
          x: wa.x + Math.round((wa.width - 810) / 2),
          y: wa.y + Math.round((wa.height - 580) / 2),
          width: 810,
          height: 580,
        })
        if (SHOT_SECTION) {
                                                                        
          void sw.webContents
            .executeJavaScript(`window.location.hash='#/settings/${SHOT_SECTION}'`)
            .catch(() => {})
        }
        sw.focus()
      }
    }, 900)
    if (SHOT) {
      setTimeout(() => {
        if (sw && !sw.isDestroyed()) {
          sw.webContents
            .capturePage()
            .then((img) => {
              writeFileSync(SHOT, img.toPNG())
              console.log('[shot] saved', SHOT)
            })
            .catch((e) => console.error('[shot] capture failed', e))
        }
      }, 3600)
      setTimeout(() => app.quit(), 5400)
    } else {
      setTimeout(() => app.quit(), 11000)
    }
  }

                                                              
  const SHOT_PANEL = process.argv.find((a) => a.startsWith('--shot-panel='))?.slice(13)
  if (SHOT_PANEL) {
    const delay = Number(process.argv.find((a) => a.startsWith('--panel-delay='))?.slice(14) ?? 3500)
    const forceLayout = process.argv.find((a) => a.startsWith('--force-layout='))?.slice(15)
    if (forceLayout === 'vertical' || forceLayout === 'horizontal') {
      const pw = panelWindow
      if (pw && !pw.isDestroyed()) {
                                                               
        setLayout(pw, forceLayout)
        try {
          pw.webContents.send(IPC.evtSettingsChanged, store.getSettings())
        } catch {
                      
        }
        setTimeout(() => {
          if (!pw.isDestroyed()) setLayout(pw, forceLayout)
        }, 1000)
      }
    }
    setTimeout(() => {
      const w = panelWindow
      if (!w || w.isDestroyed()) {
        console.error('[shot-panel] no panel window')
        return
      }
      w.webContents
        .capturePage()
        .then((img) => {
          writeFileSync(SHOT_PANEL, img.toPNG())
          console.log('[shot-panel] saved', SHOT_PANEL)
        })
        .catch((e) => console.error('[shot-panel] failed', e))
    }, delay)
    setTimeout(() => app.quit(), delay + 2500)
  }
}).catch(error => {
  console.error('[clipnest] startup failed', error)
  dialog.showErrorBox('剪巢无法启动', `数据文件读取失败，请保留原文件并检查：\n${dbPath}`)
  app.quit()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  capture?.stop()
  browserBridgeStop?.()
  browserBridgeStop = null
  webManager?.stop()
  webManager = null
  store?.close()
})

                               
export const RENDERER_ENTRY = join(__dirname, '../renderer/index.html')
