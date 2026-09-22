import { clipboard } from 'electron'
import { readFileSync } from 'node:fs'
import type { ClipStore, FieldCtx, ModelConfig, PageCtx, Post, Settings } from '@shared/types'
import {
  detectFieldType,
  extractCandidateFragments,
  isCandidateCompatible,
  isFillForbidden,
  scoreCandidate,
  type FieldExpect,
  type JevCandidate,
} from './matchers'
import type { DecisionBackend } from './onnx'
import type { IntelligenceHub } from './hub'

   
                                                                  
                                                                    
                                                
                                                           
                                                      
   

export interface JevSuggestItem {
  id: string
  title: string
  preview: string
  value: string
  scope: 'field' | 'global'
}

export type JevResult =
  | { action: 'fill'; value: string }
  | { action: 'suggest'; items: JevSuggestItem[] }
  | { action: 'none' }

export interface JevPipeline {
  handleFieldFocus(field: FieldCtx, page: PageCtx): Promise<JevResult>
}

const CANDIDATE_LIMIT = 50
const SUGGEST_TOP = 5
const CLIPBOARD_ID = '__clipboard__'
const CLIPBOARD_TITLE = '当前剪贴板'
const PREVIEW_MAX = 120
                           
const VECTOR_WEIGHT = 0.4
const SEMANTIC_CANDIDATES = 8
                     
const MODEL_OPTION_LIMIT = 12
                        
const MODEL_OPTION_TEXT_MAX = 200
                                                        
const MODEL_QUESTION = '哪个剪贴板内容最适合填入该字段'

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s
}

                                                 
function readContent(post: Post): string {
  if (post.contentPath) {
    try {
      const text = readFileSync(post.contentPath, 'utf8')
      if (text) return text
    } catch {
                             
    }
  }
  return post.preview ?? ''
}

function toCandidate(post: Post): JevCandidate {
  return {
    id: post.id,
    title: post.title,
    preview: post.preview,
    content: readContent(post),
    type: post.type,
    sourceApp: post.sourceApp,
    lastUsedAt: post.lastUsedAt,
    origin: 'history',
  }
}

                                  
function clipboardCandidate(): JevCandidate | null {
  try {
    const text = clipboard.readText()
    if (!text || !text.trim()) return null
    return {
      id: CLIPBOARD_ID,
      title: CLIPBOARD_TITLE,
      preview: truncate(text.trim(), PREVIEW_MAX),
      content: text,
      type: 'clipboard',
      sourceApp: '',
      lastUsedAt: Date.now(),
      origin: 'clipboard',
    }
  } catch (e) {
    console.error('[jev] read clipboard failed', e)
    return null
  }
}

function expandCandidate(cand: JevCandidate): JevCandidate[] {
  const fragments = extractCandidateFragments(cand.content)
  if (fragments.length === 0) return [cand]
  return fragments.map((fragment, index) => ({
    ...cand,
    id: `${cand.id}#fragment-${index}`,
    title: fragment.label,
    preview: fragment.context || fragment.value,
    content: fragment.value,
    kind: fragment.kind,
  }))
}

function candidateKey(cand: JevCandidate): string {
  return `${cand.kind ?? 'raw'}\u0000${cand.content.trim().toLowerCase()}`
}

function collectCandidates(
  store: ClipStore,
  hub: IntelligenceHub | null,
  semantic: boolean,
  typedValue: string,
): JevCandidate[] {
  const out: JevCandidate[] = []
  const seen = new Set<string>()
  const push = (candidate: JevCandidate): void => {
    for (const cand of expandCandidate(candidate)) {
      const key = candidateKey(cand)
      if (seen.has(key)) continue
      seen.add(key)
      out.push(cand)
    }
  }
  const clip = clipboardCandidate()
  if (clip) push(clip)
  const page = store.queryPosts({ keyword: '', type: 'all', limit: CANDIDATE_LIMIT })
  for (const p of page.items) {
    if (p.type !== 'text' && p.type !== 'link') continue
    const cand = toCandidate(p)
    if (!cand.content.trim()) continue
    push(cand)
  }
                                      
  if (typedValue.length >= 2) {
    try {
      const matches = store.queryPosts({ keyword: typedValue, type: 'all', limit: SEMANTIC_CANDIDATES })
      for (const p of matches.items) {
        if (p.type !== 'text' && p.type !== 'link') continue
        const cand = toCandidate(p)
        if (cand.content.trim()) push(cand)
      }
    } catch (e) {
      console.error('[jev] full-library candidate query failed', e)
    }
  }
                                          
  if (semantic && hub) {
    const fieldText = currentFieldText
    if (fieldText) {
      const ids = hub.semanticSearch(fieldText, SEMANTIC_CANDIDATES) || []
      for (const id of ids) {
        const post = store.getPost(id)
        if (!post || (post.type !== 'text' && post.type !== 'link')) continue
        const cand = toCandidate(post)
        if (!cand.content.trim()) continue
        push(cand)
      }
    }
  }
  return out
}

                                                                   
let currentFieldText = ''

interface ScoredCandidate {
  cand: JevCandidate
  score: number
  inputScore: number
}

function inputMatchScore(value: string, typedValue: string): number {
  const query = typedValue.trim().toLowerCase()
  if (!query) return 0
  const candidate = value.trim().toLowerCase()
  if (candidate === query) return 1
  if (candidate.startsWith(query)) return 0.95
  if (candidate.includes(query)) return 0.85
  const terms = query.split(/\s+/).filter(Boolean)
  if (terms.length > 0 && terms.every(term => candidate.includes(term))) return 0.7
  return 0
}

function makeSuggestItem(cand: JevCandidate): JevSuggestItem {
  return {
    id: cand.id,
    title: cand.title,
    preview: cand.preview,
    value: cand.content,
    scope: cand.origin === 'clipboard' ? 'field' : 'global',
  }
}

function orderedRelevant(
  scored: ScoredCandidate[],
  expect: FieldExpect,
  typedValue: string,
): ScoredCandidate[] {
  let compatible = scored.filter(item => isCandidateCompatible(item.cand, expect))
  if (typedValue.trim()) {
    const matchingInput = compatible.filter(item => item.inputScore > 0)
    if (matchingInput.length > 0) compatible = matchingInput
  }
  const field = compatible.filter(item => item.cand.origin === 'clipboard')
  const global = compatible.filter(item => item.cand.origin !== 'clipboard')
  if (field.length === 0) return global
  if (global.length === 0) return field
  return [field[0], global[0], ...field.slice(1), ...global.slice(1)]
}

                                                   
function activeDecisionModel(settings: Settings, mgr: DecisionBackend | null): ModelConfig | null {
  if (!mgr || mgr.status() !== 'ready') return null
  const id = settings.intelligence.activeModelId
  if (!id) return null
  const m = settings.intelligence.models.find(x => x.id === id)
  if (!m || !m.enabled || m.kind !== 'decision') return null
  return m
}

   
                                             
                                                  
                        
   
async function decideWithModel(
  mgr: DecisionBackend,
  settings: Settings,
  field: FieldCtx,
  page: PageCtx,
  scored: ScoredCandidate[],
  allowAutoFill: boolean,
): Promise<JevResult | null> {
  const top = scored.slice(0, MODEL_OPTION_LIMIT)
  if (top.length === 0) return null
  const options = top.map(s => truncate(s.cand.content, MODEL_OPTION_TEXT_MAX))
  const state = `字段: ${field.label || field.name || field.type} 页面: ${page.host}`
  let decision: { choice: number; confidence: number } | null = null
  try {
    decision = await mgr.decide(state, MODEL_QUESTION, options)
  } catch (e) {
                              
    console.error('[jev] decision model decide failed', e)
    decision = null
  }
  if (!decision || decision.choice < 0 || decision.choice >= top.length) return null

  const threshold = settings.jev.threshold
  const chosen = top[decision.choice]
  if (allowAutoFill && decision.confidence >= threshold && settings.browser.autoFill) {
    return { action: 'fill', value: chosen.cand.content }
  }
  if (decision.confidence >= threshold * 0.7) {
                                         
    const items: JevSuggestItem[] = []
    const seen = new Set<string>()
    const push = (c: JevCandidate): void => {
      if (seen.has(c.id)) return
      seen.add(c.id)
      items.push(makeSuggestItem(c))
    }
    push(chosen.cand)
    for (const s of scored.slice(0, 2)) push(s.cand)
    return { action: 'suggest', items: items.slice(0, SUGGEST_TOP) }
  }
                             
  return null
}

export function createJevPipeline(
  store: ClipStore,
  hub: IntelligenceHub | null = null,
  modelMgr: DecisionBackend | null = null,
): JevPipeline {
  async function handleFieldFocus(field: FieldCtx, page: PageCtx): Promise<JevResult> {
    const settings = store.getSettings()
                             
    if (!settings.browser.enabled || !settings.jev.enabled) return { action: 'none' }
                           
    if (isFillForbidden(field)) return { action: 'none' }

    const model = activeDecisionModel(settings, modelMgr)
    if (settings.jev.mode === 'model' && !model) {
                                             
      console.warn('[jev] model mode not available yet, fallback to rule matching')
    }

    const l1 = hub !== null && settings.intelligence.tier === 'embedding'
    const semantic = l1 && settings.intelligence.semanticSearch
    const vectorMatch = l1 && settings.intelligence.smartPasteMatch
    currentFieldText = [field.label, field.name, field.type].filter(Boolean).join(' ')

    const expect = detectFieldType(field)
    const typedValue = field.value.trim()
    const candidates = collectCandidates(store, hub, semantic, typedValue)
    if (candidates.length === 0) return { action: 'none' }

    const scored: ScoredCandidate[] = candidates.map((cand, index) => {
      const rule = scoreCandidate(cand, { expect, field, page, index, total: candidates.length })
                             
      let score = rule
      if (vectorMatch && hub) {
        const v = hub.vectorScore(currentFieldText, cand.content)
        if (v !== null) score = rule * (1 - VECTOR_WEIGHT) + v * VECTOR_WEIGHT
      }
      const inputScore = inputMatchScore(cand.content, typedValue)
      if (typedValue && inputScore > 0) score = score * 0.65 + inputScore * 0.35
      return { cand, score, inputScore }
    })
                                           
    scored.sort((a, b) => b.score - a.score)

    const relevant = orderedRelevant(scored, expect, typedValue)
    const reliable = relevant.filter(item => item.score >= settings.jev.threshold * 0.7)
    if (reliable.length === 0) return { action: 'none' }
    const fieldReliable = reliable.filter(item => item.cand.origin === 'clipboard')
    const autoPool = fieldReliable.length > 0 ? fieldReliable : reliable
                                          
    const allowAutoFill = typedValue.length === 0 && autoPool.length === 1
    const decisionPool = (allowAutoFill ? autoPool : reliable).slice(0, MODEL_OPTION_LIMIT)

                                          
    if (model && modelMgr) {
      const decided = await decideWithModel(modelMgr, settings, field, page, decisionPool, allowAutoFill)
      if (decided) return decided
    }

    const best = allowAutoFill ? autoPool[0] : reliable[0]
    const threshold = settings.jev.threshold

    if (allowAutoFill && best.score >= threshold && settings.browser.autoFill) {
      return { action: 'fill', value: best.cand.content }
    }
    if (reliable.length > 0) {
      return {
        action: 'suggest',
        items: reliable.slice(0, SUGGEST_TOP).map(s => makeSuggestItem(s.cand)),
      }
    }
    return { action: 'none' }
  }

  return { handleFieldFocus }
}
