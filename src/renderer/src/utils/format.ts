   
                                
                    
   

function dayStart(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

export function formatTime(ts: number): string {
  const d = new Date(ts)
  const now = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  const diffDays = Math.round((dayStart(now) - dayStart(d)) / 86400000)
  if (diffDays <= 0) return `${pad(d.getHours())}:${pad(d.getMinutes())}`
  if (diffDays === 1) return '昨天'
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

                                                
export function formatRelative(ts: number): string {
  const diff = Date.now() - ts
  const MIN = 60000
  const HOUR = 3600000
  const DAY = 86400000
  if (diff < MIN) return '几秒前'
  if (diff < HOUR) return `${Math.floor(diff / MIN)} 分钟前`
  if (diff < DAY) return `${Math.floor(diff / HOUR)} 小时前`
  if (diff < 2 * DAY) return '昨天'
  return `${Math.floor(diff / DAY)} 天前`
}
