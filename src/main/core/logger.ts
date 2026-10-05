import { createWriteStream, existsSync, renameSync, rmSync, statSync } from 'node:fs'
import { rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { formatWithOptions } from 'node:util'
import { logsDir } from './paths'

const LOG_FILE = join(logsDir, 'pasteman.log')
const OLD_LOG_FILE = join(logsDir, 'pasteman.previous.log')
const MAX_LOG_BYTES = 5 * 1024 * 1024
const MAX_LINE_LENGTH = 8_000
let initialized = false

function redact(text: string): string {
  return text
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, '<secret>')
    .replace(/\b(?:gh[opusr]_|github_pat_)[A-Za-z0-9_]+\b/g, '<secret>')
    .replace(/(Bearer\s+)[A-Za-z0-9._~-]+/gi, '$1<secret>')
    .replace(/\b[^\s@]+@[^\s@]+\.[^\s@]{2,}\b/g, '<email>')
    .replace(/\b(?:\d[ -]?){12,19}\b/g, '<number>')
    .replace(/([?&](?:token|key|secret|code)=)[^&#\s]+/gi, '$1<secret>')
    .replace(/[A-Z]:\\[^\r\n'"<>]+/gi, '<path>')
}

function rotateLog(): void {
  try {
    if (!existsSync(LOG_FILE) || statSync(LOG_FILE).size < MAX_LOG_BYTES) return
    if (existsSync(OLD_LOG_FILE)) rmSync(OLD_LOG_FILE, { force: true })
    renameSync(LOG_FILE, OLD_LOG_FILE)
  } catch (error) {
    console.error('[logger] 日志轮换失败', error)
  }
}

function createLogWriter(): (line: string) => void {
  let bytes = existsSync(LOG_FILE) ? statSync(LOG_FILE).size : 0
  let stream = openStream()
  let rotating = false
  let pendingBytes = 0
  let dropped = 0
  const pending: string[] = []

  function openStream(): ReturnType<typeof createWriteStream> {
    const result = createWriteStream(LOG_FILE, { flags: 'a', encoding: 'utf8' })
    result.on('error', error => process.stderr.write(`[logger] 写入日志失败 ${String(error)}\n`))
    return result
  }

  async function rotate(): Promise<void> {
    try {
      await rm(OLD_LOG_FILE, { force: true })
      await rename(LOG_FILE, OLD_LOG_FILE)
    } catch (error) {
      process.stderr.write(`[logger] 日志轮换失败 ${String(error)}\n`)
    } finally {
      stream = openStream()
      bytes = 0
      rotating = false
      const entries = pending.splice(0)
      pendingBytes = 0
      if (dropped) {
        entries.unshift(`${new Date().toISOString()} WARN [logger] 日志写入繁忙，已丢弃 ${dropped} 条\n`)
        dropped = 0
      }
      for (const entry of entries) write(entry)
    }
  }

  function write(line: string): void {
    const length = Buffer.byteLength(line)
    if (rotating) {
      if (pendingBytes + length > MAX_LOG_BYTES) { dropped++; return }
      pending.push(line)
      pendingBytes += length
      return
    }
    if (bytes + length > MAX_LOG_BYTES) {
      rotating = true
      stream.end(() => { void rotate() })
      write(line)
      return
    }
    bytes += length
    stream.write(line)
  }
  return write
}

export function initFileLogging(): void {
  if (initialized) return
  initialized = true
  rotateLog()
  try {
    const write = createLogWriter()
    for (const level of ['log', 'warn', 'error'] as const) {
      const original = console[level].bind(console)
      console[level] = (...args: unknown[]): void => {
        const rendered = formatWithOptions({ depth: 4, maxArrayLength: 20 }, ...args)
        const line = redact(rendered).slice(0, MAX_LINE_LENGTH)
        original(line)
        write(`${new Date().toISOString()} ${level.toUpperCase()} ${line}\n`)
      }
    }
    console.log('[logger] 文件日志已启用', LOG_FILE)
  } catch (error) {
    console.error('[logger] 初始化失败', error)
  }
}

export function getLogFilePath(): string {
  return LOG_FILE
}
