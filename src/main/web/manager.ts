import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { BrowserWindow, shell } from 'electron'
import { IPC } from '@shared/types'
import type { ClipboardActivity, ClipStore, ContentType, Post, PostQuery } from '@shared/types'

const HOST = '127.0.0.1'
const MAX_BODY_BYTES = 64 * 1024
const MAX_BATCH_DELETE = 200
const CONTENT_TYPES = new Set<ContentType>(['text', 'image', 'link', 'file', 'folder'])
const STATIC_ROOT = resolve(__dirname, '../renderer/manage')

type ContentCategory =
  | 'contact'
  | 'link'
  | 'code'
  | 'writing'
  | 'media'
  | 'sensitive'
  | 'other'

const CATEGORY_LABELS: Record<ContentCategory, string> = {
  contact: '联系信息',
  link: '链接资料',
  code: '代码配置',
  writing: '写作沟通',
  media: '文件媒体',
  sensitive: '敏感内容',
  other: '其他',
}

interface ManagerDeps {
  store: ClipStore
  port: number
}

export interface WebManagerHandle {
  readonly url: string
  stop(): void
}

let activeUrl = ''
let activeServer: ReturnType<typeof createServer> | null = null
let activePort = 0

function headers(contentType: string): Record<string, string> {
  return {
    'Content-Type': contentType,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
  }
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, headers('application/json; charset=utf-8'))
  res.end(JSON.stringify(body))
}

function publicPost(post: Post): Omit<Post, 'hash' | 'contentPath'> {
  const { hash: _hash, contentPath: _contentPath, ...safe } = post
  return safe
}

function classifyPost(post: Post): ContentCategory {
  const text = `${post.title}\n${post.preview}`
  if (/(?:密码|passwd|password|验证码|otp|api[ _-]?key|access[ _-]?token|secret|private[ _-]?key|身份证|银行卡|BEGIN [A-Z ]*PRIVATE KEY)/i.test(text)) {
    return 'sensitive'
  }
  if (post.type === 'file' || post.type === 'folder' || post.type === 'image') return 'media'
  if (/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(text) || /(?:\+?86[- ]?)?1[3-9]\d(?:[- ]?\d){8}\b/.test(text)) {
    return 'contact'
  }
  if (post.type === 'link' || /\b(?:https?|ftp):\/\/[^\s]+/i.test(text)) return 'link'
  if (/(?:^|\n)\s*(?:import |export |const |let |var |function |class |SELECT |INSERT |UPDATE |DELETE |CREATE TABLE|npm |pnpm |git |curl )/im.test(text) || /[{};]\s*(?:\n|$)/.test(text)) {
    return 'code'
  }
  if (text.trim().length >= 48 || /(?:ChatGPT|Word|微信|WPS|Notion)/i.test(post.sourceApp)) return 'writing'
  return 'other'
}

function dayBounds(raw: string | null): { key: string; start: number; end: number } {
  const now = new Date()
  let year = now.getFullYear()
  let month = now.getMonth()
  let day = now.getDate()
  const match = raw?.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (match) {
    const parsed = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
    if (!Number.isNaN(parsed.getTime()) && parsed.getFullYear() === Number(match[1]) && parsed.getMonth() === Number(match[2]) - 1 && parsed.getDate() === Number(match[3])) {
      year = parsed.getFullYear()
      month = parsed.getMonth()
      day = parsed.getDate()
    }
  }
  const startDate = new Date(year, month, day)
  const endDate = new Date(year, month, day + 1)
  const key = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  return { key, start: startDate.getTime(), end: endDate.getTime() }
}

function countByPost(events: ClipboardActivity[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const event of events) counts.set(event.post.id, (counts.get(event.post.id) ?? 0) + 1)
  return counts
}

function lowValue(post: Post): boolean {
  const text = (post.preview || post.title).trim()
  return post.pinned === 0 && (text.length <= 3 || /^(.)\1{2,}$/.test(text) || /^(?:test|测试|asdf|asdas|1234)$/i.test(text))
}

function dailyAnalytics(store: ClipStore, rawDate: string | null): Record<string, unknown> {
  const bounds = dayBounds(rawDate)
  const dayMs = 24 * 60 * 60 * 1000
  const events = store.queryActivity(bounds.start, bounds.end)
  const previous = store.queryActivity(bounds.start - dayMs, bounds.start)
  const copies = events.filter(event => event.kind === 'copy')
  const pastes = events.filter(event => event.kind === 'paste')
  const copyCounts = countByPost(copies)
  const uniquePosts = [...new Map(copies.map(event => [event.post.id, event.post])).values()]
  const repeatedIds = [...copyCounts].filter(([, count]) => count > 1).map(([id]) => id)
  const hours = Array.from({ length: 24 }, (_, hour) => ({ hour, count: 0 }))
  for (const event of copies) hours[new Date(event.occurredAt).getHours()].count += 1

  const categoryMap = new Map<ContentCategory, Post[]>()
  for (const post of uniquePosts) {
    const key = classifyPost(post)
    categoryMap.set(key, [...(categoryMap.get(key) ?? []), post])
  }
  const categories = (Object.keys(CATEGORY_LABELS) as ContentCategory[]).map(key => ({
    key,
    label: CATEGORY_LABELS[key],
    count: categoryMap.get(key)?.length ?? 0,
    ids: categoryMap.get(key)?.map(post => post.id) ?? [],
  }))
  const sourceCounts = new Map<string, number>()
  for (const event of copies) {
    const name = event.sourceApp.trim() || '未知来源'
    sourceCounts.set(name, (sourceCounts.get(name) ?? 0) + 1)
  }
  const sources = [...sourceCounts].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 6)
  const sensitiveIds = categoryMap.get('sensitive')?.map(post => post.id) ?? []
  const lowValueIds = uniquePosts.filter(lowValue).map(post => post.id)
  const preciseCopies = copies.filter(event => event.precise).length
  const previousCopies = previous.filter(event => event.kind === 'copy').length
  const savedChars = pastes.reduce((sum, event) => sum + (event.post.preview || event.post.title).length, 0)
  const peak = hours.reduce((best, item) => item.count > best.count ? item : best, hours[0])
  return {
    date: bounds.key,
    ids: uniquePosts.map(post => post.id),
    accuracy: copies.length === 0 || preciseCopies === copies.length ? 'precise' : preciseCopies === 0 ? 'estimated' : 'mixed',
    summary: {
      copies: copies.length,
      unique: uniquePosts.length,
      repeats: Math.max(0, copies.length - uniquePosts.length),
      repeatRate: copies.length > 0 ? Math.round((1 - uniquePosts.length / copies.length) * 1000) / 10 : 0,
      pastes: pastes.length,
      savedChars,
      previousCopies,
      activeHours: hours.filter(item => item.count > 0).length,
      totalBytes: uniquePosts.reduce((sum, post) => sum + post.size, 0),
    },
    hours,
    peak,
    categories,
    sources,
    cleanup: {
      duplicates: { count: repeatedIds.length, ids: repeatedIds },
      sensitive: { count: sensitiveIds.length, ids: sensitiveIds },
      lowValue: { count: lowValueIds.length, ids: lowValueIds },
    },
  }
}

function queryFromUrl(url: URL): PostQuery {
  const query: PostQuery = { limit: Math.min(Number(url.searchParams.get('limit')) || 60, 100) }
  const keyword = url.searchParams.get('keyword')?.trim()
  const type = url.searchParams.get('type')
  const groupId = url.searchParams.get('groupId')
  const cursorAt = Number(url.searchParams.get('cursorAt'))
  const cursorId = url.searchParams.get('cursorId')
  if (keyword) query.keyword = keyword
  if (type && CONTENT_TYPES.has(type as ContentType)) query.type = type as ContentType
  if (groupId) query.groupId = groupId
  if (Number.isFinite(cursorAt) && cursorAt > 0 && cursorId) {
    query.cursor = { lastUsedAt: cursorAt, id: cursorId }
  }
  return query
}

function broadcastRemoved(ids: string[]): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue
    try {
      win.webContents.send(IPC.evtPostsRemoved, ids)
    } catch (e) {
      console.error('[web-manager] broadcast remove failed', e)
    }
  }
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buf.length
    if (size > MAX_BODY_BYTES) throw new Error('request body too large')
    chunks.push(buf)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
}

async function serveFile(res: ServerResponse, name: string, type: string): Promise<void> {
  try {
    const body = await readFile(resolve(STATIC_ROOT, name))
    res.writeHead(200, headers(type))
    res.end(body)
  } catch (e) {
    console.error('[web-manager] static file failed', name, e)
    json(res, 500, { ok: false, error: '页面资源读取失败' })
  }
}

async function handleApi(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  store: ClipStore,
): Promise<boolean> {
  if (req.method === 'GET' && url.pathname === '/api/analytics') {
    json(res, 200, { ok: true, analytics: dailyAnalytics(store, url.searchParams.get('date')) })
    return true
  }
  if (req.method === 'GET' && url.pathname === '/api/status') {
    const counts = store.countByType()
    json(res, 200, { ok: true, counts, total: Object.values(counts).reduce((a, b) => a + b, 0) })
    return true
  }
  if (req.method === 'GET' && url.pathname === '/api/groups') {
    json(res, 200, { ok: true, groups: store.listGroups() })
    return true
  }
  if (req.method === 'GET' && url.pathname === '/api/posts') {
    const page = store.queryPosts(queryFromUrl(url))
    json(res, 200, { ...page, items: page.items.map(publicPost) })
    return true
  }
  if (req.method === 'DELETE' && url.pathname.startsWith('/api/posts/')) {
    const id = decodeURIComponent(url.pathname.slice('/api/posts/'.length))
    if (!id || !store.getPost(id)) {
      json(res, 404, { ok: false, error: '条目不存在' })
      return true
    }
    store.removePost(id)
    broadcastRemoved([id])
    json(res, 200, { ok: true, removed: [id] })
    return true
  }
  if (req.method === 'POST' && url.pathname === '/api/posts/delete') {
    const body = await readJsonBody(req)
    const raw = typeof body === 'object' && body !== null && 'ids' in body
      ? (body as { ids?: unknown }).ids
      : null
    const ids = Array.isArray(raw)
      ? [...new Set(raw.filter((id): id is string => typeof id === 'string' && id.length > 0))]
      : []
    if (ids.length === 0 || ids.length > MAX_BATCH_DELETE) {
      json(res, 400, { ok: false, error: '请选择 1 到 200 条内容' })
      return true
    }
    for (const id of ids) store.removePost(id)
    broadcastRemoved(ids)
    json(res, 200, { ok: true, removed: ids })
    return true
  }
  return false
}

async function route(req: IncomingMessage, res: ServerResponse, store: ClipStore): Promise<void> {
  try {
    const expectedHost = activeUrl ? new URL(activeUrl).host : ''
    if (!expectedHost || req.headers.host !== expectedHost) {
      json(res, 403, { ok: false, error: '仅允许本机管理页访问' })
      return
    }
    const url = new URL(req.url ?? '/', activeUrl || `http://${HOST}`)
    if (await handleApi(req, res, url, store)) return
    if (req.method !== 'GET') {
      json(res, 405, { ok: false, error: '不支持的操作' })
      return
    }
    if (url.pathname === '/' || url.pathname === '/index.html') {
      await serveFile(res, 'index.html', 'text/html; charset=utf-8')
      return
    }
    if (url.pathname === '/app.js') {
      await serveFile(res, 'app.js', 'text/javascript; charset=utf-8')
      return
    }
    if (url.pathname === '/styles.css') {
      await serveFile(res, 'styles.css', 'text/css; charset=utf-8')
      return
    }
    if (url.pathname === '/favicon.png') {
      await serveFile(res, 'favicon.png', 'image/png')
      return
    }
    json(res, 404, { ok: false, error: '页面不存在' })
  } catch (e) {
    console.error('[web-manager] request failed', e)
    json(res, 500, { ok: false, error: '本地服务处理失败' })
  }
}

export function startWebManager(deps: ManagerDeps): WebManagerHandle {
  const server = createServer((req, res) => void route(req, res, deps.store))
  activeServer = server
  activePort = deps.port
  server.on('error', e => {
    console.error('[web-manager] server error', e)
    if (activeServer === server) {
      activeServer = null
      activePort = 0
      activeUrl = ''
    }
  })
  server.listen(deps.port, HOST, () => {
    if (activeServer === server) {
      activeUrl = `http://${HOST}:${deps.port}`
      console.log(`[web-manager] listening on ${activeUrl}`)
    }
  })
  return {
    url: `http://${HOST}:${deps.port}`,
    stop: () => {
      if (activeServer === server) {
        activeServer = null
        activePort = 0
        activeUrl = ''
      }
      server.close(e => {
        if (e) console.error('[web-manager] stop failed', e)
      })
    },
  }
}

export function configureWebManager(store: ClipStore, enabled: boolean, port: number): void {
  if (activeServer && (!enabled || port !== activePort)) {
    const previous = activeServer
    activeServer = null
    activePort = 0
    activeUrl = ''
    previous.close(e => {
      if (e) console.error('[web-manager] stop failed', e)
      if (enabled) startWebManager({ store, port })
    })
    return
  }
  if (enabled && !activeServer) startWebManager({ store, port })
}

export function getWebManagerUrl(): string {
  return activeUrl
}

export async function openWebManager(): Promise<boolean> {
  if (!activeUrl) return false
  try {
    await shell.openExternal(activeUrl)
    return true
  } catch (e) {
    console.error('[web-manager] open browser failed', e)
    return false
  }
}
