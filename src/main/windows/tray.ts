import { app, Menu, Tray } from 'electron'
import type { BrowserWindow } from 'electron'
import { openSettingsWindow } from '@main/windows/settings'
import { togglePanel, getSettings } from '@main/windows/panel'
import { openWebManager } from '@main/web/manager'
import { loadTrayIcon } from '@main/windows/icon'

let tray: Tray | null = null

export function createTray(win: BrowserWindow): Tray | null {
  destroyTray()

  const instance = new Tray(loadTrayIcon())
  instance.setToolTip('剪巢 ClipNest')
  instance.on('click', () => togglePanel(win))

  const showOrHide = getSettings().shortcutKeys.showOrHide
  const menu = Menu.buildFromTemplate([
    {
      label: '显示/隐藏',
      accelerator: showOrHide || undefined,
      click: () => togglePanel(win),
    },
    { label: '网页版管理', click: () => void openWebManager() },
    { label: '偏好设置', click: () => openSettingsWindow() },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() },
  ])
  instance.setContextMenu(menu)

  tray = instance
  return tray
}

export function destroyTray(): void {
  if (!tray) return
  tray.destroy()
  tray = null
}
