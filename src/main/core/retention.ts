import type { ClipStore, Settings } from '@shared/types'

                                                       
const RETAIN_MS: Record<string, number> = {
  day: 1 * 86_400_000,
  week: 7 * 86_400_000,
  month: 30 * 86_400_000,
  quarter: 91 * 86_400_000,
  half: 182 * 86_400_000,
  year: 365 * 86_400_000,
}

const CHECK_INTERVAL = 3_600_000

let timer: ReturnType<typeof setInterval> | null = null

function runOnce(store: ClipStore, historyCache: string): void {
  const retain = RETAIN_MS[historyCache]
                           
  if (!retain) return
  try {
    const removed = store.clearHistoryBefore(Date.now() - retain)
    if (removed > 0) store.vacuum()
  } catch (err) {
    console.error('[clipnest] 保留策略清理失败', err)
  }
}

                                        
export function applyRetention(store: ClipStore, historyCache: string): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
                      
  if (!RETAIN_MS[historyCache]) return
  runOnce(store, historyCache)
  timer = setInterval(() => runOnce(store, historyCache), CHECK_INTERVAL)
               
  timer.unref?.()
}

export function initRetention(store: ClipStore, settings: Settings): void {
  applyRetention(store, settings.general.historyCache)
}
