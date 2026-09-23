import { randomBytes } from 'node:crypto'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { app, BrowserWindow } from 'electron'
import { WebSocketServer as BundledWebSocketServer } from 'ws'
import type { WebSocket, WebSocketServer } from 'ws'
import { IPC } from '@shared/types'
import type {
  AppToExtMessage,
  BrowserStatus,
  ClipStore,
  DeepPartial,
  ExtToAppMessage,
  FieldCtx,
  PageCtx,
  Settings,
} from '@shared/types'
import type { JevPipeline } from '@main/intelligence/jev'
import { detectSensitiveField } from '@main/intelligence/matchers'

   
                                             
                                                           
                                                
   

export interface BridgeDeps {
  store: ClipStore
  panel: BrowserWindow
  jev: JevPipeline
}

                                                             
type IncomingMessage = ExtToAppMessage | { t: 'pong' }

                                                                 
type OutgoingMessage = AppToExtMessage | { t: 'ping' }

const HEARTBEAT_MS = 25_000
const STALE_MS = 180_000
const WATCHDOG_TICK_MS = 5_000
const PING_TIMEOUT_MS = 2_000
const TOKEN_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
const TOKEN_LEN = 8
const DEFAULT_PORT = 9377

let deps: BridgeDeps | null = null
let wss: WebSocketServer | null = null
let client: WebSocket | null = null
let clientInfo: BrowserStatus['client'] = null
let lastMsgAt = 0
let heartbeat: NodeJS.Timeout | null = null
let watchdog: NodeJS.Timeout | null = null
let reqSeq = 0
let pingWait: ((ok: boolean) => void) | null = null
const activeFocusIds = new WeakMap<WebSocket, string>()

   
                                                                   
                                                     
                                    
   
const nodeRequire = createRequire(join(app.getAppPath(), 'package.json'))
let WebSocketServerCtor: typeof BundledWebSocketServer
try {
  WebSocketServerCtor = (nodeRequire('ws') as typeof import('ws')).WebSocketServer
} catch (e) {
  console.error('[bridge] runtime require ws failed, fallback to bundled', e)
  WebSocketServerCtor = BundledWebSocketServer
}

                                                                              

function browserSettings(): Settings['browser'] {
  return deps?.store.getSettings().browser ?? {
    enabled: false,
    port: DEFAULT_PORT,
    token: '',
    autoFill: true,
    sensitiveFill: {
      cardNumber: false,
      cardSecurityCode: false,
      cardExpiry: false,
      password: false,
      verificationCode: false,
    },
  }
}

export function getBrowserStatus(): BrowserStatus {
  const b = browserSettings()
  return {
    connected: client !== null && clientInfo !== null,
    port: b.port,
    token: b.token,
    autoFill: b.autoFill,
    enabled: b.enabled,
    client: clientInfo,
  }
}

export function pushBrowserStatus(panel: BrowserWindow): void {
  if (!panel || panel.isDestroyed()) return
  try {
    panel.webContents.send(IPC.evtBrowserStatus, getBrowserStatus())
  } catch (e) {
    console.error('[bridge] push status failed', e)
  }
}

                                      
function broadcastToAllWindows(): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (w.isDestroyed()) continue
    try {
      w.webContents.send(IPC.evtBrowserStatus, getBrowserStatus())
    } catch {
                  
    }
  }
}

function broadcastStatus(): void {
  broadcastToAllWindows()
}

function valueForField(field: FieldCtx, value: string): string {
  const autocomplete = (field.autocomplete ?? '').toLowerCase()
  const match = value.trim().match(/^(0?[1-9]|1[0-2])\s*[/.-]\s*(\d{2}|\d{4})$/)
  if (!match) return value
  if (/(?:^|\s)cc-exp-month(?:\s|$)/.test(autocomplete)) return match[1].padStart(2, '0')
  if (/(?:^|\s)cc-exp-year(?:\s|$)/.test(autocomplete)) return match[2]
  return value
}

                                                                              

function send(ws: WebSocket, msg: OutgoingMessage): void {
  if (ws.readyState !== 1) return
  try {
    ws.send(JSON.stringify(msg))
  } catch (e) {
    console.error('[bridge] send failed', e)
  }
}

function nextReqId(): string {
  reqSeq += 1
  return `jev-${Date.now().toString(36)}-${reqSeq}`
}

                                                                                

function clearTimers(): void {
  if (heartbeat) {
    clearInterval(heartbeat)
    heartbeat = null
  }
  if (watchdog) {
    clearInterval(watchdog)
    watchdog = null
  }
}

function dropClient(): void {
  const ws = client
  client = null
  clientInfo = null
  pingWait = null
  if (ws && ws.readyState <= 1) {
    try {
      ws.close()
    } catch {
                  
    }
  }
  broadcastStatus()
}

function startTimers(): void {
  clearTimers()
  heartbeat = setInterval(() => {
    if (client && client.readyState === 1) send(client, { t: 'ping' })
  }, HEARTBEAT_MS)
  watchdog = setInterval(() => {
    if (client && Date.now() - lastMsgAt > STALE_MS) {
      console.warn('[bridge] client silent >180s, drop connection')
      dropClient()
    }
  }, WATCHDOG_TICK_MS)
}

function stopServer(): void {
  clearTimers()
  pingWait = null
  const ws = client
  client = null
  clientInfo = null
  if (ws) {
    try {
      ws.terminate()
    } catch {
                  
    }
  }
  const server = wss
  wss = null
  if (server) {
    server.clients.forEach(c => {
      try {
        c.terminate()
      } catch {
                    
      }
    })
    try {
      server.close()
    } catch {
                  
    }
  }
}

function listen(port: number): void {
  if (wss) return
  const server = new WebSocketServerCtor({ host: '127.0.0.1', port })
  server.on('connection', (ws, req) => {
    console.log('[bridge] 客户端连入', req.socket.remoteAddress, 'port', req.socket.remotePort)
    onConnection(ws)
  })
  server.on('error', e => console.error('[bridge] ws server error', e))
  server.on('listening', () => console.log(`[bridge] listening on ws://127.0.0.1:${port}`))
  wss = server
  startTimers()
}

                                                                                

async function handleFieldFocus(
  ws: WebSocket,
  focusId: string,
  field: FieldCtx,
  page: PageCtx,
): Promise<void> {
  const jev = deps?.jev
  if (!jev) return
  const startedAt = Date.now()
  console.log('[bridge] field-focus', {
    focusId,
    fieldId: field.id,
    type: field.type,
    label: field.label,
    host: page.host,
    inputLength: field.value.length,
  })
  try {
    const result = await jev.handleFieldFocus(field, page, focusId)
    if (activeFocusIds.get(ws) !== focusId) {
      console.warn('[bridge] stale field result dropped', {
        focusId,
        fieldId: field.id,
        action: result.action,
        elapsedMs: Date.now() - startedAt,
      })
      return
    }
    const sensitiveKind = detectSensitiveField(field)
    const allowSensitive = sensitiveKind
      ? browserSettings().sensitiveFill[sensitiveKind] === true
      : false
    if (result.action === 'fill') {
      send(ws, {
        t: 'fill',
        reqId: nextReqId(),
        focusId,
        value: valueForField(field, result.value),
        mode: 'replace',
        allowSensitive,
      })
    } else if (result.action === 'suggest') {
      send(ws, {
        t: 'suggest',
        reqId: nextReqId(),
        focusId,
        items: result.items.map(item => ({ ...item, value: valueForField(field, item.value) })),
        allowSensitive,
      })
    }
    console.log('[bridge] field decision sent', {
      focusId,
      fieldId: field.id,
      action: result.action,
      itemCount: result.action === 'suggest' ? result.items.length : result.action === 'fill' ? 1 : 0,
      elapsedMs: Date.now() - startedAt,
    })
  } catch (e) {
    console.error('[bridge] jev pipeline failed', { focusId, fieldId: field.id, error: e })
  }
}

function onMessage(ws: WebSocket, authed: { ok: boolean }, raw: unknown): void {
  lastMsgAt = Date.now()
  let msg: IncomingMessage
  try {
    msg = JSON.parse(String(raw)) as IncomingMessage
  } catch {
    return
  }
  if (!msg || typeof msg.t !== 'string') return

  if (!authed.ok) {
                                    
    if (msg.t !== 'hello') {
      send(ws, { t: 'auth-fail', reason: 'first message must be hello' })
      ws.close()
      return
    }
    if (msg.token !== browserSettings().token) {
      send(ws, { t: 'auth-fail', reason: 'token mismatch' })
      ws.close()
      return
    }
    authed.ok = true
                            
    if (client && client !== ws) {
      const old = client
      client = null
      clientInfo = null
      try {
        old.close()
      } catch {
                    
      }
    }
    client = ws
    clientInfo = { ua: msg.ua, extVersion: msg.extVersion, connectedAt: Date.now() }
    send(ws, { t: 'welcome', app: app.getName(), version: app.getVersion() })
    broadcastStatus()
    return
  }

  switch (msg.t) {
    case 'ping':
      send(ws, { t: 'pong' })
      break
    case 'pong': {
      const wait = pingWait
      pingWait = null
      wait?.(true)
      break
    }
    case 'field-focus':
      activeFocusIds.set(ws, msg.focusId)
      void handleFieldFocus(ws, msg.focusId, msg.field, msg.page)
      break
    case 'fill-result':
      console.log('[bridge] fill-result', msg.reqId, msg.ok, msg.err ?? '')
      break
    case 'field-blur':
      activeFocusIds.delete(ws)
      break
    default:
      break
  }
}

function onConnection(ws: WebSocket): void {
  const authed = { ok: false }
  lastMsgAt = Date.now()
  ws.on('message', (raw: unknown) => onMessage(ws, authed, raw))
  ws.on('close', () => {
    activeFocusIds.delete(ws)
    if (client === ws) dropClient()
  })
  ws.on('error', e => console.error('[bridge] client socket error', e))
}

                                                                                  

                                               
export function bindBridgeDeps(next: BridgeDeps): void {
  deps = next
}

export function startBrowserBridge(next: BridgeDeps): { stop(): void } {
  deps = next
  const b = next.store.getSettings().browser
                                  
  if (!b.token) {
    const token = newToken()
    next.store.saveSettings({ browser: { token } })
    b.token = token
    console.log('[bridge] 已自动生成连接令牌')
  }
  if (b.enabled && !wss) listen(b.port)
  return { stop: stopBridge }
}

function stopBridge(): void {
  stopServer()
  deps = null
}

                                         
export function setBridgeConfig(patch: DeepPartial<Settings['browser']>): BrowserStatus {
  const fallback: BrowserStatus = {
    connected: false,
    port: DEFAULT_PORT,
    token: '',
    autoFill: true,
    enabled: false,
    client: null,
  }
  if (!deps) return fallback
  const prev = deps.store.getSettings().browser
  const clean: DeepPartial<Settings['browser']> = {}
  if (patch.enabled !== undefined) clean.enabled = Boolean(patch.enabled)
  if (patch.autoFill !== undefined) clean.autoFill = Boolean(patch.autoFill)
  if (patch.token !== undefined) clean.token = String(patch.token)
  if (patch.port !== undefined) {
    const p = Math.floor(Number(patch.port))
    if (Number.isFinite(p) && p > 0 && p <= 65535) clean.port = p
  }
  const next = deps.store.saveSettings({ browser: clean })
  const portChanged = next.browser.port !== prev.port
  if (next.browser.enabled) {
    if (!wss || portChanged) {
      stopServer()
      listen(next.browser.port)
    }
  } else if (wss) {
    stopServer()
  }
  broadcastStatus()
  return getBrowserStatus()
}

function newToken(): string {
  const bytes = randomBytes(TOKEN_LEN)
  let out = ''
  for (let i = 0; i < TOKEN_LEN; i++) out += TOKEN_CHARS[bytes[i] % TOKEN_CHARS.length]
  return out
}

                                  
export function regenerateToken(): string {
  const token = newToken()
  if (deps) {
    deps.store.saveSettings({ browser: { token } })
    broadcastStatus()
  }
  return token
}

                                          
export function pingClient(): Promise<boolean> {
  const ws = client
  if (!ws || ws.readyState !== 1) return Promise.resolve(false)
  return new Promise<boolean>(resolve => {
    const done = (ok: boolean): void => {
      clearTimeout(timer)
      resolve(ok)
    }
    const timer = setTimeout(() => {
      if (pingWait === done) {
        pingWait = null
        resolve(false)
      }
    }, PING_TIMEOUT_MS)
    pingWait = done
    send(ws, { t: 'ping' })
  })
}
