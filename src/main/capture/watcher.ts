import { clipboard } from 'electron'
import { load } from 'koffi'
import type { IKoffiLib } from 'koffi'
import type { ClipboardSnapshot } from '@shared/types'

                                         
const POLL_INTERVAL_MS = 80
                                   
const QUEUE_CAPACITY = 64

export type SnapshotHandler = (snapshot: ClipboardSnapshot) => void | Promise<void>

let user32: IKoffiLib | null = null
let user32Failed = false

                                                     
function win32(): IKoffiLib | null {
  if (user32Failed) return null
  if (!user32) {
    try {
      user32 = load('user32.dll')
    } catch (e) {
      user32Failed = true
      console.error('[capture] load user32.dll failed', e)
    }
  }
  return user32
}

                                                           
function hasFileFormats(formats: string[]): boolean {
  return formats.some(
    f => f === 'text/uri-list' || f === 'Files' || f === 'FileNameW' || f === 'CF_HDROP',
  )
}

                                                 
function readFilePath(): string | null {
  const buf = clipboard.readBuffer('FileNameW')
  if (!buf || buf.length === 0) return null
  const raw = buf.toString('ucs2').replace(/^\uFEFF/, '')
  const first = raw.split('\0').find(p => p.trim().length > 0)
  return first ? first.trim() : null
}

                                    
function readSnapshot(): ClipboardSnapshot | null {
  try {
    const formats = clipboard.availableFormats()
    if (!formats || formats.length === 0) return null
    let text = ''
    let html = ''
    let filePath: string | null = null
    let imageDataUrl: string | null = null
    try {
      if (formats.includes('text/plain')) text = clipboard.readText()
    } catch {
                  
    }
    try {
      if (formats.includes('text/html')) html = clipboard.readHTML()
    } catch {
                  
    }
    try {
      if (hasFileFormats(formats)) filePath = readFilePath()
    } catch {
                  
    }
    try {
      if (formats.includes('image/png')) {
        const image = clipboard.readImage()
        if (!image.isEmpty()) imageDataUrl = image.toDataURL()
      }
    } catch {
                  
    }
    return { formats, text, html, filePath, imageDataUrl }
  } catch (e) {
    console.error('[capture] read clipboard failed', e)
    return null
  }
}

   
                                 
                               
   
export function startListening(onSnapshot: SnapshotHandler): { stop(): void } {
  if (process.platform !== 'win32') {
    console.warn('[capture] clipboard polling is win32-only; capture disabled on this platform')
    return { stop() {} }
  }
  const lib = win32()
  if (!lib) return { stop() {} }

  let getSeq: (() => unknown) | null = null
  let lastSeq = -1
  try {
    const fn = lib.func('uint32 __stdcall GetClipboardSequenceNumber()')
    lastSeq = Number(fn())
    getSeq = () => fn()
  } catch (e) {
    console.error('[capture] resolve GetClipboardSequenceNumber failed', e)
    return { stop() {} }
  }

  const queue: ClipboardSnapshot[] = []
  let draining = false
  let stopped = false

  async function drain(): Promise<void> {
    if (draining) return
    draining = true
    try {
      while (!stopped && queue.length > 0) {
        const snapshot = queue.shift()
        if (!snapshot) break
        try {
          await onSnapshot(snapshot)
        } catch (e) {
          console.error('[capture] handle snapshot failed', e)
        }
      }
    } finally {
      draining = false
    }
  }

  const timer = setInterval(() => {
    if (stopped) return
    let seq: number
    try {
      seq = Number(getSeq?.())
    } catch {
      return
    }
    if (seq === lastSeq) return
    lastSeq = seq
    const snapshot = readSnapshot()
    if (!snapshot) return
    if (queue.length >= QUEUE_CAPACITY) {
      console.warn('[capture] snapshot queue is full, dropping newest event')
      return
    }
    queue.push(snapshot)
    void drain()
  }, POLL_INTERVAL_MS)

  return {
    stop() {
      stopped = true
      clearInterval(timer)
      queue.length = 0
    },
  }
}
