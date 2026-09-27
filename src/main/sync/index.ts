import { randomBytes, randomUUID } from 'node:crypto'
import { hostname } from 'node:os'
import { WebSocket, WebSocketServer, type RawData } from 'ws'
import type { ClipStore, Post, Settings, SyncPeer, SyncStatus, SyncedPostPayload } from '@shared/types'
import { markSelfWrite } from '@main/capture'
import { encodeSyncedPost, decodeSyncedPost } from './payload'
import { decryptMessage, deriveSyncKey, encryptMessage, groupFingerprint } from './crypto'
import { startDiscovery, type DiscoveryHandle } from './discovery'

const MAX_WS_PAYLOAD_BYTES = 8 * 1024 * 1024
const PEER_TIMEOUT_MS = 15_000
const SWEEP_INTERVAL_MS = 2500
const SEEN_LIMIT = 2048
const DEVICE_ID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i

interface PeerRecord extends SyncPeer {
  socket: WebSocket | null
  authenticated: boolean
  lastSeen: number
}

interface SocketSession {
  socket: WebSocket
  address: string
  expectedDeviceId: string | null
  peer: PeerRecord | null
}

interface WireHello {
  kind: 'hello'
  deviceId: string
  deviceName: string
  protocol: 1
}

interface WirePost {
  kind: 'post'
  payload: SyncedPostPayload
}

export interface LanSyncController {
  configure(settings: Settings['sync']): void
  getStatus(): SyncStatus
  publish(post: Post): void
  stop(): void
}

function ensureIdentity(store: ClipStore): Settings['sync'] {
  const current = store.getSettings().sync
  const patch: Partial<Settings['sync']> = {}
  if (!current.deviceId) patch.deviceId = randomUUID()
  if (!current.deviceName) patch.deviceName = hostname().slice(0, 48) || 'ClipNest'
  if (!current.secret) patch.secret = randomBytes(32).toString('hex')
  if (Object.keys(patch).length > 0) store.saveSettings({ sync: patch })
  return store.getSettings().sync
}

export function startLanSync(
  store: ClipStore,
  onReceived: (post: Post, created: boolean) => void,
  onStatus: (status: SyncStatus) => void,
): LanSyncController {
  const identity = ensureIdentity(store)
  return new LanSyncService(store, identity, onReceived, onStatus)
}

class LanSyncService implements LanSyncController {
  private settings: Settings['sync']
  private key: Buffer | null = null
  private server: WebSocketServer | null = null
  private discovery: DiscoveryHandle | null = null
  private sweep: ReturnType<typeof setInterval> | null = null
  private readonly peers = new Map<string, PeerRecord>()
  private readonly sessions = new Map<WebSocket, SocketSession>()
  private readonly seen = new Set<string>()
  private readonly seenOrder: string[] = []
  private queue: Promise<void> = Promise.resolve()
  private revision = 0
  private enabled = false
  private listening = false
  private lastError: string | null = null

  constructor(
    private readonly store: ClipStore,
    settings: Settings['sync'],
    private readonly onReceived: (post: Post, created: boolean) => void,
    private readonly onStatus: (status: SyncStatus) => void,
  ) {
    this.settings = settings
    this.configure(settings)
  }

  configure(settings: Settings['sync']): void {
    this.settings = settings
    const revision = ++this.revision
    this.queue = this.queue.then(() => this.applySettings(settings, revision))
      .catch(error => this.reportError('同步设置应用失败', error))
  }

  getStatus(): SyncStatus {
    const peers = [...this.peers.values()]
      .sort((a, b) => a.deviceName.localeCompare(b.deviceName))
      .map(peer => ({
        deviceId: peer.deviceId,
        deviceName: peer.deviceName,
        address: peer.address,
        port: peer.port,
        connected: peer.authenticated && peer.socket?.readyState === WebSocket.OPEN,
      }))
    return {
      enabled: this.enabled,
      listening: this.listening,
      port: this.settings.port,
      deviceName: this.settings.deviceName,
      peers,
      lastError: this.lastError,
    }
  }

  publish(post: Post): void {
    if (!this.enabled || post.sourceDevice) return
    let payload: SyncedPostPayload | null
    try {
      payload = encodeSyncedPost(post, this.settings.deviceId, this.settings.deviceName)
    } catch (e) {
      this.reportError('剪贴板内容未能同步', e)
      return
    }
    if (!payload) {
      console.info('[sync] 文件和文件夹路径保留在本机', post.id)
      return
    }
    this.sendToPeers({ kind: 'post', payload })
  }

  stop(): void {
    const revision = ++this.revision
    this.queue = this.queue.then(async () => {
      if (revision === this.revision) await this.closeNetwork()
    }).catch(error => this.reportError('停止局域网同步失败', error))
  }

  private async applySettings(settings: Settings['sync'], revision: number): Promise<void> {
    await this.closeNetwork()
    if (revision !== this.revision) return
    this.settings = settings
    if (!settings.enabled) {
      this.enabled = false
      this.emitStatus()
      return
    }
    if (!this.validSettings(settings)) return
    try {
      this.key = deriveSyncKey(settings.secret)
      this.server = await this.listen(settings.port)
      if (revision !== this.revision) return this.closeNetwork()
      this.enabled = true
      this.listening = true
      this.discovery = startDiscovery(
        settings.port,
        () => this.announcement(),
        (message, address) => this.acceptAnnouncement(message, address),
        error => this.reportError('局域网设备发现失败', error),
      )
      this.sweep = setInterval(() => this.removeStalePeers(), SWEEP_INTERVAL_MS)
      this.clearError()
      this.emitStatus()
      console.log('[sync] listening on port', settings.port, 'as', settings.deviceName)
    } catch (e) {
      await this.closeNetwork()
      this.reportError('无法启动局域网同步', e)
    }
  }

  private validSettings(settings: Settings['sync']): boolean {
    if (!DEVICE_ID_PATTERN.test(settings.deviceId)) {
      this.reportError('同步设备标识无效')
      return false
    }
    if (!Number.isInteger(settings.port) || settings.port < 1 || settings.port > 65535) {
      this.reportError('同步端口必须在 1 到 65535 之间')
      return false
    }
    if (settings.deviceName.trim().length === 0 || settings.deviceName.length > 48) {
      this.reportError('设备名称需要在 1 到 48 个字符之间')
      return false
    }
    if (settings.secret.trim().length < 32) {
      this.reportError('同步口令至少需要 32 个字符')
      return false
    }
    return true
  }

  private listen(port: number): Promise<WebSocketServer> {
    return new Promise((resolve, reject) => {
      const server = new WebSocketServer({
        host: '0.0.0.0',
        port,
        maxPayload: MAX_WS_PAYLOAD_BYTES,
        perMessageDeflate: false,
      })
      this.attachServer(server)
      const onError = (error: Error): void => reject(error)
      server.once('listening', () => {
        server.off('error', onError)
        resolve(server)
      })
      server.once('error', onError)
    })
  }

  private attachServer(server: WebSocketServer): void {
    server.on('connection', (socket, request) => {
      const address = request.socket.remoteAddress ?? ''
      if (!isLanAddress(address)) {
        socket.close(1008, 'LAN only')
        return
      }
      this.attachSocket(socket, address, null)
    })
    server.on('error', error => this.reportError('同步服务发生错误', error))
  }

  private attachSocket(socket: WebSocket, address: string, expectedDeviceId: string | null): void {
    const session: SocketSession = { socket, address, expectedDeviceId, peer: null }
    this.sessions.set(socket, session)
    socket.on('open', () => this.sendHello(session))
    socket.on('message', (data, binary) => this.receiveMessage(session, data, binary))
    socket.on('close', () => this.removeSession(session))
    socket.on('error', error => this.reportError('同步连接发生错误', error))
    if (socket.readyState === WebSocket.OPEN) this.sendHello(session)
  }

  private sendHello(session: SocketSession): void {
    this.sendEncrypted(session, {
      kind: 'hello',
      deviceId: this.settings.deviceId,
      deviceName: this.settings.deviceName,
      protocol: 1,
    } satisfies WireHello)
  }

  private receiveMessage(session: SocketSession, data: RawData, binary: boolean): void {
    try {
      if (binary) throw new Error('不支持二进制同步帧')
      const key = this.key
      if (!key) throw new Error('同步加密密钥不可用')
      const text = rawDataText(data)
      const decoded = decryptMessage(key, JSON.parse(text) as unknown)
      this.handleDecodedMessage(session, decoded)
    } catch (e) {
      this.reportError('收到无法验证的同步消息', e)
      session.socket.close(1008, 'invalid message')
    }
  }

  private handleDecodedMessage(session: SocketSession, value: unknown): void {
    if (!isRecord(value) || typeof value.kind !== 'string') {
      throw new Error('同步消息结构无效')
    }
    if (value.kind === 'hello') {
      this.registerPeer(session, value)
      return
    }
    if (value.kind === 'post' && session.peer) {
      this.importPost(session.peer, value.payload)
      return
    }
    throw new Error('同步消息顺序或类型无效')
  }

  private registerPeer(session: SocketSession, value: Record<string, unknown>): void {
    const deviceId = value.deviceId
    const deviceName = value.deviceName
    if (value.protocol !== 1 || typeof deviceId !== 'string' || typeof deviceName !== 'string') {
      throw new Error('对端设备信息无效')
    }
    if (!DEVICE_ID_PATTERN.test(deviceId)) throw new Error('对端设备标识无效')
    if (deviceId === this.settings.deviceId || deviceName.length === 0 || deviceName.length > 48) {
      throw new Error('对端设备标识无效')
    }
    if (session.expectedDeviceId && session.expectedDeviceId !== deviceId) {
      throw new Error('发现设备与连接设备不匹配')
    }
    const peer = this.getOrCreatePeer(deviceId, deviceName, session.address, this.settings.port)
    if (peer.socket && peer.socket !== session.socket && peer.socket.readyState === WebSocket.OPEN) {
      session.socket.close(1000, 'duplicate connection')
      return
    }
    peer.socket = session.socket
    peer.authenticated = true
    peer.lastSeen = Date.now()
    session.peer = peer
    this.clearError()
    this.emitStatus()
    console.log('[sync] peer connected', peer.deviceName, peer.address)
  }

  private importPost(peer: PeerRecord, value: unknown): void {
    const imported = decodeSyncedPost(value, peer.deviceId)
    if (imported.post.hash.length === 0) throw new Error('同步条目校验值为空')
    const payload = value as SyncedPostPayload
    if (payload.originDeviceName !== peer.deviceName) throw new Error('同步来源设备名称不匹配')
    const key = payload.originDeviceId + ':' + payload.postId
    if (this.hasSeen(key)) return
    this.remember(key)
    markSelfWrite(imported.post.hash, imported.post.contentPath)
    const result = this.store.insertPost(imported.post)
    imported.writeClipboard()
    this.onReceived(result.post, result.created)
    this.clearError()
    console.log('[sync] received clipboard item', peer.deviceName, payload.postId)
  }

  private acceptAnnouncement(message: string, address: string): void {
    try {
      const value: unknown = JSON.parse(message)
      if (!isRecord(value) || !this.isMatchingAnnouncement(value)) return
      const peer = this.getOrCreatePeer(
        value.deviceId as string,
        value.deviceName as string,
        address,
        value.port as number,
      )
      peer.lastSeen = Date.now()
      if (this.settings.deviceId.localeCompare(peer.deviceId) < 0) this.connectPeer(peer)
      this.emitStatus()
    } catch (e) {
      console.warn('[sync] invalid device announcement ignored', e)
    }
  }

  private isMatchingAnnouncement(value: Record<string, unknown>): boolean {
    if (value.protocol !== 1 || typeof value.deviceId !== 'string') return false
    if (!DEVICE_ID_PATTERN.test(value.deviceId)) return false
    if (typeof value.deviceName !== 'string' || value.deviceName.length > 48) return false
    if (!Number.isInteger(value.port) || Number(value.port) < 1 || Number(value.port) > 65535) return false
    return value.deviceId !== this.settings.deviceId
      && value.group === groupFingerprint(this.settings.secret)
  }

  private announcement(): object {
    return {
      protocol: 1,
      deviceId: this.settings.deviceId,
      deviceName: this.settings.deviceName,
      port: this.settings.port,
      group: groupFingerprint(this.settings.secret),
    }
  }

  private getOrCreatePeer(
    deviceId: string,
    deviceName: string,
    address: string,
    port: number,
  ): PeerRecord {
    const existing = this.peers.get(deviceId)
    if (existing) {
      existing.deviceName = deviceName
      existing.address = address
      existing.port = port
      return existing
    }
    const peer: PeerRecord = {
      deviceId,
      deviceName,
      address,
      port,
      connected: false,
      socket: null,
      authenticated: false,
      lastSeen: Date.now(),
    }
    this.peers.set(deviceId, peer)
    return peer
  }

  private connectPeer(peer: PeerRecord): void {
    if (peer.socket && peer.socket.readyState !== WebSocket.CLOSED) return
    try {
      const socket = new WebSocket('ws://' + peer.address + ':' + peer.port, {
        handshakeTimeout: 5000,
      })
      peer.socket = socket
      this.attachSocket(socket, peer.address, peer.deviceId)
    } catch (e) {
      this.reportError('连接局域网设备失败', e)
    }
  }

  private sendToPeers(message: WirePost): void {
    const peers = [...this.peers.values()].filter(peer =>
      peer.authenticated && peer.socket?.readyState === WebSocket.OPEN,
    )
    for (const peer of peers) {
      const session = peer.socket ? this.sessions.get(peer.socket) : undefined
      if (session) this.sendEncrypted(session, message)
    }
  }

  private sendEncrypted(session: SocketSession, value: WireHello | WirePost): void {
    const key = this.key
    if (!key || session.socket.readyState !== WebSocket.OPEN) return
    try {
      session.socket.send(JSON.stringify(encryptMessage(key, value)))
    } catch (e) {
      this.reportError('发送剪贴板内容失败', e)
    }
  }

  private removeSession(session: SocketSession): void {
    this.sessions.delete(session.socket)
    const peer = session.peer
    if (peer && peer.socket === session.socket) {
      peer.socket = null
      peer.authenticated = false
      console.log('[sync] peer disconnected', peer.deviceName)
      this.emitStatus()
    }
  }

  private removeStalePeers(): void {
    const now = Date.now()
    for (const [deviceId, peer] of this.peers) {
      if (!peer.authenticated && now - peer.lastSeen > PEER_TIMEOUT_MS) {
        this.peers.delete(deviceId)
      }
    }
    this.emitStatus()
  }

  private hasSeen(key: string): boolean {
    return this.seen.has(key)
  }

  private remember(key: string): void {
    this.seen.add(key)
    this.seenOrder.push(key)
    if (this.seenOrder.length <= SEEN_LIMIT) return
    const oldest = this.seenOrder.shift()
    if (oldest) this.seen.delete(oldest)
  }

  private async closeNetwork(): Promise<void> {
    this.discovery?.stop()
    this.discovery = null
    if (this.sweep) clearInterval(this.sweep)
    this.sweep = null
    for (const session of this.sessions.values()) session.socket.terminate()
    this.sessions.clear()
    this.peers.clear()
    this.key = null
    this.enabled = false
    this.listening = false
    const server = this.server
    this.server = null
    if (server) {
      await new Promise<void>(resolve => server.close(() => resolve()))
    }
    this.emitStatus()
  }

  private clearError(): void {
    if (!this.lastError) return
    this.lastError = null
    this.emitStatus()
  }

  private reportError(message: string, error?: unknown): void {
    if (this.lastError !== message) console.error('[sync] ' + message, error ?? '')
    this.lastError = message
    this.emitStatus()
  }

  private emitStatus(): void {
    try {
      this.onStatus(this.getStatus())
    } catch (e) {
      console.error('[sync] publish status failed', e)
    }
  }
}

function rawDataText(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8')
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8')
  return data.toString('utf8')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isLanAddress(address: string): boolean {
  const value = address.toLowerCase().replace(/^::ffff:/, '')
  if (value.startsWith('fe80:') || value.startsWith('fc') || value.startsWith('fd')) {
    return true
  }
  const parts = value.split('.').map(Number)
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false
  }
  const [a, b] = parts
  return a === 10 || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
    || (a === 100 && b >= 64 && b <= 127)
}
