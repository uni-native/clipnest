import { createSocket, type RemoteInfo, type Socket } from 'node:dgram'
import { networkInterfaces } from 'node:os'

const MULTICAST_GROUP = '239.255.77.77'
const ANNOUNCE_INTERVAL_MS = 2500

export interface DiscoveryHandle {
  stop(): void
}

export function startDiscovery(
  port: number,
  announcement: () => object,
  onMessage: (message: string, address: string) => void,
  onError: (error: Error) => void,
): DiscoveryHandle {
  const socket = createSocket({ type: 'udp4', reuseAddr: true })
  let timer: ReturnType<typeof setInterval> | null = null
  socket.on('error', error => onError(error))
  socket.on('message', (data, remote: RemoteInfo) => {
    onMessage(data.toString('utf8'), remote.address)
  })
  socket.bind(port, '0.0.0.0', () => {
    const addresses = ipv4Addresses()
    for (const address of addresses) joinGroup(socket, address, onError)
    socket.setMulticastTTL(1)
    timer = setInterval(() => advertise(socket, addresses, port, announcement, onError), ANNOUNCE_INTERVAL_MS)
    advertise(socket, addresses, port, announcement, onError)
  })
  return {
    stop() {
      if (timer) clearInterval(timer)
      try {
        socket.close()
      } catch (e) {
        console.error('[sync] close discovery socket failed', e)
      }
    },
  }
}

function ipv4Addresses(): string[] {
  return Object.values(networkInterfaces()).flatMap(list => list ?? [])
    .filter(info => !info.internal && info.family === 'IPv4')
    .map(info => info.address)
}

function joinGroup(socket: Socket, address: string, onError: (error: Error) => void): void {
  try {
    socket.addMembership(MULTICAST_GROUP, address)
  } catch (e) {
    onError(e instanceof Error ? e : new Error(String(e)))
  }
}

function advertise(
  socket: Socket,
  addresses: string[],
  port: number,
  announcement: () => object,
  onError: (error: Error) => void,
): void {
  const message = Buffer.from(JSON.stringify(announcement()))
  for (const address of addresses) {
    try {
      socket.setMulticastInterface(address)
      socket.send(message, port, MULTICAST_GROUP, error => {
        if (error) onError(error)
      })
    } catch (e) {
      onError(e instanceof Error ? e : new Error(String(e)))
    }
  }
}
