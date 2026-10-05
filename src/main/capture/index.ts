import type { CaptureEvent, ClipStore, ClipboardSnapshot, NewPost } from '@shared/types'
import { classifySnapshot } from './classify'
import { normalizeSnapshot } from './normalize'
import { getSourceApp } from './sourceApp'
import { startListening } from './watcher'
import { clipboardFormatNames } from '@main/platform/win32'

                                          
const SELF_WRITE_WINDOW_MS = 800
                          
const SELF_WRITE_MAX = 64

interface SelfWriteRecord {
  at: number
                                      
  path: string | null
}

const selfWrites = new Map<string, SelfWriteRecord>()

   
                                
                                                   
                                            
   
export function markSelfWrite(hash: string, contentPath?: string | null): void {
  selfWrites.set(hash, { at: Date.now(), path: contentPath ?? null })
}

function isSelfWrite(snapshot: ClipboardSnapshot, hash: string): boolean {
  const now = Date.now()
  for (const [key, record] of selfWrites) {
    if (now - record.at > SELF_WRITE_WINDOW_MS) selfWrites.delete(key)
  }
  if (selfWrites.size > SELF_WRITE_MAX) selfWrites.clear()
  for (const [key, record] of selfWrites) {
    if (now - record.at > SELF_WRITE_WINDOW_MS) continue
    if (key === hash) return true
    if (record.path && snapshot.filePath && samePath(record.path, snapshot.filePath)) return true
  }
  return false
}

                                       
function samePath(a: string, b: string): boolean {
  const norm = (p: string): string => p.replace(/[\\/]+$/, '').toLowerCase()
  return norm(a) === norm(b)
}

async function handleSnapshot(
  store: ClipStore,
  emit: (e: CaptureEvent) => void,
  snapshot: ClipboardSnapshot,
): Promise<void> {
  const started = Date.now()
                                    
  const sourceApp = getSourceApp()
  const type = classifySnapshot(snapshot)
  const normalized = normalizeSnapshot(snapshot, type)
  if (!normalized) {
    console.warn('[capture] 内容未收录', { sequence: snapshot.sequence, reason: '未识别到可保存内容',
      formats: snapshot.formats, nativeFormats: clipboardFormatNames(),
      hasFilePath: Boolean(snapshot.filePath), hasImage: Boolean(snapshot.imageDataUrl) })
    return
  }
  if (isSelfWrite(snapshot, normalized.hash)) {
    console.log('[capture] 忽略应用自身复制', { sequence: snapshot.sequence, type })
    return
  }
  const input: NewPost = {
    hash: normalized.hash,
    type: normalized.type,
    title: normalized.title,
    preview: normalized.preview,
    contentPath: normalized.contentPath,
    size: normalized.size,
    sourceApp,
    groupId: null,
    tags: [],
  }
  const { post, created } = store.insertPost(input)
  console.log('[capture] 内容已收录', { sequence: snapshot.sequence, id: post.id, type,
    result: created ? '新增' : '更新已有记录', bytes: normalized.size, formats: snapshot.formats,
    elapsedMs: Date.now() - started })
  emit({ post, reason: created ? 'created' : 'touched' })
}

                                             
export function startCapture(
  store: ClipStore,
  emit: (e: CaptureEvent) => void,
): { stop(): void } {
  return startListening((snapshot: ClipboardSnapshot) =>
    handleSnapshot(store, emit, snapshot),
  )
}
