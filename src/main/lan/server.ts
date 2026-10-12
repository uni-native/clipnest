import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import dgram from 'node:dgram'
import http from 'node:http'
import { app, BrowserWindow, clipboard, ipcMain, nativeImage } from 'electron'
import type { WebSocket as WsSocket, WebSocketServer as WsServerCtor } from 'ws'
import type { Socket as DgramSocket } from 'node:dgram'
import { IPC } from '@shared/types'
import type { ClipStore, DeepPartial, LanClientInfo, LanStatus, Post, Settings } from '@shared/types'

// 局域网同步：手机桥接 App ↔ PasteMan
// 发现：UDP 48777 广播 probe → announce；配对：PIN 一次性交换长期 token；之后 WS 双向同步剪贴板

const TOKEN_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
const TOKEN_LEN = 8
const PIN_LEN = 6
const DEFAULT_PORT = 48778
const DISCOVERY_PORT = 48777
const HEARTBEAT_MS = 25_000
const STALE_MS = 120_000
// 收到手机 clip 后写入剪贴板会触发本地采集，采集回调里按 hash 命中此表则不再回传（防回环）
const ECHO_WINDOW_MS = 2_000
const RING_LIMIT = 64

interface LanDeps {
  store: ClipStore
}

interface ClientInfo {
  device: string
  address: string
  connectedAt: number
  authed: boolean
  alive: boolean
  failCount: number
}

type WireClip = {
  t: 'clip'
  id: string
  ts: number
  kind: 'text' | 'image-png'
  text?: string
  b64?: string
  hash: string
}
type WireMsg =
  | { t: 'hello'; token: string; device: string }
  | { t: 'pair'; pin: string; device: string }
  | { t: 'ping' }
  | WireClip
type WireOut =
  | { t: 'welcome'; name: string }
  | { t: 'paired'; token: string; name: string }
  | { t: 'auth-fail'; reason: string }
  | { t: 'pong' }
  | { t: 'busy'; reason: string }
  | WireClip

let deps: LanDeps | null = null
let wss: WsServerCtor | null = null
let httpServer: http.Server | null = null
// 重打包输入法通道：手机端内置 HTTP 服务（48779），注册后反向推送
let phonePush: { ip: string; port: number; device: string; at: number } | null = null
let udp: DgramSocket | null = null
let heartbeat: ReturnType<typeof setInterval> | null = null
let panel: BrowserWindow | null = null
const clients = new Map<WsSocket, ClientInfo>()
// 收到端的 capture 域 hash → 收到时刻（notifyLocalCapture 命中则跳过）
const recentRemote = new Map<string, number>()
// 发送端的 wire 域 hash（防自身回环）
const recentSent = new Set<string>()

function loadWs(): typeof WsServerCtor {
  try {
    const req = createRequire(join(app.getAppPath(), 'package.json'))
    return req('ws').WebSocketServer
  } catch {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('ws').WebSocketServer
  }
}

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex')
}

function newToken(): string {
  const bytes = randomBytes(TOKEN_LEN)
  let out = ''
  for (let i = 0; i < TOKEN_LEN; i++) out += TOKEN_CHARS[bytes[i] % TOKEN_CHARS.length]
  return out
}

function newPin(): string {
  let out = ''
  const bytes = randomBytes(PIN_LEN)
  for (let i = 0; i < PIN_LEN; i++) out += String(bytes[i] % 10)
  return out
}

function cfg(): Settings['lanSync'] {
  if (!deps) {
    return {
      enabled: false,
      port: DEFAULT_PORT,
      token: '',
      pin: '',
      deviceName: 'PasteMan-PC',
      sendEnabled: true,
      receiveEnabled: true,
    }
  }
  return deps.store.getSettings().lanSync
}

function savePatch(patch: DeepPartial<Settings['lanSync']>): Settings['lanSync'] {
  if (!deps) return cfg()
  deps.store.saveSettings({ lanSync: patch })
  return cfg()
}

function tokenFingerprint(): string {
  const t = cfg().token
  return t ? sha256(t).slice(0, 8) : ''
}

function send(ws: WsSocket, msg: WireOut): void {
  if (ws.readyState !== 1) return
  ws.send(JSON.stringify(msg))
}

function broadcastStatus(): void {
  if (!panel || panel.isDestroyed()) return
  panel.webContents.send(IPC.evtLanStatus, getStatus())
}

function getStatus(): LanStatus {
  const c = cfg()
  const list: LanClientInfo[] = []
  for (const info of clients.values()) {
    if (info.authed) list.push({ device: info.device, address: info.address, connectedAt: info.connectedAt })
  }
  return {
    enabled: c.enabled,
    listening: !!wss,
    port: c.port,
    token: c.token,
    pin: c.pin,
    deviceName: c.deviceName,
    sendEnabled: c.sendEnabled,
    receiveEnabled: c.receiveEnabled,
    clients: list,
  }
}

// ---------- 服务端 ----------

function onConnection(ws: WsSocket): void {
  const req = (ws as unknown as { _socket?: { remoteAddress?: string } })._socket
  const info: ClientInfo = {
    device: '',
    address: req?.remoteAddress?.replace('::ffff:', '') ?? '',
    connectedAt: Date.now(),
    authed: false,
    alive: true,
    failCount: 0,
  }
  clients.set(ws, info)
  console.log('[lan] client connected', info.address)

  ws.on('pong', () => {
    info.alive = true
  })

  ws.on('message', raw => {
    let msg: WireMsg
    try {
      msg = JSON.parse(String(raw)) as WireMsg
    } catch {
      return
    }
    try {
      handleMessage(ws, info, msg)
    } catch (e) {
      console.error('[lan] handle message failed', e)
    }
  })

  ws.on('close', () => {
    clients.delete(ws)
    console.log('[lan] client closed', info.device || info.address)
    broadcastStatus()
  })
  ws.on('error', e => {
    console.warn('[lan] client error', info.device || info.address, String(e))
  })
}

function handleMessage(ws: WsSocket, info: ClientInfo, msg: WireMsg): void {
  if (!info.authed) {
    if (msg.t === 'hello') {
      if (msg.token === cfg().token && cfg().token.length > 0) {
        info.authed = true
        info.device = (msg.device || 'phone').slice(0, 40)
        send(ws, { t: 'welcome', name: cfg().deviceName })
        console.log('[lan] paired-in', info.device, info.address)
        broadcastStatus()
      } else {
        send(ws, { t: 'auth-fail', reason: 'token' })
        ws.close()
      }
    } else if (msg.t === 'pair') {
      if (cfg().pin.length > 0 && msg.pin === cfg().pin) {
        info.authed = true
        info.device = (msg.device || 'phone').slice(0, 40)
        send(ws, { t: 'paired', token: cfg().token, name: cfg().deviceName })
        console.log('[lan] paired via pin', info.device, info.address)
        broadcastStatus()
      } else {
        info.failCount += 1
        send(ws, { t: 'auth-fail', reason: 'pin' })
        if (info.failCount >= 3) ws.close()
      }
    }
    return
  }

  switch (msg.t) {
    case 'ping':
      send(ws, { t: 'pong' })
      return
    case 'clip':
      onRemoteClip(msg)
      return
    default:
      return
  }
}

// ---------- 接收（手机 → PC） ----------

function onRemoteClip(msg: WireClip): void {
  const c = cfg()
  if (!c.enabled || !c.receiveEnabled) return
  if (recentSent.has(msg.hash)) return // 手机把 PC 刚发的内容回传了
  recentRemote.set(msg.hash, Date.now())
  trimRing(recentRemote)
  try {
    if (msg.kind === 'text' && typeof msg.text === 'string') {
      clipboard.writeText(msg.text)
      // capture 域 hash 与 normalizeText 的 sha256(plain) 对齐，采集回调据此跳过回传
    } else if (msg.kind === 'image-png' && typeof msg.b64 === 'string') {
      const bytes = Buffer.from(msg.b64, 'base64')
      const dataUrl = `data:image/png;base64,${msg.b64}`
      recentRemote.set(sha256(dataUrl), Date.now())
      const image = nativeImage.createFromBuffer(bytes)
      if (!image.isEmpty()) clipboard.writeImage(image)
    }
    console.log('[lan] received clip', msg.kind, msg.hash.slice(0, 12))
  } catch (e) {
    console.error('[lan] apply remote clip failed', e)
  }
}

function trimRing(map: Map<string, number>): void {
  if (map.size <= RING_LIMIT) return
  const keys = [...map.keys()]
  for (const k of keys.slice(0, keys.length - RING_LIMIT)) map.delete(k)
}

// ---------- 发送（PC → 手机） ----------

function readPostPayload(post: Post): { kind: 'text' | 'image-png'; text?: string; b64?: string } | null {
  try {
    if (post.type === 'image') {
      if (!post.contentPath) return null
      const bytes = readFileSync(post.contentPath)
      return { kind: 'image-png', b64: bytes.toString('base64') }
    }
    if (post.type === 'text' || post.type === 'link') {
      let text = post.preview
      if (post.contentPath) {
        try {
          text = readFileSync(post.contentPath, 'utf8')
        } catch {
          // 留用 preview
        }
      }
      if (!text.trim()) return null
      return { kind: 'text', text }
    }
    return null // file/folder 暂不同步
  } catch (e) {
    console.error('[lan] read post payload failed', e)
    return null
  }
}

export function notifyLocalCapture(post: Post): void {
  const c = cfg()
  if (!c.enabled || !c.sendEnabled || !wss) return
  const hitAt = recentRemote.get(post.hash)
  if (hitAt !== undefined) {
    if (Date.now() - hitAt < ECHO_WINDOW_MS) return // 来自手机的回显，不再发回去
    recentRemote.delete(post.hash)
  }
  const payload = readPostPayload(post)
  if (!payload) return
  const wireHash = sha256(payload.kind === 'text' ? (payload.text ?? '') : `png:${payload.b64 ?? ''}`)
  if (recentSent.has(wireHash)) return
  recentSent.add(wireHash)
  if (recentSent.size > RING_LIMIT) {
    const first = recentSent.values().next().value
    if (first) recentSent.delete(first)
  }
  const msg: WireClip = {
    t: 'clip',
    id: randomUUID(),
    ts: Date.now(),
    kind: payload.kind,
    text: payload.text,
    b64: payload.b64,
    hash: wireHash,
  }
  const raw = JSON.stringify(msg)
  let n = 0
  for (const [ws, info] of clients) {
    if (!info.authed) continue
    if (ws.readyState === 1) {
      ws.send(raw)
      n += 1
    }
  }
  if (n > 0) console.log('[lan] sent clip', payload.kind, wireHash.slice(0, 12), 'to', n)
  recordPending(msg)
  // 重打包输入法通道：HTTP 反向推送（直连可达时的快路径；不可达靠长轮询兜底）
  void pushClipToPhone(msg)
}

// ---------- UDP 自动发现 ----------

function startDiscovery(): void {
  try {
    udp = dgram.createSocket('udp4')
    udp.on('error', e => {
      console.warn('[lan] discovery udp error', String(e))
      try {
        udp?.close()
      } catch {
        // 已关
      }
      udp = null
    })
    udp.on('message', (buf, rinfo) => {
      try {
        const probe = JSON.parse(buf.toString('utf8')) as { t?: string }
        if (probe?.t !== 'pasteman-probe') return
        const c = cfg()
        if (!c.enabled) return
        const announce = Buffer.from(
          JSON.stringify({
            t: 'pasteman-announce',
            name: c.deviceName,
            port: c.port,
            fp: tokenFingerprint(),
          }),
        )
        udp?.send(announce, rinfo.port, rinfo.address)
      } catch {
        // 非 JSON 探测包，忽略
      }
    })
    udp.bind(DISCOVERY_PORT, () => {
      try {
        udp?.setBroadcast(true)
      } catch {
        // 部分平台不支持
      }
      console.log('[lan] discovery listening on udp', DISCOVERY_PORT)
    })
  } catch (e) {
    console.warn('[lan] discovery unavailable', e)
  }
}

// ---------- 生命周期 ----------

function startHeartbeat(): void {
  stopHeartbeat()
  heartbeat = setInterval(() => {
    for (const [ws, info] of clients) {
      if (!info.alive) {
        try {
          ws.terminate()
        } catch {
          // 已断
        }
        clients.delete(ws)
        continue
      }
      info.alive = false
      try {
        ws.ping()
      } catch {
        // 断开由 close 处理
      }
      if (Date.now() - info.connectedAt > STALE_MS && !info.authed) {
        try {
          ws.close()
        } catch {
          // 已断
        }
      }
    }
  }, HEARTBEAT_MS)
}

function stopHeartbeat(): void {
  if (heartbeat) {
    clearInterval(heartbeat)
    heartbeat = null
  }
}

function listen(port: number): void {
  const WSS = loadWs()
  // 同端口双通道：WS（桥 App）+ HTTP（重打包输入法 /clip /register /ping）
  httpServer = http.createServer((req, res) => {
    void handleHttpRequest(req, res)
  })
  wss = new WSS({ server: httpServer })
  wss.on('connection', onConnection)
  wss.on('error', e => {
    console.error('[lan] server error', e)
  })
  wss.on('listening', () => {
    console.log('[lan] ws listening on', port)
    broadcastStatus()
  })
  httpServer.on('error', e => {
    console.error('[lan] http server error', e)
  })
  httpServer.listen(port, '0.0.0.0')
  startDiscovery()
  startHeartbeat()
}

function stopServer(): void {
  stopHeartbeat()
  if (udp) {
    try {
      udp.close()
    } catch {
      // 已关
    }
    udp = null
  }
  if (wss) {
    try {
      wss.close()
    } catch {
      // 已关
    }
    wss = null
  }
  if (httpServer) {
    try {
      httpServer.close()
    } catch {
      // 已关
    }
    httpServer = null
  }
  phonePush = null
  clients.clear()
}

// ---------- HTTP 通道（重打包输入法） ----------

const MAX_HTTP_BODY = 12 * 1024 * 1024

// 长轮询待取队列：本地新捕获的 clip 供输入法冷启动补拉/长轮询（穿透单向隔离）
const pendingClips: WireClip[] = []
let pendingWaiters: Array<() => void> = []

function recordPending(msg: WireClip): void {
  pendingClips.push(msg)
  if (pendingClips.length > 20) pendingClips.shift()
  const waiters = pendingWaiters
  pendingWaiters = []
  for (const w of waiters) w()
}

async function handleHttpRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  try {
    if (req.method !== 'POST') {
      const url = req.url ?? ''
      if (req.method === 'GET' && url.startsWith('/ping')) {
        res.writeHead(200, { 'Content-Type': 'text/plain' })
        res.end('ok')
        return
      }
      if (req.method === 'GET' && url.startsWith('/pending')) {
        const token = (req.headers['x-token'] as string | undefined) ?? ''
        if (token !== cfg().token) {
          res.writeHead(403)
          res.end()
          return
        }
        const u = new URL(url, 'http://local')
        const after = Number(u.searchParams.get('after') ?? 0) || 0
        const wantWait = u.searchParams.get('wait') === '1'
        const pick = (): WireClip[] => pendingClips.filter(p => p.ts > after)
        let clips = pick()
        if (clips.length === 0 && wantWait) {
          await new Promise<void>(resolve => {
            const timer = setTimeout(done, 25_000)
            function done(): void {
              clearTimeout(timer)
              resolve()
            }
            pendingWaiters.push(done)
          })
          clips = pick()
        }
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ t: 'pending', now: Date.now(), clips }))
        return
      }
      res.writeHead(404)
      res.end()
      return
    }
    const token = (req.headers['x-token'] as string | undefined) ?? ''
    if (token !== cfg().token) {
      res.writeHead(403)
      res.end()
      return
    }
    const len = Number(req.headers['content-length'] ?? 0)
    if (!Number.isFinite(len) || len < 0 || len > MAX_HTTP_BODY) {
      res.writeHead(413)
      res.end()
      return
    }
    const chunks: Buffer[] = []
    let got = 0
    for await (const c of req) {
      chunks.push(c as Buffer)
      got += (c as Buffer).length
      if (got > MAX_HTTP_BODY) {
        res.writeHead(413)
        res.end()
        return
      }
    }
    const body = Buffer.concat(chunks).toString('utf8')
    const ip = (req.socket.remoteAddress ?? '').replace('::ffff:', '')
    let msg: Record<string, unknown>
    try {
      msg = JSON.parse(body) as Record<string, unknown>
    } catch {
      res.writeHead(400)
      res.end()
      return
    }

    if ((req.url ?? '').startsWith('/register')) {
      phonePush = {
        ip,
        port: Number(msg.port) || 48779,
        device: String(msg.device ?? 'wetype-ime').slice(0, 40),
        at: Date.now(),
      }
      console.log('[lan] ime registered', phonePush.device, phonePush.ip, phonePush.port)
      broadcastStatus()
      res.writeHead(204)
      res.end()
      return
    }

    if ((req.url ?? '').startsWith('/clip')) {
      // /clip 顺带刷新注册（输入法每次发送都会带 port）
      const port = Number(msg.port) || phonePush?.port || 48779
      phonePush = { ip, port, device: String(msg.device ?? phonePush?.device ?? 'wetype-ime').slice(0, 40), at: Date.now() }
      const kind = msg.kind === 'image-png' ? 'image-png' : 'text'
      const text = typeof msg.text === 'string' ? msg.text : undefined
      const b64 = typeof msg.b64 === 'string' ? msg.b64 : undefined
      if ((kind === 'text' && !text) || (kind === 'image-png' && !b64)) {
        res.writeHead(400)
        res.end()
        return
      }
      onRemoteClip({
        t: 'clip',
        id: typeof msg.id === 'string' ? msg.id : randomUUID(),
        ts: Date.now(),
        kind,
        text,
        b64,
        hash: typeof msg.hash === 'string' ? msg.hash : sha256(kind === 'text' ? (text ?? '') : `png:${b64 ?? ''}`),
      })
      res.writeHead(204)
      res.end()
      return
    }

    res.writeHead(404)
    res.end()
  } catch (e) {
    console.error('[lan] http request failed', e)
    try {
      res.writeHead(500)
      res.end()
    } catch {
      // 连接已断
    }
  }
}

async function pushClipToPhone(msg: WireClip): Promise<void> {
  const p = phonePush
  if (!p) return
  if (Date.now() - p.at > 30 * 60_000) {
    phonePush = null
    return
  }
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 5000)
    const resp = await fetch(`http://${p.ip}:${p.port}/clip`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Token': cfg().token },
      body: JSON.stringify(msg),
      signal: ctrl.signal,
    })
    clearTimeout(timer)
    if (!resp.ok) {
      console.warn('[lan] push to ime', p.ip, '->', resp.status)
    }
  } catch (e) {
    console.warn('[lan] push to ime failed', (e as Error).message)
  }
}

function attachPanel(next: BrowserWindow | null): void {
  panel = next
}

export interface LanSyncHandle {
  stop(): void
  notifyLocalCapture(post: Post): void
}

export function startLanSync(next: LanDeps & { panel?: BrowserWindow }): LanSyncHandle {
  deps = next
  attachPanel(next.panel ?? null)

  const c = cfg()
  if (!c.token) savePatch({ token: newToken() })
  if (!c.pin) savePatch({ pin: newPin() })

  if (cfg().enabled) listen(cfg().port)

  return {
    stop: () => {
      stopServer()
      deps = null
    },
    notifyLocalCapture,
  }
}

export function getLanStatus(): LanStatus {
  return getStatus()
}

export function setLanConfig(patch: DeepPartial<Settings['lanSync']>): LanStatus {
  const prev = cfg()
  const next = savePatch(patch)
  const portChanged = patch.port !== undefined && patch.port !== prev.port
  const enabledChanged = patch.enabled !== undefined && patch.enabled !== prev.enabled

  if (enabledChanged || portChanged) {
    stopServer()
    if (next.enabled) listen(next.port)
  }
  console.log('[lan] config updated', { enabled: next.enabled, port: next.port })
  broadcastStatus()
  return getStatus()
}

export function regenerateLanToken(): string {
  const token = newToken()
  savePatch({ token })
  console.log('[lan] token regenerated')
  broadcastStatus()
  return token
}

export function regenerateLanPin(): string {
  const pin = newPin()
  savePatch({ pin })
  console.log('[lan] pin regenerated')
  broadcastStatus()
  return pin
}

// ipc/index.ts 注册用（保持与 bridge 一致的调用风格）
export function registerLanIpc(): void {
  ipcMain.handle(IPC.lanStatus, (): LanStatus => getStatus())
  ipcMain.handle(IPC.lanSetConfig, (_e, patch: DeepPartial<Settings['lanSync']>): LanStatus => {
    try {
      return setLanConfig(patch ?? {})
    } catch (e) {
      console.error('[ipc] lanSetConfig failed', e)
      return getStatus()
    }
  })
  ipcMain.handle(IPC.lanRegenerateToken, (): string => {
    try {
      return regenerateLanToken()
    } catch (e) {
      console.error('[ipc] lanRegenerateToken failed', e)
      return ''
    }
  })
  ipcMain.handle(IPC.lanRegeneratePin, (): string => {
    try {
      return regenerateLanPin()
    } catch (e) {
      console.error('[ipc] lanRegeneratePin failed', e)
      return ''
    }
  })
}
