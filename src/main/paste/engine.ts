import { readFileSync } from 'node:fs'
import type { ClipboardSnapshot, ClipStore, Post } from '@shared/types'
import { markSelfWrite } from '@main/capture'
import { initStore } from '@main/core/store'
import {
  readSnapshot,
  writeFilePaths,
  writeHtml,
  writeImageDataUrl,
  writeImageFile,
  writeRichText,
  writeText,
} from './writer'
import { restoreForeground, saveForeground } from './foreground'
import { sendPasteKeys } from './keyin'
import type { PasteEngine } from './index'

                                     
const KEY_DELAY_MS = 60
                               
const QUEUE_LIMIT = 9
                  
const FLUSH_INTERVAL_MS = 150

const delay = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

let storeSingleton: ClipStore | null = null

function touchPost(id: string): void {
  try {
    if (!storeSingleton) storeSingleton = initStore()
    storeSingleton.touchPost(id)
  } catch (e) {
    console.error('[clipnest] touchPost failed', e)
  }
}

   
                                        
                                    
                                                 
                                                  
   
function markSelf(hash: string, contentPath: string | null): void {
  try {
    markSelfWrite(hash, contentPath)
  } catch (e) {
    console.error('[clipnest] markSelfWrite failed', e)
  }
}

                                               
function resolvePaths(post: Post): string[] {
  const raw = post.contentPath?.trim()
  if (!raw) return []
  if (raw.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        return parsed.filter((p): p is string => typeof p === 'string' && p.length > 0)
      }
    } catch {
                            
    }
  }
  return [raw]
}

                                                   
function readRawText(path: string | null): string | null {
  if (!path) return null
  try {
    return readFileSync(path, 'utf8')
  } catch (e) {
    console.error('[clipnest] readRawText failed', e)
    return null
  }
}

function writePostContent(post: Post): void {
  switch (post.type) {
    case 'image':
      if (!post.contentPath) throw new Error(`image post ${post.id} has no contentPath`)
      writeImageFile(post.contentPath)
      return
    case 'file':
    case 'folder': {
      const paths = resolvePaths(post)
      if (paths.length === 0) throw new Error(`file post ${post.id} has no contentPath`)
      writeFilePaths(paths)
      return
    }
    case 'link':
      writeText(post.preview)
      return
    default:
      writeRichText(readRawText(post.contentPath) ?? '', post.preview)
  }
}

function writeSnapshotContent(snap: ClipboardSnapshot): void {
  if (snap.filePath) {
    writeFilePaths([snap.filePath])
    return
  }
  if (snap.imageDataUrl) {
    writeImageDataUrl(snap.imageDataUrl)
    return
  }
  if (snap.html) {
    writeHtml(snap.html, snap.text)
    return
  }
  writeText(snap.text)
}

   
                             
                                    
   
async function pasteClipboard(write: () => void): Promise<boolean> {
  const handle = saveForeground()
  try {
    write()
  } catch (e) {
    console.error('[clipnest] clipboard write failed', e)
    return false
  }
  try {
    restoreForeground(handle)
    await delay(KEY_DELAY_MS)
    sendPasteKeys()
  } catch (e) {
    console.error('[clipnest] paste keyin failed', e)
  }
  return true
}

export class PasteEngineImpl implements PasteEngine {
  private queue: ClipboardSnapshot[] = []
  private lastFlushAt = 0

  async pastePost(post: Post): Promise<void> {
    markSelf(post.hash, post.contentPath)
    const written = await pasteClipboard(() => writePostContent(post))
                              
    if (written) touchPost(post.id)
  }

  enqueueCopy(): number {
    try {
      this.queue.push(readSnapshot())
    } catch (e) {
      console.error('[clipnest] enqueueCopy failed', e)
      return this.queue.length
    }
    while (this.queue.length > QUEUE_LIMIT) this.queue.shift()
    return this.queue.length
  }

  async flushQueue(): Promise<boolean> {
    const snap = this.queue.shift()
    if (!snap) return false
    const wait = FLUSH_INTERVAL_MS - (Date.now() - this.lastFlushAt)
    if (wait > 0) await delay(wait)
    this.lastFlushAt = Date.now()
    await pasteClipboard(() => writeSnapshotContent(snap))
    return true
  }
}

export function createPasteEngine(): PasteEngine {
  return new PasteEngineImpl()
}
