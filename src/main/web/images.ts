import { app } from 'electron'
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'
import type { Post } from '@shared/types'

const sources = new Map<string, Post>()
const cache = new Map<string, Buffer>()
const pending = new Map<string, Promise<Buffer>>()
const waiting: Array<() => void> = []
let running = 0

export function registerImage(post: Post): string | undefined {
  if (post.type !== 'image' || !post.contentPath) return undefined
  sources.delete(post.id)
  sources.set(post.id, post)
  if (sources.size > 512) sources.delete(sources.keys().next().value!)
  return `/api/images/${encodeURIComponent(post.id)}?v=${encodeURIComponent(post.hash)}`
}

export function forgetImage(id: string): void {
  const source = sources.get(id)
  if (source) cache.delete(source.hash)
  sources.delete(id)
}

async function acquireSlot(): Promise<void> {
  if (running < 2) { running++; return }
  if (waiting.length >= 64) throw new Error('图片读取请求过多')
  await new Promise<void>(resolve => waiting.push(resolve))
}

function releaseSlot(): void {
  const next = waiting.shift()
  if (next) next()
  else running--
}

async function generateThumbnail(post: Post): Promise<Buffer> {
  await acquireSlot()
  try {
    return await new Promise<Buffer>((resolve, reject) => {
      const workerPath = app.isPackaged ? join(process.resourcesPath, 'app.asar.unpacked/out/main/preview-worker.js') : join(__dirname, 'preview-worker.js')
      const worker = new Worker(workerPath, { workerData: { post, mode: 'thumbnail' } })
      const timer = setTimeout(() => {
        void worker.terminate().catch(error => console.error('[web-manager] 图片任务终止失败', error))
        reject(new Error('图片读取超时'))
      }, 10_000)
      worker.once('message', (content: unknown) => {
        clearTimeout(timer)
        if (ArrayBuffer.isView(content)) resolve(Buffer.from(content.buffer, content.byteOffset, content.byteLength))
        else reject(new Error('无法生成图片缩略图'))
      })
      worker.once('error', error => { clearTimeout(timer); reject(error) })
      worker.once('exit', () => { clearTimeout(timer); reject(new Error('图片任务已结束')) })
    })
  } finally { releaseSlot() }
}

export async function getImageThumbnail(id: string): Promise<Buffer | null> {
  const post = sources.get(id)
  if (!post) return null
  const existing = cache.get(post.hash)
  if (existing) return existing
  let task = pending.get(post.hash)
  if (!task) {
    task = generateThumbnail(post)
    pending.set(post.hash, task)
  }
  try {
    const image = await task
    cache.set(post.hash, image)
    if (cache.size > 128) cache.delete(cache.keys().next().value!)
    return image
  } finally { pending.delete(post.hash) }
}
