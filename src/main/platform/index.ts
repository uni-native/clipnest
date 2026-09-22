import { clipboard, nativeImage } from 'electron'
import type { ClipboardSnapshot, ForegroundWindow, PlatformAdapter } from '@shared/types'
import {
  CF_HDROP,
  GMEM_MOVEABLE,
  clipboardFilePaths,
  dropFilesPayload,
  getWin32,
  handleToNumber,
  openClipboardWithRetry,
  windowProcessId,
  windowTitle,
  writeDropFiles,
} from './win32'

                                          
let lastExternalHandle: number | null = null

                                              
const FOREGROUND_POLL_MS = 300
let pollTimer: ReturnType<typeof setInterval> | null = null

function isOwnWindow(handle: number): boolean {
  try {
    return windowProcessId(handle) === process.pid
  } catch {
    return false
  }
}

                                  
function ensureForegroundTracking(): void {
  if (pollTimer) return
  pollTimer = setInterval(() => {
    const handle = handleToNumber(getWin32().GetForegroundWindow())
    if (handle !== null && !isOwnWindow(handle)) lastExternalHandle = handle
  }, FOREGROUND_POLL_MS)
  pollTimer.unref?.()
}

function readText(): string {
  try {
    return clipboard.readText()
  } catch (e) {
    console.error('[clipnest] clipboard.readText failed', e)
    return ''
  }
}

function readHtml(): string {
  try {
    return clipboard.readHTML()
  } catch (e) {
    console.error('[clipnest] clipboard.readHTML failed', e)
    return ''
  }
}

                                                    
function readFilePath(): string | null {
  try {
    const raw = clipboard.readBuffer('FileNameW')
    if (raw && raw.length > 0) {
      const parts = raw
        .toString('ucs2')
        .split('\0')
        .map(p => p.trim())
        .filter(p => p.length > 0)
      if (parts.length > 0) return parts[0]
    }
  } catch (e) {
    console.error('[clipnest] clipboard.readBuffer(FileNameW) failed', e)
  }
                                                     
  const native = clipboardFilePaths()
  return native.length > 0 ? native[0] : null
}

function readImageDataUrl(formats: string[]): string | null {
  const hasPng = formats.some(f => f.toLowerCase() === 'image/png')
  if (!hasPng) return null
  try {
    const image = clipboard.readImage()
    if (image.isEmpty()) return null
    const url = image.toDataURL()
                                                         
    return url && url !== 'data:image/png;base64,' ? url : null
  } catch (e) {
    console.error('[clipnest] clipboard.readImage failed', e)
    return null
  }
}

function writeFilePaths(paths: string[]): void {
  const list = paths.filter(p => typeof p === 'string' && p.length > 0)
  if (list.length === 0) throw new Error('writeFilePaths: no valid path')
  const w = getWin32()
  const { codes, size } = dropFilesPayload(list)
  if (!openClipboardWithRetry(w)) throw new Error('writeFilePaths: OpenClipboard failed')

  try {
    w.EmptyClipboard()
    const hMem = w.GlobalAlloc(GMEM_MOVEABLE, size)
    if (!hMem) throw new Error('writeFilePaths: GlobalAlloc failed')
    writeDropFiles(hMem, codes)
                                                        
    if (!w.SetClipboardData(CF_HDROP, hMem)) {
      throw new Error('writeFilePaths: SetClipboardData(CF_HDROP) failed')
    }
  } finally {
    w.CloseClipboard()
  }
}

function restoreForeground(handle: number): void {
  if (!handle) return
  const w = getWin32()
  if (w.SetForegroundWindow(handle)) return
                                                     
  const targetThread = w.GetWindowThreadProcessId(handle, null)
  const selfThread = w.GetCurrentThreadId()
  if (!targetThread || targetThread === selfThread) return
  w.AttachThreadInput(selfThread, targetThread, 1)
  try {
    w.SetForegroundWindow(handle)
  } finally {
    w.AttachThreadInput(selfThread, targetThread, 0)
  }
}

function createWin32Adapter(): PlatformAdapter {
  return {
    platform: 'win32',
    clipboardSequenceNumber: () => getWin32().GetClipboardSequenceNumber(),
    readClipboard: () => {
      const formats = clipboard.availableFormats()
      return {
        formats,
        text: readText(),
        html: readHtml(),
        filePath: readFilePath(),
        imageDataUrl: readImageDataUrl(formats),
      }
    },
    foregroundWindow: () => {
      const handle = handleToNumber(getWin32().GetForegroundWindow())
      if (handle === null) return null
      if (!isOwnWindow(handle)) lastExternalHandle = handle
      const window: ForegroundWindow = { title: windowTitle(handle), handle }
      return window
    },
    saveForeground: () => {
      ensureForegroundTracking()
      const handle = handleToNumber(getWin32().GetForegroundWindow())
      if (handle === null) return lastExternalHandle
      if (isOwnWindow(handle)) return lastExternalHandle ?? handle
      lastExternalHandle = handle
      return handle
    },
    restoreForeground,
    writeText: text => clipboard.writeText(text),
    writeHtml: (html, plain) => clipboard.write({ text: plain, html }),
    writeImageFile: path => {
      const image = nativeImage.createFromPath(path)
      if (image.isEmpty()) throw new Error(`writeImageFile: cannot load image ${path}`)
      clipboard.writeImage(image)
    },
    writeFilePaths,
    sendPasteKeys: () => {
      const sent = getWin32().sendCtrlV()
      if (sent !== 4) console.error(`[clipnest] SendInput only queued ${sent}/4 events`)
    },
  }
}

                                                                              

let adapter: PlatformAdapter | null = null

                                    
function darwinStub(): PlatformAdapter {
  const fail = (): never => {
    throw new Error('ClipNest: macOS 平台适配尚未实现（仅支持 Windows）')
  }
  return {
    platform: 'darwin',
    clipboardSequenceNumber: fail,
    readClipboard: fail,
    foregroundWindow: fail,
    saveForeground: fail,
    restoreForeground: fail,
    writeText: fail,
    writeHtml: fail,
    writeImageFile: fail,
    writeFilePaths: fail,
    sendPasteKeys: fail,
  }
}

export function getPlatform(): PlatformAdapter {
  if (process.platform !== 'win32') return darwinStub()
  if (!adapter) adapter = createWin32Adapter()
  return adapter
}
