import { existsSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import type { ModelConfig, ModelState } from '@shared/types'
import type { FeatureExtractionPipeline, TextClassificationPipeline, TextGenerationPipeline } from '@huggingface/transformers'
import { extractCandidateFragments, type CandidateFragment, type FieldExpect } from './matchers'

   
                                                      
  
                                                
                                                  
                    
  
                                                          
                                                   
   

export interface DecisionBackend {
                                    
  load(config: ModelConfig): Promise<void>
                                                   
  decide(
    state: string,
    question: string,
    options: string[],
  ): Promise<{ choice: number; confidence: number } | null>
  extract(text: string): Promise<CandidateFragment[] | null>
  status(): ModelState
  unload(): Promise<void>
}

const EXTRACT_FIELDS: Array<{ kind: FieldExpect; label: string }> = [
  { kind: 'name', label: '姓名' },
  { kind: 'company', label: '公司' },
  { kind: 'email', label: '邮箱' },
  { kind: 'phone', label: '手机号码' },
  { kind: 'url', label: '网址' },
]

function parseGeneratedJson(text: string): Record<string, unknown> | null {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const value = JSON.parse(text.slice(start, end + 1)) as unknown
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null
  } catch (error) {
    console.error('[onnx] 结构化结果解析失败', error)
    return null
  }
}

function toFragments(value: Record<string, unknown>, context: string): CandidateFragment[] {
  const output: CandidateFragment[] = []
  for (const field of EXTRACT_FIELDS) {
    const raw = value[field.kind]
    const values = Array.isArray(raw) ? raw : raw == null ? [] : [raw]
    for (const item of values) {
      const text = typeof item === 'string' ? item.trim() : ''
      if (!text || text.length > 300) continue
      if (field.kind === 'email' || field.kind === 'phone' || field.kind === 'url') {
        const exact = extractCandidateFragments(text).find(fragment => fragment.kind === field.kind)
        if (!exact) continue
        output.push({ value: exact.value, kind: field.kind, label: field.label, context })
      } else {
        output.push({ value: text, kind: field.kind, label: field.label, context })
      }
    }
  }
  return output
}

                                                       
const STATE_TAG = '[STATE]'
const Q_TAG = '[Q]'
const OPT_TAG = '[OPT]'
                                       
const DECIDE_OPTION_HARD_CAP = 128

                                                                
const POSITIVE_LABEL_RE = /^(label[_-]?)?1$|^(yes|true|positive|entail|entailment|fit|match|relevant)$/i
                                
const NEGATIVE_LABEL_RE = /^(label[_-]?)?0$|^(no|false|negative|contradiction|contradict|unfit|mismatch|irrelevant)$/i

type ClassifierRow = { label: string; score: number }

let modelsRoot = ''

                                                      
export function bindModelsRoot(dir: string): void {
  modelsRoot = dir || ''
}

                                  
export function resolveModelPath(path: string): string {
  const p = (path ?? '').trim()
  if (!p) return ''
  return isAbsolute(p) ? p : resolve(modelsRoot || '.', p)
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0
  return v < 0 ? 0 : v > 1 ? 1 : v
}

                                             
function positiveScore(rows: ClassifierRow[]): number {
  if (!Array.isArray(rows) || rows.length === 0) return 0
  let best = 0
  let positive = -1
  let negative = -1
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    if (!r || typeof r.score !== 'number' || !Number.isFinite(r.score)) continue
    const label = typeof r.label === 'string' ? r.label : ''
    if (POSITIVE_LABEL_RE.test(label)) positive = i
    else if (NEGATIVE_LABEL_RE.test(label)) negative = i
    if (r.score > best) best = r.score
  }
  if (positive >= 0) return clamp01(rows[positive].score)
  if (negative >= 0 && rows.length === 2) return clamp01(1 - rows[negative].score)
  return clamp01(best)
}

                                                 
function softmax(scores: number[]): number[] {
  if (scores.length === 0) return []
  const max = Math.max(...scores)
  const exps = scores.map(s => Math.exp(s - max))
  const sum = exps.reduce((a, b) => a + b, 0)
  if (!(sum > 0)) return scores.map(() => 1 / scores.length)
  return exps.map(e => e / sum)
}

function createBackend(): DecisionBackend {
  let classifier: TextClassificationPipeline | null = null
  let extractor: FeatureExtractionPipeline | null = null
  let generator: TextGenerationPipeline | null = null
  let state: ModelState = 'unloaded'
  let loadedId = ''
                                        
  let chain: Promise<unknown> = Promise.resolve()
  const extractionCache = new Map<string, CandidateFragment[]>()

  function enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const next = chain.then(fn, fn)
    chain = next.then(
      () => undefined,
      () => undefined,
    )
    return next
  }

                                       
  async function ensureTransformers(): Promise<typeof import('@huggingface/transformers')> {
    const mod = (await import('@huggingface/transformers')) as typeof import('@huggingface/transformers')
                                                    
    const lib = ((mod as { default?: typeof mod }).default ?? mod) as typeof mod
                                   
    lib.env.allowRemoteModels = false
    lib.env.allowLocalModels = true
    return lib
  }

  async function unload(): Promise<void> {
    const c = classifier
    const e = extractor
    const g = generator
    classifier = null
    extractor = null
    generator = null
    extractionCache.clear()
    loadedId = ''
    state = 'unloaded'
    if (c) {
      try {
        await c.dispose()
      } catch (e) {
        console.error('[onnx] dispose failed', e)
      }
    }
    if (e) {
      try {
        await e.dispose()
      } catch (error) {
        console.error('[onnx] dispose embedding model failed', error)
      }
    }
    if (g) {
      try {
        await g.dispose()
      } catch (error) {
        console.error('[onnx] dispose extraction model failed', error)
      }
    }
  }

  async function load(config: ModelConfig): Promise<void> {
    return enqueue(async () => {
      const dir = resolveModelPath(config.path)
                                                           
      if (!dir || !existsSync(dir) || !existsSync(join(dir, 'config.json'))) {
        await unload()
        state = 'failed'
        console.error('[onnx] 决策模型目录无效（缺少 config.json）:', config.path, '->', dir || '(空路径)')
        return
      }
      await unload()
      state = 'loading'
      try {
        const mod = await ensureTransformers()
        if (config.task === 'text-generation') {
          generator = await mod.pipeline('text-generation', dir, {
            dtype: config.dtype ?? 'q8',
            local_files_only: true,
          })
        } else if (config.task === 'feature-extraction') {
          extractor = await mod.pipeline('feature-extraction', dir, {
            dtype: config.dtype ?? 'q8',
            local_files_only: true,
          })
        } else {
          classifier = await mod.pipeline('text-classification', dir, {
            local_files_only: true,
          })
        }
        loadedId = config.id
        state = 'ready'
        console.log('[onnx] 决策模型已加载:', config.name, '->', dir)
      } catch (e) {
        classifier = null
        loadedId = ''
        state = 'failed'
        console.error('[onnx] 决策模型加载失败:', config.path, e)
      }
    })
  }

  async function decide(
    state: string,
    question: string,
    options: string[],
  ): Promise<{ choice: number; confidence: number } | null> {
    const c = classifier
    const e = extractor
    if ((!c && !e) || state !== 'ready') return null
    const opts = options.slice(0, DECIDE_OPTION_HARD_CAP)
    if (opts.length === 0) return null
    try {
      if (e) {
        const query = `${state}\n${question}`
        const tensor = await e([query, ...opts], { pooling: 'mean', normalize: true })
        const vectors = tensor.tolist() as number[][]
        const queryVector = vectors[0]
        if (!queryVector || vectors.length !== opts.length + 1) return null
        const scores = vectors.slice(1).map(vector =>
          vector.reduce((sum, value, index) => sum + value * (queryVector[index] ?? 0), 0),
        )
        const probs = softmax(scores.map(score => score * 8))
        let choice = 0
        for (let i = 1; i < probs.length; i++) {
          if (probs[i] > probs[choice]) choice = i
        }
        return { choice, confidence: probs[choice] }
      }
      if (!c) return null
      const scores: number[] = []
      for (const opt of opts) {
        const text = `${STATE_TAG} ${state} ${Q_TAG} ${question} ${OPT_TAG} ${opt}`
        const rows = (await c(text, { top_k: null })) as ClassifierRow[]
        scores.push(positiveScore(rows))
      }
      const probs = softmax(scores)
      let choice = 0
      for (let i = 1; i < probs.length; i++) {
        if (probs[i] > probs[choice]) choice = i
      }
      return { choice, confidence: probs[choice] }
    } catch (e) {
                               
      console.error('[onnx] decide failed', e)
      return null
    }
  }

  async function extract(text: string): Promise<CandidateFragment[] | null> {
    const g = generator
    const source = text.trim().slice(0, 4_000)
    if (!g || state !== 'ready' || !source) return null
    const cached = extractionCache.get(source)
    if (cached) return cached.map(item => ({ ...item }))
    const template = JSON.stringify(Object.fromEntries(EXTRACT_FIELDS.map(field => [field.kind, []])))
    const prompt = `<|input|>\n### Template:\n${template}\n### Text:\n${source}\n\n<|output|>`
    try {
      const rows = await g(prompt, { max_new_tokens: 180, do_sample: false, return_full_text: false })
      const generated = rows[0]?.generated_text
      if (typeof generated !== 'string') {
        console.error('[onnx] 结构化模型未返回文本')
        return null
      }
      const parsed = parseGeneratedJson(generated)
      if (!parsed) return null
      const result = toFragments(parsed, source.replace(/\s+/g, ' ').slice(0, 300))
      extractionCache.set(source, result)
      if (extractionCache.size > 32) extractionCache.delete(extractionCache.keys().next().value ?? '')
      return result.map(item => ({ ...item }))
    } catch (error) {
      console.error('[onnx] 结构化拆分失败', error)
      return null
    }
  }

  return {
    load,
    decide,
    extract,
    status: () => state,
    unload,
  }
}

let singleton: DecisionBackend | null = null

                        
export function getDecisionBackend(): DecisionBackend {
  if (!singleton) singleton = createBackend()
  return singleton
}
