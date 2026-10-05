import { parentPort, workerData } from 'node:worker_threads'
import type { PreviewRequest } from '@shared/types'
import { readPreviewContent, readThumbnail, escapeHtml } from './preview-content'

const { post, mode } = workerData as PreviewRequest
const task = mode === 'thumbnail' ? readThumbnail(post) : readPreviewContent(post)
task.then(content => parentPort?.postMessage(content)).catch(error => {
  console.error('[pasteman] 预览读取失败', error)
  parentPort?.postMessage(`<p class="notice">${escapeHtml(error instanceof Error ? error.message : '无法读取文件')}</p>`)
})
