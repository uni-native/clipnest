import { app, clipboard, nativeImage } from 'electron'
import { execFile, execFileSync, spawnSync } from 'node:child_process'
import { pathToFileURL, fileURLToPath } from 'node:url'
import type { ClipboardSnapshot, ForegroundWindow, PlatformAdapter } from '@shared/types'
import {
  foregroundHyprlandWindow, initHyprland, isHyprlandSession, pasteHyprland,
  restoreHyprlandForeground, saveHyprlandForeground, trackHyprlandWindow,
} from './hyprland'

const POLL_INTERVAL_MS = 250
const FOREGROUND_POLL_MS = 300
const COMMAND_TIMEOUT_MS = 500
let lastExternalHandle: number | null = null
let foregroundTimer: ReturnType<typeof setInterval> | null = null
let foregroundErrorReported = false
let foregroundPolling = false
let xdotoolAvailable = false
let commandAvailable = false
let timestampErrorReported = false

function checkXdotool(): boolean {
  if (!process.env.DISPLAY) {
    console.error('[platform:linux] X11 display unavailable; automatic paste and window tracking disabled')
    return false
  }
  const result = spawnSync('xdotool', ['version'], { timeout: COMMAND_TIMEOUT_MS, encoding: 'utf8' })
  if (result.status === 0) return true
  console.error('[platform:linux] xdotool unavailable; automatic paste and window tracking disabled', result.error ?? result.stderr)
  return false
}

function runXdotool(args: string[], reportError = true): string {
  if (!xdotoolAvailable) throw new Error('xdotool unavailable')
  try {
    return execFileSync('xdotool', args, { encoding: 'utf8', timeout: COMMAND_TIMEOUT_MS }).trim()
  } catch (e) {
    if (reportError) console.error('[platform:linux] xdotool command failed', args, e)
    throw e
  }
}

function runXdotoolAsync(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('xdotool', args, { encoding: 'utf8', timeout: COMMAND_TIMEOUT_MS }, (error, stdout) => {
      if (error) reject(error)
      else resolve(stdout.trim())
    })
  })
}

function focusedHandle(): number | null {
  const handle = Number(runXdotool(['getwindowfocus'], false))
  return Number.isSafeInteger(handle) && handle > 0 ? handle : null
}

function isOwnWindow(handle: number): boolean {
  return Number(runXdotool(['getwindowpid', String(handle)], false)) === process.pid
}

async function trackExternalWindow(): Promise<void> {
  if (foregroundPolling) return
  foregroundPolling = true
  try {
    if (isHyprlandSession()) {
      await trackHyprlandWindow()
      foregroundErrorReported = false
      return
    }
    const handle = Number(await runXdotoolAsync(['getwindowfocus']))
    if (Number.isSafeInteger(handle) && handle > 0) {
      const pid = Number(await runXdotoolAsync(['getwindowpid', String(handle)]))
      if (pid !== process.pid) lastExternalHandle = handle
    }
    foregroundErrorReported = false
  } catch (e) {
    if (!foregroundErrorReported) console.error('[platform:linux] track foreground window failed', e)
    foregroundErrorReported = true
  } finally {
    foregroundPolling = false
  }
}

function startForegroundTracking(): void {
  if (foregroundTimer || !commandAvailable) return
  void trackExternalWindow()
  foregroundTimer = setInterval(() => { void trackExternalWindow() }, FOREGROUND_POLL_MS)
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

function clipboardTimestamp(): number | null {
  try {
    if (!clipboard.availableFormats().includes('TIMESTAMP')) return null
    const stamp = clipboard.readBuffer('TIMESTAMP')
    if (stamp.length !== 4 && stamp.length !== 8) return null
    const value = stamp.readUInt32LE(0)
    return value > 0 ? value : null
  } catch (e) {
    if (!timestampErrorReported) console.error('[platform:linux] read clipboard timestamp failed', e)
    timestampErrorReported = true
    return null
  }
}

function foregroundWindow(): ForegroundWindow | null {
  if (!commandAvailable) return null
  try {
    if (isHyprlandSession()) return foregroundHyprlandWindow()
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
  if (isHyprlandSession()) commandAvailable = initHyprland()
  else commandAvailable = xdotoolAvailable = checkXdotool()
  startForegroundTracking()
  return {
    platform: 'linux',
    clipboardPollIntervalMs: POLL_INTERVAL_MS,
    clipboardSequenceNumber: clipboardTimestamp,
    readClipboard,
    foregroundWindow,
    saveForeground: () => {
      if (!commandAvailable) return null
      try {
        if (isHyprlandSession()) return saveHyprlandForeground()
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
      if (isHyprlandSession()) return restoreHyprlandForeground(handle)
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
      if (isHyprlandSession()) return pasteHyprland()
      runXdotool(['key', '--clearmodifiers', 'ctrl+v'])
    },
  }
}
