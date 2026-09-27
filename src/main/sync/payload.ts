import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { basename, extname, isAbsolute, join, relative, resolve } from 'node:path'
import type { NewPost, Post, SyncedPostPayload } from '@shared/types'
import { blobsDir, imagesDir } from '@main/core/paths'
import { getPlatform } from '@main/platform'
import { htmlToPlain } from '@main/capture/normalize'

export const MAX_SYNC_CONTENT_BYTES = 4 * 1024 * 1024

export interface ImportedPost {
  post: NewPost
  writeClipboard(): void
}

function isSyncablePost(post: Post): post is Post & { type: SyncedPostPayload['type'] } {
  return post.type === 'text' || post.type === 'link' || post.type === 'image'
}

export function encodeSyncedPost(
  post: Post,
  deviceId: string,
  deviceName: string,
): SyncedPostPayload | null {
  if (!isSyncablePost(post)) return null
  if (!post.contentPath) throw new Error('剪贴板内容没有本机文件')
  const contentPath = resolve(post.contentPath)
  try {
    const root = realpathSync(blobsDir)
    const path = realpathSync(contentPath)
    const relativePath = relative(root, path)
    if (isAbsolute(relativePath) || relativePath.startsWith('..')) {
      throw new Error('剪贴板内容路径不在数据目录中')
    }
    if (statSync(path).size > MAX_SYNC_CONTENT_BYTES) {
      throw new Error('单条剪贴板内容超过 4 MiB 同步上限')
    }
    const bytes = readFileSync(path)
    if (bytes.length > MAX_SYNC_CONTENT_BYTES) {
      throw new Error('单条剪贴板内容超过 4 MiB 同步上限')
    }
    return createPayload(post, bytes, deviceId, deviceName)
  } catch (e) {
    console.error('[sync] read clipboard content failed', post.id, e)
    throw e
  }
}

function createPayload(
  post: Post & { type: SyncedPostPayload['type'] },
  bytes: Buffer,
  deviceId: string,
  deviceName: string,
): SyncedPostPayload {
  const format = post.type === 'image'
    ? 'image'
    : post.type === 'text' && extname(post.contentPath ?? '') === '.html'
      ? 'html'
      : 'text'
  const contentHash = format === 'image'
    ? hash('data:image/png;base64,' + bytes.toString('base64'))
    : hash(bytes)
  if (contentHash !== post.hash) throw new Error('剪贴板内容校验失败')
  return {
    originDeviceId: deviceId,
    originDeviceName: deviceName,
    postId: post.id,
    hash: post.hash,
    type: post.type,
    title: post.title,
    preview: post.preview,
    sourceApp: post.sourceApp,
    format,
    content: bytes.toString('base64'),
  }
}

export function decodeSyncedPost(value: unknown, deviceId: string): ImportedPost {
  const payload = validatePayload(value, deviceId)
  const bytes = Buffer.from(payload.content, 'base64')
  if (bytes.length > MAX_SYNC_CONTENT_BYTES || bytes.toString('base64') !== payload.content) {
    throw new Error('同步内容大小或编码无效')
  }
  const content = bytes.toString('utf8')
  if (payload.format !== 'image' && !Buffer.from(content, 'utf8').equals(bytes)) {
    throw new Error('同步文本不是有效的 UTF-8')
  }
  verifyHash(payload, bytes, content)
  const contentPath = writeImportedContent(payload, bytes)
  const post: NewPost = {
    hash: payload.hash,
    type: payload.type,
    title: payload.title,
    preview: payload.preview,
    contentPath,
    size: bytes.length,
    sourceApp: payload.sourceApp,
    sourceDevice: payload.originDeviceName,
    groupId: null,
  }
  return { post, writeClipboard: () => writeClipboard(payload, content, contentPath) }
}

function validatePayload(value: unknown, deviceId: string): SyncedPostPayload {
  if (!value || typeof value !== 'object') throw new Error('同步数据不是对象')
  const payload = value as Partial<SyncedPostPayload>
  if (payload.originDeviceId !== deviceId) throw new Error('同步来源设备不匹配')
  if (typeof payload.originDeviceName !== 'string' || payload.originDeviceName.length > 48) {
    throw new Error('同步设备名称无效')
  }
  if (typeof payload.postId !== 'string' || payload.postId.length > 80) {
    throw new Error('同步条目标识无效')
  }
  if (typeof payload.hash !== 'string' || !/^[a-f0-9]{64}$/i.test(payload.hash)) {
    throw new Error('同步条目校验值无效')
  }
  if (!['text', 'link', 'image'].includes(String(payload.type))) {
    throw new Error('此剪贴板类型不支持同步')
  }
  if (!['text', 'html', 'image'].includes(String(payload.format))) {
    throw new Error('同步内容格式无效')
  }
  if (typeof payload.content !== 'string' || payload.content.length > MAX_SYNC_CONTENT_BYTES * 2) {
    throw new Error('同步内容大小无效')
  }
  if (typeof payload.title !== 'string' || payload.title.length > 160) {
    throw new Error('同步标题无效')
  }
  if (typeof payload.preview !== 'string' || payload.preview.length > 512) {
    throw new Error('同步摘要无效')
  }
  if (typeof payload.sourceApp !== 'string' || payload.sourceApp.length > 128) {
    throw new Error('同步来源应用无效')
  }
  return payload as SyncedPostPayload
}

function verifyHash(payload: SyncedPostPayload, bytes: Buffer, content: string): void {
  const value = payload.format === 'image'
    ? 'data:image/png;base64,' + bytes.toString('base64')
    : bytes
  if (hash(value) !== payload.hash) throw new Error('同步内容校验失败')
  if (payload.format === 'image' && payload.type !== 'image') {
    throw new Error('图片内容类型不匹配')
  }
  if (payload.format === 'html' && payload.type !== 'text') {
    throw new Error('富文本类型不匹配')
  }
  if (payload.format === 'text' && payload.type === 'image') {
    throw new Error('文本内容类型不匹配')
  }
  if (payload.format !== 'image' && content.length === 0) {
    throw new Error('空剪贴板内容不能同步')
  }
}

function writeImportedContent(payload: SyncedPostPayload, bytes: Buffer): string {
  const image = payload.format === 'image'
  const extension = image ? 'png' : payload.format === 'html' ? 'html' : 'txt'
  const directory = image ? imagesDir : blobsDir
  const prefix = image ? 'img' : extension
  const file = join(directory, prefix + '_' + payload.hash + '.' + extension)
  try {
    mkdirSync(directory, { recursive: true })
    if (!existsSync(file)) writeFileSync(file, bytes)
    return file
  } catch (e) {
    console.error('[sync] save received clipboard content failed', basename(file), e)
    throw e
  }
}

function writeClipboard(payload: SyncedPostPayload, content: string, path: string): void {
  const platform = getPlatform()
  if (payload.format === 'image') platform.writeImageFile(path)
  else if (payload.format === 'html') platform.writeHtml(content, htmlToPlain(content) || payload.preview)
  else platform.writeText(content)
}

function hash(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}
