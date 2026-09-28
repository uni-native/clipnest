import { execFile, execFileSync, spawnSync } from 'node:child_process'
import type { ForegroundWindow } from '@shared/types'

const COMMAND_TIMEOUT_MS = 500
const WINDOW_HANDLE = 1

let available = false
let initialized = false
let lastExternalAddress: string | null = null
let pasteTargetAddress: string | null = null

interface Client {
  address: string
  pid: number
  title: string
  pinned?: boolean
}

interface Monitor {
  x: number
  y: number
  width: number
  height: number
  scale: number
  reserved: number[]
  focused: boolean
}

export function isHyprlandSession(): boolean {
  return Boolean(process.env.HYPRLAND_INSTANCE_SIGNATURE)
}

export function initHyprland(): boolean {
  if (initialized) return available
  initialized = true
  const result = spawnSync('hyprctl', ['version'], { timeout: COMMAND_TIMEOUT_MS, encoding: 'utf8' })
  available = result.status === 0
  if (!available) console.error('[platform:hyprland] hyprctl unavailable', result.error ?? result.stderr)
  return available
}

function run(args: string[]): string {
  if (!available) throw new Error('hyprctl unavailable')
  return execFileSync('hyprctl', args, { timeout: COMMAND_TIMEOUT_MS, encoding: 'utf8' }).trim()
}

function runAsync(args: string[]): Promise<string> {
  if (!available) return Promise.reject(new Error('hyprctl unavailable'))
  return new Promise((resolve, reject) => {
    execFile('hyprctl', args, { timeout: COMMAND_TIMEOUT_MS, encoding: 'utf8' }, (error, stdout) => {
      if (error) reject(error)
      else resolve(stdout.trim())
    })
  })
}

function parseClient(value: unknown): Client | null {
  if (!value || typeof value !== 'object') return null
  const client = value as Record<string, unknown>
  if (typeof client.address !== 'string' || !/^0x[0-9a-f]+$/i.test(client.address)) return null
  if (typeof client.pid !== 'number' || !Number.isSafeInteger(client.pid)) return null
  return {
    address: client.address,
    pid: client.pid,
    title: typeof client.title === 'string' ? client.title : '',
    pinned: client.pinned === true,
  }
}

function activeWindow(): Client | null {
  return parseClient(JSON.parse(run(['-j', 'activewindow'])) as unknown)
}

export async function trackHyprlandWindow(): Promise<void> {
  const active = parseClient(JSON.parse(await runAsync(['-j', 'activewindow'])) as unknown)
  if (active && active.pid !== process.pid) lastExternalAddress = active.address
}

export function foregroundHyprlandWindow(): ForegroundWindow | null {
  if (!available) return null
  const active = activeWindow()
  if (!active) return null
  if (active.pid !== process.pid) lastExternalAddress = active.address
  return { handle: WINDOW_HANDLE, title: active.title }
}

export function saveHyprlandForeground(): number | null {
  if (!available) return null
  pasteTargetAddress = null
  const active = activeWindow()
  if (active && active.pid !== process.pid) lastExternalAddress = active.address
  return lastExternalAddress ? WINDOW_HANDLE : null
}

export function restoreHyprlandForeground(handle: number): void {
  pasteTargetAddress = handle === WINDOW_HANDLE ? lastExternalAddress : null
}

export function pasteHyprland(): void {
  const address = pasteTargetAddress
  pasteTargetAddress = null
  if (!address) throw new Error('no saved Hyprland target window')
  const result = run(['dispatch', 'sendshortcut', `CTRL,V,address:${address}`])
  if (!/^ok$/i.test(result)) throw new Error(`Hyprland rejected paste shortcut: ${result}`)
}

function parseMonitor(value: unknown): Monitor | null {
  if (!value || typeof value !== 'object') return null
  const monitor = value as Record<string, unknown>
  const numbers = [monitor.x, monitor.y, monitor.width, monitor.height, monitor.scale]
  if (numbers.some(item => typeof item !== 'number' || !Number.isFinite(item))) return null
  if (!Array.isArray(monitor.reserved) || monitor.reserved.length !== 4) return null
  if (monitor.reserved.some(item => typeof item !== 'number' || !Number.isFinite(item))) return null
  return {
    x: monitor.x as number, y: monitor.y as number,
    width: monitor.width as number, height: monitor.height as number,
    scale: monitor.scale as number, reserved: monitor.reserved as number[],
    focused: monitor.focused === true,
  }
}

async function targetArea(): Promise<{ x: number; y: number; width: number; height: number }> {
  const monitorsRaw: unknown = JSON.parse(await runAsync(['-j', 'monitors']))
  const cursorRaw: unknown = JSON.parse(await runAsync(['-j', 'cursorpos']))
  const monitors = Array.isArray(monitorsRaw) ? monitorsRaw.map(parseMonitor).filter((m): m is Monitor => m !== null) : []
  const cursor = cursorRaw && typeof cursorRaw === 'object' ? cursorRaw as Record<string, unknown> : {}
  const x = typeof cursor.x === 'number' ? cursor.x : NaN
  const y = typeof cursor.y === 'number' ? cursor.y : NaN
  const monitor = monitors.find(m => x >= m.x && x < m.x + m.width / m.scale
    && y >= m.y && y < m.y + m.height / m.scale) ?? monitors.find(m => m.focused)
  if (!monitor || monitor.scale <= 0) throw new Error('Hyprland monitor unavailable')
  const [top, bottom, left, right] = monitor.reserved
  return {
    x: Math.round(monitor.x + left), y: Math.round(monitor.y + top),
    width: Math.round(monitor.width / monitor.scale - left - right),
    height: Math.round(monitor.height / monitor.scale - top - bottom),
  }
}

function boundsFor(area: Awaited<ReturnType<typeof targetArea>>, layout: 'vertical' | 'horizontal', width: number, height: number) {
  if (layout === 'vertical') return { x: area.x + area.width - width, y: area.y, width, height: area.height }
  return { x: area.x, y: area.y + area.height - height, width: area.width, height }
}

async function findWindow(title: string): Promise<Client> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const raw: unknown = JSON.parse(await runAsync(['-j', 'clients']))
    const clients = Array.isArray(raw) ? raw.map(parseClient) : []
    const client = clients.find(item => item?.pid === process.pid && item.title === title)
    if (client) return client
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error(`Hyprland window unavailable: ${title}`)
}

async function dispatch(name: string, argument: string): Promise<void> {
  const result = await runAsync(['dispatch', name, argument])
  if (!/^ok$/i.test(result)) throw new Error(`Hyprland ${name} failed: ${result}`)
}

export async function placeHyprlandPanel(title: string, layout: 'vertical' | 'horizontal', width: number, height: number): Promise<void> {
  if (!isHyprlandSession() || !initHyprland()) return
  const [client, area] = await Promise.all([findWindow(title), targetArea()])
  const bounds = boundsFor(area, layout, width, height)
  const target = `address:${client.address}`
  await dispatch('setfloating', target)
  await dispatch('resizewindowpixel', `exact ${bounds.width} ${bounds.height},${target}`)
  await dispatch('movewindowpixel', `exact ${bounds.x} ${bounds.y},${target}`)
  if (!client.pinned) await dispatch('pin', target)
}
