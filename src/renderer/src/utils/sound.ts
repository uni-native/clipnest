import type { Settings } from '@shared/types'

export type ClipboardSoundKind = 'copy' | 'paste'
type SoundSettings = Settings['clipboard']['sounds']

const activeAudio = new Set<HTMLAudioElement>()
let audioContext: AudioContext | null = null

function context(): AudioContext {
  if (!audioContext || audioContext.state === 'closed') audioContext = new AudioContext()
  return audioContext
}

function notes(kind: ClipboardSoundKind, type: number): Array<[number, number, number]> {
  if (type === 1) {
    return kind === 'copy'
      ? [[740, 0, 0.045], [990, 0.045, 0.07]]
      : [[880, 0, 0.045], [590, 0.045, 0.08]]
  }
  return kind === 'copy'
    ? [[920, 0, 0.11]]
    : [[620, 0, 0.13]]
}

async function playSynth(kind: ClipboardSoundKind, type: number): Promise<void> {
  const ctx = context()
  if (ctx.state === 'suspended') await ctx.resume()
  if (ctx.state !== 'running') throw new Error(`音效未能启动: ${ctx.state}`)
  const start = ctx.currentTime + 0.005
  for (const [frequency, offset, duration] of notes(kind, type)) {
    const oscillator = ctx.createOscillator()
    const gain = ctx.createGain()
    oscillator.type = type === 1 ? 'square' : 'sine'
    oscillator.frequency.setValueAtTime(frequency, start + offset)
    gain.gain.setValueAtTime(0.0001, start + offset)
    gain.gain.exponentialRampToValueAtTime(type === 1 ? 0.07 : 0.14, start + offset + 0.008)
    gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + duration)
    oscillator.connect(gain)
    gain.connect(ctx.destination)
    oscillator.addEventListener('ended', () => {
      oscillator.disconnect()
      gain.disconnect()
    }, { once: true })
    oscillator.start(start + offset)
    oscillator.stop(start + offset + duration + 0.01)
  }
}

async function playCustom(dataUrl: string): Promise<void> {
  const audio = new Audio(dataUrl)
  audio.volume = 0.45
  activeAudio.add(audio)
  const release = (): void => {
    activeAudio.delete(audio)
    audio.pause()
    audio.removeAttribute('src')
    audio.load()
  }
  audio.addEventListener('ended', release, { once: true })
  audio.addEventListener('error', release, { once: true })
  try {
    await audio.play()
  } catch (error) {
    release()
    throw error
  }
}

export async function playClipboardSound(
  kind: ClipboardSoundKind,
  settings: SoundSettings,
): Promise<boolean> {
  if (!settings.open) return false
  try {
    if (settings.type === 2) {
      const dataUrl = settings[kind]
      if (!dataUrl) {
        console.warn(`[sound] ${kind} custom sound is not configured`)
        return false
      }
      await playCustom(dataUrl)
    } else {
      await playSynth(kind, settings.type)
    }
    return true
  } catch (e) {
    console.error(`[sound] ${kind} playback failed`, e)
    return false
  }
}
