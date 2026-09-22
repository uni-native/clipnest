import type { Post } from '@shared/types'

export interface PasteEngine {
  pastePost(post: Post): Promise<void>
  enqueueCopy(): number
  flushQueue(): Promise<boolean>
}

export { createPasteEngine, PasteEngineImpl } from './engine'
