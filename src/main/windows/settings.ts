import { app, BrowserWindow } from 'electron'
import { resolve } from 'node:path'
import { loadAppIcon } from '@main/windows/icon'

const SETTINGS_WIDTH = 810
const SETTINGS_HEIGHT = 580

let settingsWin: BrowserWindow | null = null
let quitting = false

                                  
app.on('before-quit', () => {
  quitting = true
})

                                                           
const RENDERER_HTML = resolve(__dirname, '../renderer/index.html')
const PRELOAD_ENTRY = resolve(__dirname, '../preload/index.js')

export function createSettingsWindow(): BrowserWindow | null {
  if (settingsWin && !settingsWin.isDestroyed()) return settingsWin

  const win = new BrowserWindow({
    width: SETTINGS_WIDTH,
    height: SETTINGS_HEIGHT,
    icon: loadAppIcon(),
    show: false,
    frame: false,
    resizable: false,
    skipTaskbar: false,
    center: true,
                                     
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      preload: PRELOAD_ENTRY,
      backgroundThrottling: false,
    },
  })

  win.on('close', event => {
                             
    if (!quitting) {
      event.preventDefault()
      win.hide()
    }
  })
  win.on('closed', () => {
    if (settingsWin === win) settingsWin = null
  })

  win.loadFile(RENDERER_HTML, { hash: '/settings' }).catch(err => {
    console.error('[clipnest] 设置窗加载渲染产物失败', err)
  })

  settingsWin = win
  return win
}

export function openSettingsWindow(): BrowserWindow | null {
  const win = settingsWin && !settingsWin.isDestroyed() ? settingsWin : createSettingsWindow()
  if (!win) return null
                                        
  win.show()
  win.focus()
  return win
}

export function focusSettingsWindow(): void {
  if (!settingsWin || settingsWin.isDestroyed()) return
  if (!settingsWin.isVisible()) settingsWin.show()
  settingsWin.focus()
}

export function minimizeSettingsWindow(): void {
  if (!settingsWin || settingsWin.isDestroyed()) return
  settingsWin.minimize()
}

export function closeSettingsWindow(): void {
  if (!settingsWin || settingsWin.isDestroyed()) return
  settingsWin.close()
}
