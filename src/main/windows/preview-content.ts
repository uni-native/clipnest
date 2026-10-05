import { open, opendir, stat } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import { createRequire } from 'node:module'
import { unzipSync, strFromU8 } from 'fflate'
import { XMLParser } from 'fast-xml-parser'
import type { Post } from '@shared/types'

const MAX_FILE_BYTES = 32 * 1024 * 1024
const MAX_TEXT_BYTES = 512 * 1024
const MAX_XML_BYTES = 4 * 1024 * 1024
const parser = new XMLParser({ ignoreAttributes: false, parseTagValue: false })

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!))
}

function parseXml(xml: string): unknown {
  if (/<!DOCTYPE/i.test(xml)) throw new Error('文档包含不支持的 XML 声明')
  return parser.parse(xml) as unknown
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function list(value: unknown): unknown[] {
  return value === undefined ? [] : Array.isArray(value) ? value : [value]
}

function texts(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  if (Array.isArray(value)) return value.map(texts).join('')
  return Object.entries(object(value)).filter(([key]) => !key.startsWith('@_')).map(([, item]) => texts(item)).join('')
}

async function readBytes(path: string, limit: number): Promise<Buffer> {
  const file = await open(path, 'r')
  try {
    const size = (await file.stat()).size
    const bytes = Buffer.alloc(Math.min(size, limit))
    const result = await file.read(bytes, 0, bytes.length, 0)
    return bytes.subarray(0, result.bytesRead)
  } finally { await file.close() }
}

function decodeText(bytes: Buffer): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return bytes.subarray(2).toString('utf16le')
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    const even = bytes.subarray(2, bytes.length - bytes.length % 2)
    return Buffer.from(even).swap16().toString('utf16le')
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '')
}

async function folderContent(path: string): Promise<string> {
  const rows: string[] = []
  const directory = await opendir(path)
  for await (const entry of directory) {
    if (rows.length >= 200) { rows.push('<li>仅显示前 200 项</li>'); break }
    rows.push(`<li><span>${entry.isDirectory() ? '文件夹' : '文件'}</span>${escapeHtml(entry.name)}</li>`)
  }
  return `<ul>${rows.join('') || '<li>文件夹为空</li>'}</ul>`
}

function officeFiles(bytes: Buffer, extension: string): Record<string, Uint8Array> {
  let total = 0
  return unzipSync(bytes, { filter: file => {
    const wanted = extension === '.docx' ? file.name === 'word/document.xml'
      : extension === '.xlsx' ? /^xl\/(sharedStrings\.xml|worksheets\/sheet[1-3]\.xml)$/.test(file.name)
        : /^ppt\/slides\/slide([1-9]|[12]\d|30)\.xml$/.test(file.name)
    if (!wanted) return false
    total += file.originalSize
    if (file.originalSize > MAX_XML_BYTES || total > 12 * 1024 * 1024) throw new Error('文档内容过大，无法预览')
    return true
  } })
}

function paragraphContent(xml: string, tag: 'w' | 'a'): string {
  const paragraphs = xml.match(new RegExp(`<${tag}:p(?:\\s[^>]*)?>[\\s\\S]*?<\\/${tag}:p>`, 'g')) ?? []
  return paragraphs.slice(0, 2000).map(paragraph => {
    const content = paragraph.match(new RegExp(`<${tag}:t(?:\\s[^>]*)?>[\\s\\S]*?<\\/${tag}:t>`, 'g')) ?? []
    return `<p>${escapeHtml(content.map(part => texts(parseXml(part))).join(''))}</p>`
  }).join('')
}

function spreadsheetContent(files: Record<string, Uint8Array>): string {
  const strings = files['xl/sharedStrings.xml']
    ? list(object(object(parseXml(strFromU8(files['xl/sharedStrings.xml']))).sst).si).map(texts) : []
  return Object.keys(files).filter(name => name.startsWith('xl/worksheets/')).sort().map((name, index) => {
    const sheet = object(object(parseXml(strFromU8(files[name]))).worksheet)
    const rows = list(object(sheet.sheetData).row).slice(0, 200).map(row => {
      const cells = list(object(row).c).slice(0, 50).map(cell => {
        const c = object(cell)
        const value = c['@_t'] === 's' ? strings[Number(c.v)] ?? '' : c['@_t'] === 'inlineStr' ? texts(c.is) : texts(c.v)
        return `<td>${escapeHtml(String(c['@_r'] ?? ''))}<br>${escapeHtml(value)}</td>`
      }).join('')
      return `<tr>${cells}</tr>`
    }).join('')
    return `<h2>工作表 ${index + 1}</h2><div class="table-wrap"><table>${rows}</table></div>`
  }).join('') + '<p class="notice">最多显示前 3 张工作表，每张前 200 行、每行前 50 个单元格。公式显示文件保存时的结果。</p>'
}

function officeContent(bytes: Buffer, extension: string): string {
  const files = officeFiles(bytes, extension)
  if (extension === '.xlsx') return spreadsheetContent(files)
  if (extension === '.docx') {
    if (!files['word/document.xml']) throw new Error('Word 文档内容缺失')
    return paragraphContent(strFromU8(files['word/document.xml']), 'w') + '<p class="notice">文字预览，最多显示 2000 段。</p>'
  }
  return Object.keys(files).sort((a, b) => Number(a.match(/slide(\d+)/)?.[1]) - Number(b.match(/slide(\d+)/)?.[1]))
    .map((name, index) => `<section><h2>第 ${index + 1} 页</h2>${paragraphContent(strFromU8(files[name]), 'a')}</section>`).join('')
    + '<p class="notice">幻灯片文字预览，最多显示前 30 页。</p>'
}

function contentPath(post: Post): string {
  if (!post.contentPath) throw new Error('内容文件不存在')
  if (!post.contentPath.startsWith('[')) return post.contentPath
  const paths: unknown = JSON.parse(post.contentPath)
  if (!Array.isArray(paths) || typeof paths[0] !== 'string') throw new Error('文件路径无效')
  if (paths.length > 1) throw new Error('包含多个文件，请分别复制后预览')
  return paths[0]
}

async function pdfContent(bytes: Buffer): Promise<string> {
  const [{ getDocument }, { createCanvas }] = await Promise.all([
    import('pdfjs-dist/legacy/build/pdf.mjs'), import('@napi-rs/canvas'),
  ])
  const pdfRoot = dirname(createRequire(__filename).resolve('pdfjs-dist/package.json'))
  const task = getDocument({ data: Uint8Array.from(bytes), isEvalSupported: false, useSystemFonts: false,
    standardFontDataUrl: join(pdfRoot, 'standard_fonts').replace(/\\/g, '/') + '/',
    cMapUrl: join(pdfRoot, 'cmaps').replace(/\\/g, '/') + '/',
    cMapPacked: true, useWorkerFetch: false,
  })
  const document = await task.promise
  const pages: string[] = []
  try {
    for (let number = 1; number <= Math.min(document.numPages, 3); number++) {
      const page = await document.getPage(number)
      const original = page.getViewport({ scale: 1 })
      const viewport = page.getViewport({ scale: Math.min(1.4, Math.sqrt(2_000_000 / (original.width * original.height))) })
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height))
      await page.render({ canvas: canvas as never, canvasContext: canvas.getContext('2d') as never, viewport }).promise
      pages.push(`<section><h2>第 ${number} 页</h2><img src="${canvas.toDataURL('image/png')}" alt="PDF 第 ${number} 页"></section>`)
      page.cleanup()
    }
    return pages.join('') + `<p class="notice">共 ${document.numPages} 页，预览前 3 页。</p>`
  } finally { await document.destroy() }
}

export async function readPreviewContent(post: Post): Promise<string> {
  const path = contentPath(post)
  const info = await stat(path)
  if (info.isDirectory()) return folderContent(path)
  if (!info.isFile()) throw new Error('此内容不是普通文件')
  const extension = extname(path).toLowerCase()
  if (post.type === 'text' || post.type === 'link' || /\.(txt|md|json|csv|log|xml|html?|css|[cm]?js|tsx?|vue|py|java|sql|ya?ml|ini|toml|ps1|bat|c|cpp|h|rs|go|sh)$/i.test(extension)) {
    const text = decodeText(await readBytes(path, MAX_TEXT_BYTES))
    return `<pre>${escapeHtml(text)}</pre>${info.size > MAX_TEXT_BYTES ? '<p class="notice">仅显示前 512 KB。</p>' : ''}`
  }
  if (info.size > MAX_FILE_BYTES) throw new Error('文件超过 32 MB，暂不支持预览')
  const mime: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp', '.avif': 'image/avif', '.pdf': 'application/pdf', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg' }
  if (['.docx', '.xlsx', '.pptx'].includes(extension)) return officeContent(await readBytes(path, MAX_FILE_BYTES), extension)
  if (!mime[extension]) throw new Error(`暂不支持 ${extension || basename(path)} 格式预览`)
  if (extension === '.pdf') {
    return pdfContent(await readBytes(path, MAX_FILE_BYTES))
  }
  const url = `data:${mime[extension]};base64,${(await readBytes(path, MAX_FILE_BYTES)).toString('base64')}`
  if (mime[extension].startsWith('image/')) return `<img src="${url}" alt="文件预览">`
  const tag = mime[extension].startsWith('video/') ? 'video' : 'audio'
  return `<${tag} src="${url}" controls></${tag}>`
}

export async function readThumbnail(post: Post): Promise<Uint8Array> {
  const path = contentPath(post)
  const info = await stat(path)
  if (!info.isFile() || info.size > MAX_FILE_BYTES) throw new Error('图片过大或不存在')
  const { createCanvas, loadImage } = await import('@napi-rs/canvas')
  const image = await loadImage(await readBytes(path, MAX_FILE_BYTES))
  const scale = Math.min(1, 192 / Math.max(image.width, image.height))
  const canvas = createCanvas(Math.max(1, Math.round(image.width * scale)), Math.max(1, Math.round(image.height * scale)))
  canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height)
  return canvas.toBuffer('image/png')
}
