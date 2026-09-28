import { app, clipboard, nativeImage } from 'electron'
import { execFileSync } from 'node:child_process'
import { pathToFileURL, fileURLToPath } from 'node:url'
import type { ClipboardSnapshot, ForegroundWindow, PlatformAdapter } from '@shared/types'

const POLL_INTERVAL_MS = 250
const FOREGROUND_POLL_MS = 300
const HYPRLAND_WINDOW_HANDLE = 1
const isHyprlandWayland = Boolean(process.env.HYPRLAND_INSTANCE_SIGNATURE)
let lastExternalHandle: number | null = null
let lastExternalAddress: string | null = null
let pasteTargetAddress: string | null = null
let foregroundTimer: ReturnType<typeof setInterval> | null = null
let foregroundErrorReported = false

interface HyprlandWindow {
  address: string
  pid: number
  title: string
}

function runXdotool(args: string[], reportError = true): string {
  try {
    return execFileSync('xdotool', args, { encoding: 'utf8' }).trim()
  } catch (e) {
    if (reportError) console.error('[platform:linux] xdotool command failed', args, e)
    throw e
  }
}

function runHyprctl(args: string[]): string {
  return execFileSync('hyprctl', args, { encoding: 'utf8' }).trim()
}

function readHyprlandActiveWindow(): HyprlandWindow | null {
  const raw: unknown = JSON.parse(runHyprctl(['activewindow', '-j']))
  if (typeof raw !== 'object' || raw === null) return null
  const data = raw as Record<string, unknown>
  if (typeof data.address !== 'string' || !/^0x[0-9a-f]+$/i.test(data.address)) return null
  if (typeof data.pid !== 'number' || !Number.isSafeInteger(data.pid)) return null
  return {
    address: data.address,
    pid: data.pid,
    title: typeof data.title === 'string' ? data.title : '',
  }
}

function focusedHandle(): number | null {
  const handle = Number(runXdotool(['getwindowfocus'], false))
  return Number.isSafeInteger(handle) && handle > 0 ? handle : null
}

function isOwnWindow(handle: number): boolean {
  return Number(runXdotool(['getwindowpid', String(handle)], false)) === process.pid
}

function trackExternalWindow(): void {
  try {
    if (isHyprlandWayland) {
      const active = readHyprlandActiveWindow()
      if (active && active.pid !== process.pid) {
        lastExternalAddress = active.address
        lastExternalHandle = HYPRLAND_WINDOW_HANDLE
      }
      foregroundErrorReported = false
      return
    }
    const handle = focusedHandle()
    if (handle !== null && !isOwnWindow(handle)) lastExternalHandle = handle
    foregroundErrorReported = false
  } catch (e) {
    if (!foregroundErrorReported) console.error('[platform:linux] track foreground window failed', e)
    foregroundErrorReported = true
  }
}

function startForegroundTracking(): void {
  if (foregroundTimer) return
  foregroundTimer = setInterval(trackExternalWindow, FOREGROUND_POLL_MS)
  foregroundTimer.unref()
  app.once('before-quit', () => {
    if (foregroundTimer) clearInterval(foregroundTimer)
    foregroundTimer = null
  })
}

function readFilePath(formats: string[]): string | null {
  const format = formats.find(item => item.toLowerCase() === 'text/uri-list')
  if (!format) return null
  try {
    const raw = clipboard.readBuffer(format).toString('utf8')
    const uri = raw.split(/\r?\n/).find(line => line && !line.startsWith('#'))
    return uri?.startsWith('file:') ? fileURLToPath(uri) : null
  } catch (e) {
    console.error('[platform:linux] read file URI failed', e)
    return null
  }
}

function readImage(formats: string[]): string | null {
  if (!formats.some(format => format.toLowerCase() === 'image/png')) return null
  try {
    const image = clipboard.readImage()
    return image.isEmpty() ? null : image.toDataURL()
  } catch (e) {
    console.error('[platform:linux] read image failed', e)
    return null
  }
}

function readClipboard(): ClipboardSnapshot {
  const formats = clipboard.availableFormats()
  try {
    return {
      formats,
      text: clipboard.readText(),
      html: clipboard.readHTML(),
      filePath: readFilePath(formats),
      imageDataUrl: readImage(formats),
    }
  } catch (e) {
    console.error('[platform:linux] read clipboard failed', e)
    throw e
  }
}

function foregroundWindow(): ForegroundWindow | null {
  try {
    if (isHyprlandWayland) {
      const active = readHyprlandActiveWindow()
      if (!active) return null
      if (active.pid !== process.pid) {
        lastExternalAddress = active.address
        lastExternalHandle = HYPRLAND_WINDOW_HANDLE
      }
      return { handle: HYPRLAND_WINDOW_HANDLE, title: active.title }
    }
    const handle = focusedHandle()
    if (handle === null) return null
    if (!isOwnWindow(handle)) lastExternalHandle = handle
    const title = runXdotool(['getwindowfocus', 'getwindowname'])
    return { handle, title }
  } catch (e) {
    console.error('[platform:linux] get foreground window failed', e)
    return null
  }
}

function writeFilePaths(paths: string[]): void {
  const urls = paths.filter(Boolean).map(path => pathToFileURL(path).href)
  if (urls.length === 0) throw new Error('writeFilePaths: no valid path')
  clipboard.writeBuffer('text/uri-list', Buffer.from(urls.join('\r\n') + '\r\n'))
}

export function createLinuxAdapter(): PlatformAdapter {
  startForegroundTracking()
  return {
    platform: 'linux',
    clipboardPollIntervalMs: POLL_INTERVAL_MS,
    clipboardSequenceNumber: () => null,
    readClipboard,
    foregroundWindow,
    saveForeground: () => {
      try {
        if (isHyprlandWayland) {
          pasteTargetAddress = null
          const active = readHyprlandActiveWindow()
          if (active && active.pid !== process.pid) {
            lastExternalAddress = active.address
            lastExternalHandle = HYPRLAND_WINDOW_HANDLE
          }
          return lastExternalAddress ? HYPRLAND_WINDOW_HANDLE : null
        }
        const handle = focusedHandle()
        if (handle === null) return lastExternalHandle
        if (isOwnWindow(handle)) return lastExternalHandle ?? handle
        lastExternalHandle = handle
        return handle
      } catch (e) {
        console.error('[platform:linux] save foreground failed', e)
        return null
      }
    },
    restoreForeground: handle => {
      if (isHyprlandWayland) {
        pasteTargetAddress = handle === HYPRLAND_WINDOW_HANDLE ? lastExternalAddress : null
        return
      }
      runXdotool(['windowactivate', '--sync', String(handle)])
    },
    writeText: text => clipboard.writeText(text),
    writeHtml: (html, plain) => clipboard.write({ text: plain, html }),
    writeImageFile: path => {
      const image = nativeImage.createFromPath(path)
      if (image.isEmpty()) throw new Error('writeImageFile: cannot load image ' + path)
      clipboard.writeImage(image)
    },
    writeFilePaths,
    sendPasteKeys: () => {
      if (isHyprlandWayland) {
        const address = pasteTargetAddress
        pasteTargetAddress = null
        if (!address) throw new Error('sendPasteKeys: no saved Hyprland target window')
        const result = runHyprctl(['dispatch', 'sendshortcut', `CTRL,V,address:${address}`])
        if (!/^ok$/i.test(result)) throw new Error(`Hyprland rejected paste shortcut: ${result}`)
        return
      }
      runXdotool(['key', '--clearmodifiers', 'ctrl+v'])
    },
  }
}
