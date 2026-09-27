import { createHash } from 'node:crypto'
import type { ClipboardSnapshot } from '@shared/types'
import { getPlatform } from '@main/platform'

const QUEUE_CAPACITY = 64

export type SnapshotHandler = (snapshot: ClipboardSnapshot) => void | Promise<void>

function fingerprint(snapshot: ClipboardSnapshot): string {
  return createHash('sha256').update(JSON.stringify(snapshot)).digest('hex')
}

export function startListening(onSnapshot: SnapshotHandler): { stop(): void } {
  const platform = getPlatform()
  let lastSequence: number | null
  try {
    lastSequence = platform.clipboardSequenceNumber()
  } catch (e) {
    console.error('[capture] initialize clipboard sequence failed', e)
    return { stop() {} }
  }
  let lastFingerprint = ''
  if (lastSequence === null) {
    try {
      lastFingerprint = fingerprint(platform.readClipboard())
    } catch (e) {
      console.error('[capture] initialize clipboard fingerprint failed', e)
    }
  }
  const queue: ClipboardSnapshot[] = []
  let draining = false
  let stopped = false

  async function drain(): Promise<void> {
    if (draining) return
    draining = true
    try {
      while (!stopped && queue.length > 0) {
        const snapshot = queue.shift()
        if (!snapshot) break
        try {
          await onSnapshot(snapshot)
        } catch (e) {
          console.error('[capture] handle snapshot failed', e)
        }
      }
    } finally {
      draining = false
    }
  }

  const timer = setInterval(() => {
    if (stopped) return
    let sequence: number | null
    try {
      sequence = platform.clipboardSequenceNumber()
    } catch (e) {
      console.error('[capture] read clipboard sequence failed', e)
      return
    }
    if (sequence !== null && sequence === lastSequence) return
    let snapshot: ClipboardSnapshot
    try {
      snapshot = platform.readClipboard()
    } catch (e) {
      console.error('[capture] read clipboard snapshot failed', e)
      return
    }
    if (sequence === null) {
      const current = fingerprint(snapshot)
      if (current === lastFingerprint) return
      lastFingerprint = current
    } else {
      lastSequence = sequence
    }
    if (queue.length >= QUEUE_CAPACITY) {
      console.warn('[capture] snapshot queue is full, dropping newest event')
      return
    }
    queue.push(snapshot)
    void drain()
  }, platform.clipboardPollIntervalMs)

  return {
    stop() {
      stopped = true
      clearInterval(timer)
      queue.length = 0
    },
  }
}
