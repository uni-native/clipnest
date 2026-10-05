import { app, dialog } from 'electron'
import type { BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'

const CHECK_DELAY = 10_000
let checking = false
let manualCheck = false
let downloaded = false
let prompting = false

function showMessage(message: string, detail = ''): void {
  void dialog.showMessageBox({ type: 'info', title: 'PasteMan 更新', message, detail })
    .catch(error => console.error('[pasteman] 更新提示失败', error))
}

async function offerInstall(): Promise<void> {
  if (prompting) return
  prompting = true
  try {
    const result = await dialog.showMessageBox({
      type: 'info', title: 'PasteMan 更新', message: '新版本已下载',
      detail: '重启后自动更新，剪贴板历史和设置会保留。',
      buttons: ['重启更新', '稍后'], defaultId: 0, cancelId: 1,
    })
    if (result.response === 0) autoUpdater.quitAndInstall(true, true)
  } catch (error) {
    console.error('[pasteman] 安装更新失败', error)
  } finally {
    prompting = false
  }
}

export function initUpdater(win: BrowserWindow): void {
  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.autoDownload = true
  autoUpdater.logger = console
  // 安装版从打包配置读取更新源，避免检查地址与发布地址分离。
  if (process.env.PASTEMAN_UPDATE_URL) {
    autoUpdater.setFeedURL({ provider: 'generic', url: process.env.PASTEMAN_UPDATE_URL })
  }
  autoUpdater.on('update-available', info => {
    console.log('[pasteman] 正在下载更新', info.version)
    if (manualCheck) showMessage('发现新版本，正在后台下载', `版本 ${info.version}`)
  })
  autoUpdater.on('update-not-available', () => {
    console.log('[pasteman] 当前已是最新版本', app.getVersion())
    if (manualCheck) showMessage('当前已是最新版本', `版本 ${app.getVersion()}`)
    manualCheck = false
  })
  autoUpdater.on('update-downloaded', () => {
    downloaded = true
    manualCheck = false
    if (!win.isDestroyed()) win.webContents.send('update-downloaded')
    void offerInstall()
  })
  autoUpdater.on('error', error => {
    console.error('[pasteman] 自动更新失败', error)
    if (manualCheck) showMessage('更新检查或下载失败', '请检查网络和 GitHub Release 更新文件。')
    manualCheck = false
  })
  if (app.isPackaged) setTimeout(() => runCheck(false), CHECK_DELAY).unref()
}

function runCheck(manual: boolean): void {
  if (!app.isPackaged) {
    if (manual) showMessage('请在安装版中检查更新')
    return
  }
  if (downloaded) { void offerInstall(); return }
  if (checking) return
  checking = true
  manualCheck = manual
  void autoUpdater.checkForUpdates()
    .catch(error => console.error('[pasteman] 检查更新失败', error))
    .finally(() => { checking = false })
}

export function checkForUpdate(): void {
  runCheck(true)
}
