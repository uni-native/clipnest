import { app, nativeImage } from 'electron'
import { join, resolve } from 'node:path'

function iconPath(fileName: string): string {
  return app.isPackaged
    ? join(process.resourcesPath, fileName)
    : resolve(__dirname, `../../resources/${fileName}`)
}

export function loadAppIcon(): Electron.NativeImage {
  const path = iconPath('icon.png')
  const icon = nativeImage.createFromPath(path)
  if (icon.isEmpty()) console.error('[clipnest] 应用图标加载失败:', path)
  return icon
}

export function loadTrayIcon(): Electron.NativeImage {
  const path = iconPath('iconTemplate_win.png')
  const icon = nativeImage.createFromPath(path)
  if (icon.isEmpty()) console.error('[clipnest] 托盘图标加载失败:', path)
  return icon
}
