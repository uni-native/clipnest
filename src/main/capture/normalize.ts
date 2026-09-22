import { createHash } from 'node:crypto'
import type { Dirent } from 'node:fs'
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { blobsDir, imagesDir } from '@main/core/paths'
import type { ClipboardSnapshot, ContentType } from '@shared/types'

export interface Normalized {
  hash: string
  type: ContentType
  title: string
  preview: string
                            
  contentPath: string | null
  size: number
}

                             
const FOLDER_MAX_DEPTH = 3
                               
const FOLDER_TIMEOUT_MS = 500
const PREVIEW_MAX = 120
const TITLE_MAX = 80
                                 
const SIZE_UNKNOWN = -1

export function normalizeSnapshot(
  snapshot: ClipboardSnapshot,
  type: ContentType,
): Normalized | null {
  switch (type) {
    case 'image':
      return normalizeImage(snapshot)
    case 'file':
    case 'folder':
      return normalizePath(snapshot, type)
    default:
      return normalizeText(snapshot, type)
  }
}

                                                                                  

function normalizeImage(snapshot: ClipboardSnapshot): Normalized | null {
  const dataUrl = snapshot.imageDataUrl
  if (!dataUrl) return null
  const comma = dataUrl.indexOf(',')
  const bytes = Buffer.from(comma >= 0 ? dataUrl.slice(comma + 1) : '', 'base64')
  if (bytes.length === 0) return null
  const hash = sha256(dataUrl)
  const file = join(imagesDir, `img_${hash.slice(0, 16)}.png`)
  return {
    hash,
    type: 'image',
    title: '图片',
    preview: formatSize(bytes.length),
    contentPath: writeBlob(file, bytes),
    size: bytes.length,
  }
}

                                                        
function normalizePath(snapshot: ClipboardSnapshot, type: 'file' | 'folder'): Normalized | null {
  const path = snapshot.filePath
  if (!path) return null
  const title = basename(path) || path
  const size = type === 'folder' ? folderSize(path) : fileSize(path)
  const hash = sha256(JSON.stringify({ content: path, size, title }))
  return {
    hash,
    type,
    title,
    preview: truncate(path, PREVIEW_MAX),
    contentPath: path,
    size,
  }
}

                                                       
function normalizeText(snapshot: ClipboardSnapshot, type: 'text' | 'link'): Normalized | null {
  const plain = stripNulls(snapshot.text)
  const html = type === 'text' ? stripNulls(snapshot.html) : ''
  const rich = /<[a-z][\s\S]*>/i.test(html)
  const content = rich ? html : plain
  if (content.trim().length === 0) return null
  const hash = sha256(content)
  const ext = rich ? 'html' : 'txt'
  const file = join(blobsDir, `${ext}_${hash.slice(0, 16)}.${ext}`)
  const display = plain.trim().length > 0 ? plain : content
  return {
    hash,
    type,
    title: toTitle(display),
    preview: toPreview(display),
    contentPath: writeBlob(file, Buffer.from(content, 'utf8')),
    size: Buffer.byteLength(content, 'utf8'),
  }
}

                                                                              

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex')
}

function stripNulls(s: string): string {
  return s.replace(/\u0000/g, '')
}

                             
function writeBlob(file: string, data: Buffer): string | null {
  try {
    mkdirSync(dirname(file), { recursive: true })
    if (!existsSync(file)) writeFileSync(file, data)
    return file
  } catch (e) {
    console.error('[capture] write blob failed', file, e)
    return null
  }
}

function fileSize(p: string): number {
  try {
    return statSync(p).size
  } catch {
    return SIZE_UNKNOWN
  }
}

function folderSize(root: string): number {
  const started = Date.now()
  const walk = (dir: string, depth: number): number => {
    if (Date.now() - started > FOLDER_TIMEOUT_MS) return SIZE_UNKNOWN
    if (depth > FOLDER_MAX_DEPTH) return 0
    let total = 0
    let entries: Dirent[]
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return SIZE_UNKNOWN
    }
    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        const sub = walk(full, depth + 1)
        if (sub < 0) return SIZE_UNKNOWN
        total += sub
      } else if (entry.isFile()) {
        const size = fileSize(full)
        if (size > 0) total += size
      }
    }
    return total
  }
  return walk(root, 1)
}

function stripTags(s: string): string {
  return s
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) : s
}

                                
function toPreview(s: string): string {
  const flat = stripTags(s).replace(/\s+/g, ' ').trim()
  return truncate(flat, PREVIEW_MAX)
}

                             
function toTitle(s: string): string {
  const line = stripTags(s)
    .split('\n')
    .map(l => l.trim())
    .find(l => l.length > 0)
  if (!line) return ''
  return truncate(line.replace(/\s+/g, ' '), TITLE_MAX)
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

                             
export function htmlToPlain(html: string): string {
  return stripTags(html).replace(/\s+/g, ' ').trim()
}
