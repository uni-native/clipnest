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
  handleFieldFocus(field: FieldCtx, page: PageCtx, traceId?: string): Promise<JevResult>
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
const MODEL_AMBIGUITY_MARGIN = 0.025
const MODEL_FIRST_FIELD_TYPES = new Set<FieldExpect>([
  'firstName',
  'lastName',
  'gender',
  'jobTitle',
  'username',
  'address',
  'postalCode',
  'country',
  'region',
  'city',
  'county',
  'birthday',
  'text',
  'unknown',
])
                                                        
const MODEL_QUESTION = '哪个剪贴板内容最适合填入该字段'
const MODEL_FIELD_QUESTION = '这个网页输入字段最可能用于填写哪一类内容'
const MODEL_FIELD_CONFIDENCE = 0.3
const MODEL_FIELD_TYPES: Array<{ expect: FieldExpect; description: string }> = [
  { expect: 'email', description: '电子邮箱 email address work email personal email' },
  { expect: 'phone', description: '电话号码 手机号码 座机 phone mobile telephone' },
  { expect: 'url', description: '网址 个人主页 网站链接 URL website homepage portfolio' },
  { expect: 'name', description: '真实姓名 联系人 收件人 full name given name family name' },
  { expect: 'firstName', description: '名字 名 given name first name' },
  { expect: 'lastName', description: '姓氏 姓 family name last name surname' },
  { expect: 'gender', description: '性别 gender sex' },
  { expect: 'username', description: '用户名 登录账号 user name login account handle' },
  { expect: 'company', description: '公司 单位 组织 company organization employer' },
  { expect: 'jobTitle', description: '职位 职务 岗位 job title occupation position' },
  { expect: 'address', description: '详细地址 街道 收货地址 street address shipping address' },
  { expect: 'postalCode', description: '邮政编码 邮编 postal code zip code' },
  { expect: 'country', description: '国家 country nation' },
  { expect: 'region', description: '省份 州 地区 province state region' },
  { expect: 'city', description: '城市 city locality town' },
  { expect: 'county', description: '区县 county district' },
  { expect: 'birthday', description: '生日 出生日期 birthday date of birth' },
  { expect: 'date', description: '日期 年月 月份 date month year calendar' },
  { expect: 'time', description: '时间 时刻 time hour minute' },
  { expect: 'number', description: '数字 数量 数值 number quantity count' },
  { expect: 'search', description: '搜索 查询 关键词 search query keyword' },
  { expect: 'text', description: '简介 介绍 备注 说明 bio profile summary note description' },
  { expect: 'unknown', description: '无法确定用途 未知字段 unrelated unknown none' },
]

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

function expandCandidate(cand: JevCandidate, modelFragments: ReturnType<typeof extractCandidateFragments> = []): JevCandidate[] {
  const fragments = [...extractCandidateFragments(cand.content), ...modelFragments]
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

async function collectCandidates(
  store: ClipStore,
  hub: IntelligenceHub | null,
  semantic: boolean,
  typedValue: string,
  extractor: DecisionBackend | null,
): Promise<JevCandidate[]> {
  const out: JevCandidate[] = []
  const seen = new Set<string>()
  const push = (candidate: JevCandidate, modelFragments: ReturnType<typeof extractCandidateFragments> = []): void => {
    for (const cand of expandCandidate(candidate, modelFragments)) {
      const key = candidateKey(cand)
      if (seen.has(key)) continue
      seen.add(key)
      out.push(cand)
    }
  }
  const clip = clipboardCandidate()
  if (clip) {
    let modelFragments: ReturnType<typeof extractCandidateFragments> = []
    if (extractor) {
      try {
        modelFragments = await extractor.extract(clip.content) ?? []
      } catch (error) {
        console.error('[jev] 结构化拆分失败', error)
      }
    }
    push(clip, modelFragments)
  }
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
  ruleScore: number
  inputScore: number
}

function traceDecision(traceId: string, event: string, detail: Record<string, unknown> = {}): void {
  console.log('[jev] decision', { traceId, event, ...detail })
}

function candidateLog(item: ScoredCandidate): Record<string, unknown> {
  return {
    id: item.cand.id,
    origin: item.cand.origin ?? 'unknown',
    kind: item.cand.kind ?? 'raw',
    type: item.cand.type,
    length: item.cand.content.length,
    score: Number(item.score.toFixed(4)),
    ruleScore: Number(item.ruleScore.toFixed(4)),
    inputScore: Number(item.inputScore.toFixed(4)),
  }
}

function needsModelDecision(scored: ScoredCandidate[], expect: FieldExpect): boolean {
  if (scored.length < 2) return false
  if (MODEL_FIRST_FIELD_TYPES.has(expect)) return true
  return Math.abs(scored[0].score - scored[1].score) <= MODEL_AMBIGUITY_MARGIN
}

function fieldDescription(field: FieldCtx): string {
  return [
    field.label,
    field.name,
    field.type,
    field.autocomplete,
    field.inputMode,
    field.role,
    field.html,
  ].filter(Boolean).join(' ')
}

async function inferFieldTypeWithModel(
  mgr: DecisionBackend,
  field: FieldCtx,
  page: PageCtx,
): Promise<FieldExpect> {
  try {
    const result = await mgr.decide(
      `字段: ${fieldDescription(field)} 页面: ${page.host}`,
      MODEL_FIELD_QUESTION,
      MODEL_FIELD_TYPES.map(item => item.description),
    )
    if (!result || result.confidence < MODEL_FIELD_CONFIDENCE) return 'unknown'
    return MODEL_FIELD_TYPES[result.choice]?.expect ?? 'unknown'
  } catch (error) {
    console.error('[jev] MiniLM 字段类型判断失败', error)
    return 'unknown'
  }
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

function activeExtractorModel(settings: Settings, mgr: DecisionBackend | null): ModelConfig | null {
  if (!mgr || mgr.status() !== 'ready') return null
  const model = settings.intelligence.models.find(item => item.id === settings.intelligence.activeModelId)
  return model?.enabled && model.kind === 'extractor' ? model : null
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
  const options = top.map(s => truncate(
    [s.cand.title, s.cand.preview, s.cand.content].filter(Boolean).join(' | '),
    MODEL_OPTION_TEXT_MAX,
  ))
  const state = `字段: ${fieldDescription(field)} 页面: ${page.host}`
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
  async function handleFieldFocus(field: FieldCtx, page: PageCtx, traceId = ''): Promise<JevResult> {
    const settings = store.getSettings()
    traceDecision(traceId, 'start', {
      fieldId: field.id,
      label: field.label,
      fieldType: field.type,
      host: page.host,
      inputLength: field.value.length,
      mode: settings.jev.mode,
      tier: settings.intelligence.tier,
    })
                             
    if (!settings.browser.enabled || !settings.jev.enabled) {
      traceDecision(traceId, 'blocked-disabled')
      return { action: 'none' }
    }
                           
    if (isFillForbidden(field, settings.browser.sensitiveFill)) {
      traceDecision(traceId, 'blocked-sensitive')
      return { action: 'none' }
    }

    const decisionModel = settings.jev.mode === 'model'
      ? activeDecisionModel(settings, modelMgr)
      : null
    const extractorModel = settings.jev.mode === 'model'
      ? activeExtractorModel(settings, modelMgr)
      : null
    if (settings.jev.mode === 'model' && !decisionModel && !extractorModel) {
                                             
      console.warn('[jev] model mode not available yet, fallback to rule matching')
    }

    const l1 = hub !== null && settings.intelligence.tier === 'embedding'
    const semantic = l1 && settings.intelligence.semanticSearch
    const vectorMatch = l1 && settings.intelligence.smartPasteMatch
    currentFieldText = fieldDescription(field)

    let expect = detectFieldType(field)
    if (expect === 'unknown' && decisionModel && modelMgr) {
      expect = await inferFieldTypeWithModel(modelMgr, field, page)
    }
    traceDecision(traceId, 'field-type', { expect, modelUsed: expect !== detectFieldType(field) })
    if (expect === 'unknown') {
      traceDecision(traceId, 'blocked-unknown-field')
      return { action: 'none' }
    }
    const typedValue = field.value.trim()
    const candidates = await collectCandidates(store, hub, semantic, typedValue, extractorModel ? modelMgr : null)
    traceDecision(traceId, 'candidates-collected', { count: candidates.length })
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
      return { cand, score, ruleScore: rule, inputScore }
    })
                                           
    scored.sort((a, b) => b.score - a.score)

    const relevant = orderedRelevant(scored, expect, typedValue)
    const reliable = relevant.filter(item => item.score >= settings.jev.threshold * 0.7)
    traceDecision(traceId, 'candidates-ranked', {
      expect,
      threshold: settings.jev.threshold,
      compatibleCount: relevant.length,
      reliableCount: reliable.length,
      top: relevant.slice(0, 5).map(candidateLog),
    })
    if (reliable.length === 0) {
      traceDecision(traceId, 'none-no-reliable-candidate')
      return { action: 'none' }
    }
    const fieldReliable = reliable.filter(item => item.cand.origin === 'clipboard')
    const autoPool = fieldReliable.length > 0 ? fieldReliable : reliable
                                          
    const allowAutoFill = typedValue.length === 0 && autoPool.length === 1
    const decisionPool = (allowAutoFill ? autoPool : reliable).slice(0, MODEL_OPTION_LIMIT)

                                          
    if (decisionModel && modelMgr && needsModelDecision(decisionPool, expect)) {
      const decided = await decideWithModel(modelMgr, settings, field, page, decisionPool, allowAutoFill)
      if (decided) {
        traceDecision(traceId, 'model-result', { action: decided.action })
        return decided
      }
    }

    const best = allowAutoFill ? autoPool[0] : reliable[0]
    const threshold = settings.jev.threshold

    if (allowAutoFill && best.score >= threshold && settings.browser.autoFill) {
      traceDecision(traceId, 'fill', candidateLog(best))
      return { action: 'fill', value: best.cand.content }
    }
    if (reliable.length > 0) {
      traceDecision(traceId, 'suggest', { count: Math.min(reliable.length, SUGGEST_TOP) })
      return {
        action: 'suggest',
        items: reliable.slice(0, SUGGEST_TOP).map(s => makeSuggestItem(s.cand)),
      }
    }
    return { action: 'none' }
  }

  return { handleFieldFocus }
}
