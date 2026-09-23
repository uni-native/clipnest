import { createWriteStream, existsSync, renameSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { formatWithOptions } from 'node:util'
import { logsDir } from './paths'

const LOG_FILE = join(logsDir, 'clipnest.log')
const OLD_LOG_FILE = join(logsDir, 'clipnest.previous.log')
const MAX_LOG_BYTES = 5 * 1024 * 1024
const MAX_LINE_LENGTH = 8_000
let initialized = false

function redact(text: string): string {
  return text
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, '<secret>')
    .replace(/\b[^\s@]+@[^\s@]+\.[^\s@]{2,}\b/g, '<email>')
    .replace(/\b(?:\d[ -]?){12,19}\b/g, '<number>')
    .replace(/([?&](?:token|key|secret|code)=)[^&#\s]+/gi, '$1<secret>')
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

export function initFileLogging(): void {
  if (initialized) return
  initialized = true
  rotateLog()
  try {
    const stream = createWriteStream(LOG_FILE, { flags: 'a', encoding: 'utf8' })
    stream.on('error', error => process.stderr.write(`[logger] 写入日志失败 ${String(error)}\n`))
    for (const level of ['log', 'warn', 'error'] as const) {
      const original = console[level].bind(console)
      console[level] = (...args: unknown[]): void => {
        original(...args)
        const rendered = formatWithOptions({ depth: 4, maxArrayLength: 20 }, ...args)
        const line = redact(rendered).slice(0, MAX_LINE_LENGTH)
        stream.write(`${new Date().toISOString()} ${level.toUpperCase()} ${line}\n`)
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
