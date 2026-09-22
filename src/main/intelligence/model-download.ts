import { net } from 'electron'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { closeSync, existsSync, mkdirSync, openSync, renameSync, rmSync, statSync, writeFileSync, writeSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import type { ModelDownloadInfo, ModelDownloadResult } from '@shared/types'

interface CatalogEntry {
  id: string
  repo: string
  revision: string
  totalBytes: number
  files: string[]
}

const CATALOG: CatalogEntry[] = [
  {
    id: 'bge-small-zh-q8',
    repo: 'Xenova/bge-small-zh-v1.5',
    revision: 'main',
    totalBytes: 25_000_000,
    files: [
      'config.json',
      'special_tokens_map.json',
      'tokenizer.json',
      'tokenizer_config.json',
      'vocab.txt',
      'onnx/model_quantized.onnx',
    ],
  },
  {
    id: 'minilm-multilingual-q8',
    repo: 'Xenova/paraphrase-multilingual-MiniLM-L12-v2',
    revision: 'main',
    totalBytes: 136_000_000,
    files: [
      'config.json',
      'special_tokens_map.json',
      'tokenizer.json',
      'tokenizer_config.json',
      'unigram.json',
      'onnx/model_quantized.onnx',
    ],
  },
]

const catalogById = new Map(CATALOG.map(item => [item.id, item]))

function initialInfo(id: string, totalBytes: number): ModelDownloadInfo {
  return { modelId: id, state: 'not-downloaded', receivedBytes: 0, totalBytes }
}

function targetDir(modelsRoot: string, id: string): string {
  const root = resolve(modelsRoot)
  const target = resolve(root, id)
  if (!target.startsWith(`${root}\\`) && target !== root) throw new Error('模型目录越界')
  return target
}

function isInstalled(modelsRoot: string, entry: CatalogEntry): boolean {
  const root = targetDir(modelsRoot, entry.id)
  return entry.files.every(file => existsSync(join(root, file)))
}

function modelUrl(entry: CatalogEntry, file: string): string {
  const safeFile = file.split('/').map(encodeURIComponent).join('/')
  return `https://huggingface.co/${entry.repo}/resolve/${entry.revision}/${safeFile}?download=true`
}

async function hashFile(path: string): Promise<string> {
  const digest = createHash('sha256')
  for await (const chunk of createReadStream(path)) digest.update(chunk)
  return digest.digest('hex')
}

async function readChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  controller: AbortController,
): Promise<{ done: boolean; value?: Uint8Array }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      controller.abort()
      reject(new Error('下载超过 30 秒无数据'))
    }, 30_000)
    reader.read().then(
      result => {
        clearTimeout(timer)
        resolve(result)
      },
      error => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

async function downloadAttempt(
  url: string,
  path: string,
  onChunk: (size: number) => void,
): Promise<void> {
  const existingSize = existsSync(path) ? statSync(path).size : 0
  const controller = new AbortController()
  const headers = existingSize > 0 ? { Range: `bytes=${existingSize}-` } : undefined
  const response = await net.fetch(url, { redirect: 'follow', headers, signal: controller.signal })
  if (!response.ok || !response.body) throw new Error(`下载失败 ${response.status}`)
  mkdirSync(dirname(path), { recursive: true })
  const resumed = existingSize > 0 && response.status === 206
  if (existingSize > 0 && !resumed) onChunk(-existingSize)
  const fd = openSync(path, resumed ? 'a' : 'w')
  try {
    const reader = response.body.getReader()
    while (true) {
      const part = await readChunk(reader, controller)
      if (part.done) break
      if (!part.value) continue
      const chunk = Buffer.from(part.value)
      writeSync(fd, chunk)
      onChunk(chunk.byteLength)
    }
  } finally {
    closeSync(fd)
  }
}

async function downloadFile(
  url: string,
  path: string,
  onChunk: (size: number) => void,
): Promise<string> {
  let lastError: unknown = null
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await downloadAttempt(url, path, onChunk)
      return await hashFile(path)
    } catch (e) {
      lastError = e
      console.error(`[model-download] 文件下载第 ${attempt} 次失败`, url, e)
    }
  }
  throw lastError instanceof Error ? lastError : new Error('下载失败')
}

export interface ModelDownloader {
  info(modelId: string): ModelDownloadInfo
  download(modelId: string): Promise<ModelDownloadResult>
}

class ModelDownloaderImpl implements ModelDownloader {
  private readonly states = new Map<string, ModelDownloadInfo>()
  private readonly running = new Map<string, Promise<ModelDownloadResult>>()

  constructor(
    private readonly modelsRoot: string,
    private readonly emit: (info: ModelDownloadInfo) => void,
  ) {}

  info(modelId: string): ModelDownloadInfo {
    const entry = catalogById.get(modelId)
    if (!entry) return initialInfo(modelId, 0)
    const current = this.states.get(modelId)
    if (current?.state === 'downloading' || current?.state === 'failed') return { ...current }
    const installed = isInstalled(this.modelsRoot, entry)
    return {
      modelId,
      state: installed ? 'downloaded' : 'not-downloaded',
      receivedBytes: installed ? entry.totalBytes : 0,
      totalBytes: entry.totalBytes,
    }
  }

  private publish(next: ModelDownloadInfo): void {
    this.states.set(next.modelId, next)
    this.emit({ ...next })
  }

  private async perform(entry: CatalogEntry): Promise<ModelDownloadResult> {
    const finalDir = targetDir(this.modelsRoot, entry.id)
    const tempDir = targetDir(this.modelsRoot, `.${entry.id}.downloading`)
    let receivedBytes = 0
    try {
      rmSync(tempDir, { recursive: true, force: true })
      mkdirSync(tempDir, { recursive: true })
      this.publish({
        modelId: entry.id,
        state: 'downloading',
        receivedBytes,
        totalBytes: entry.totalBytes,
      })
      const hashes: Record<string, string> = {}
      for (const file of entry.files) {
        hashes[file] = await downloadFile(modelUrl(entry, file), join(tempDir, file), size => {
          receivedBytes += size
          this.publish({
            modelId: entry.id,
            state: 'downloading',
            receivedBytes,
            totalBytes: Math.max(entry.totalBytes, receivedBytes),
          })
        })
      }
      writeFileSync(
        join(tempDir, 'clipnest-model.json'),
        JSON.stringify({ repo: entry.repo, revision: entry.revision, hashes }, null, 2),
        'utf8',
      )
      rmSync(finalDir, { recursive: true, force: true })
      renameSync(tempDir, finalDir)
      const done: ModelDownloadInfo = {
        modelId: entry.id,
        state: 'downloaded',
        receivedBytes,
        totalBytes: receivedBytes,
      }
      this.publish(done)
      return { ok: true, info: done }
    } catch (e) {
      console.error('[model-download] 下载失败', entry.id, e)
      try {
        rmSync(tempDir, { recursive: true, force: true })
      } catch (cleanupError) {
        console.error('[model-download] 清理临时目录失败', cleanupError)
      }
      const failed: ModelDownloadInfo = {
        modelId: entry.id,
        state: 'failed',
        receivedBytes,
        totalBytes: entry.totalBytes,
        error: e instanceof Error ? e.message : '下载失败',
      }
      this.publish(failed)
      return { ok: false, info: failed }
    }
  }

  download(modelId: string): Promise<ModelDownloadResult> {
    const entry = catalogById.get(modelId)
    if (!entry) {
      const failed: ModelDownloadInfo = {
        modelId,
        state: 'failed',
        receivedBytes: 0,
        totalBytes: 0,
        error: '该模型不支持应用内下载',
      }
      console.error('[model-download] 未知模型', modelId)
      return Promise.resolve({ ok: false, info: failed })
    }
    const existing = this.running.get(modelId)
    if (existing) return existing
    const task = this.perform(entry).finally(() => this.running.delete(modelId))
    this.running.set(modelId, task)
    return task
  }
}

export function createModelDownloader(
  modelsRoot: string,
  emit: (info: ModelDownloadInfo) => void,
): ModelDownloader {
  return new ModelDownloaderImpl(modelsRoot, emit)
}
