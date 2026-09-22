import type { ClipStore, IntelligenceStatus, Post } from '@shared/types'
import {
  BUILTIN_MODEL,
  blobToVec,
  cosine,
  embedText,
  readPostContent,
} from './embedding'

   
                          
                      
                                          
                          
                                   
                                                   
                                           
   
export interface IntelligenceHub {
                             
  refresh(): void
  status(): IntelligenceStatus
                            
  indexPost(post: Post): void
                                     
  semanticSearch(keyword: string, limit: number): string[] | null
                                    
  vectorScore(fieldText: string, content: string): number | null
                      
  reindex(): number
}

const DRAIN_BATCH = 16

export function createHub(store: ClipStore): IntelligenceHub {
  let tier: IntelligenceStatus['tier'] = store.getSettings().intelligence.tier
  let queue: Post[] = []
  let draining = false
  let timer: ReturnType<typeof setTimeout> | null = null
  let sweepTimer: ReturnType<typeof setInterval> | null = null

  function isL1(): boolean {
    return tier === 'embedding'
  }

                                                   
  function sweepMissing(): void {
    if (!isL1()) return
    try {
      const vecs = new Set(store.queryVectors(BUILTIN_MODEL).map(v => v.postId))
      const page = store.queryPosts({ limit: 200 })
      const missing = page.items.filter(
        p => !vecs.has(p.id) && (p.type === 'text' || p.type === 'link'),
      )
      for (const post of missing.slice(0, 32)) {
        const content = readPostContent(post.contentPath, post.preview || post.title)
        store.upsertVector(post.id, BUILTIN_MODEL, embedText(`${post.title}\n${content}`))
      }
      if (missing.length > 0) {
        console.log('[hub] 后台补索引:', Math.min(missing.length, 32), '条（共缺', missing.length, '）')
      }
    } catch (e) {
      console.error('[hub] 后台巡检失败', e)
    }
  }

  function countIndexed(): { indexed: number; total: number } {
    try {
      const c = store.countByType()
      const total = (c.text || 0) + (c.link || 0)
      const indexed = store.queryVectors(BUILTIN_MODEL).length
      return { indexed, total }
    } catch {
      return { indexed: 0, total: 0 }
    }
  }

  function status(): IntelligenceStatus {
    const base: IntelligenceStatus = {
      tier,
      state: 'ready',
      model: isL1() ? BUILTIN_MODEL : 'rule',
      detail: isL1() ? '内置轻量向量（离线）' : '规则匹配',
      indexed: 0,
      total: 0,
      backend: 'builtin',
    }
    if (!isL1()) return base
    return { ...base, ...countIndexed() }
  }

  function drain(): void {
    draining = true
    try {
      const batch = queue.splice(0, DRAIN_BATCH)
      for (const post of batch) {
        try {
          const content = readPostContent(post.contentPath, post.preview || post.title)
          const v = embedText(`${post.title}\n${content}`)
          store.upsertVector(post.id, BUILTIN_MODEL, v)
        } catch (e) {
          console.error('[hub] 索引失败', post.id, e)
        }
      }
    } finally {
      draining = false
      if (queue.length > 0) scheduleDrain()
    }
  }

  function scheduleDrain(): void {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      if (!draining) drain()
    }, 300)
    timer.unref?.()
  }

  function indexPost(post: Post): void {
    if (!isL1()) return
    if (post.type !== 'text' && post.type !== 'link') return
    queue.push(post)
    if (queue.length > 512) queue.splice(0, queue.length - 512)
    if (!draining) scheduleDrain()
  }

  function semanticSearch(keyword: string, limit: number): string[] | null {
    if (!isL1() || !keyword.trim()) return null
    try {
      const qv = embedText(keyword)
      const vecs = store.queryVectors(BUILTIN_MODEL)
      if (vecs.length === 0) return null
      const scored = vecs.map(v => ({ postId: v.postId, s: cosine(qv, v.vec) }))
      scored.sort((a, b) => b.s - a.s)
      return scored.filter(x => x.s > 0.08).slice(0, limit).map(x => x.postId)
    } catch (e) {
      console.error('[hub] 语义搜索失败', e)
      return null
    }
  }

  function vectorScore(fieldText: string, content: string): number | null {
    if (!isL1()) return null
    try {
      return Math.max(0, cosine(embedText(fieldText), embedText(content)))
    } catch {
      return null
    }
  }

  function reindex(): number {
    if (!isL1()) return 0
    try {
      const page = store.queryPosts({ limit: 200 })
      let n = 0
      for (const post of page.items) {
        const content = readPostContent(post.contentPath, post.preview || post.title)
        const v = embedText(`${post.title}\n${content}`)
        store.upsertVector(post.id, BUILTIN_MODEL, v)
        n++
      }
      return n
    } catch (e) {
      console.error('[hub] 重建索引失败', e)
      return 0
    }
  }

  return {
    refresh() {
      const next = store.getSettings().intelligence.tier
      if (next !== tier) {
        tier = next
        queue = []
        console.log('[hub] tier 切换为', tier)
      }
                               
      if (isL1() && !sweepTimer) {
        sweepTimer = setInterval(sweepMissing, 5 * 60 * 1000)
        sweepTimer.unref?.()
      } else if (!isL1() && sweepTimer) {
        clearInterval(sweepTimer)
        sweepTimer = null
      }
    },
    status,
    indexPost,
    semanticSearch,
    vectorScore,
    reindex,
  }
}

export type { Post }
