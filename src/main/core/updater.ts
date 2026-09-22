import { Notification, app } from 'electron'
import type { BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'

const DEFAULT_FEED_URL = 'https://github.com/liuhao/clipnest/releases/latest/download'
const CHECK_DELAY = 10_000

                                          
function updatable(): boolean {
  return app.isPackaged || Boolean(process.env.CLIPNEST_UPDATE_URL)
}

export function initUpdater(win: BrowserWindow): void {
                               
  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.autoDownload = true
  autoUpdater.setFeedURL({
    provider: 'generic',
    url: process.env.CLIPNEST_UPDATE_URL || DEFAULT_FEED_URL,
  })

  autoUpdater.on('update-downloaded', () => {
    try {
      new Notification({ title: '剪巢', body: '新版本已下载，重启后安装' }).show()
    } catch (err) {
      console.error('[clipnest] 更新通知失败', err)
    }
    if (!win.isDestroyed()) win.webContents.send('update-downloaded')
  })
  autoUpdater.on('error', err => {
    console.error('[clipnest] 自动更新错误', err)
  })

  if (!updatable()) {
    console.log('[clipnest] 未打包运行，跳过更新检查')
    return
  }

  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(err => {
      console.error('[clipnest] 检查更新失败', err)
    })
  }, CHECK_DELAY).unref?.()
}

                                
export function checkForUpdate(): void {
  if (!updatable()) {
    console.log('[clipnest] 未打包运行，跳过更新检查')
    return
  }
  autoUpdater.checkForUpdates().catch(err => {
    console.error('[clipnest] 手动检查更新失败', err)
  })
}
