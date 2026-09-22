import type { FieldCtx, PageCtx } from '@shared/types'

   
                           
                                                            
   

                                     
export type FieldExpect =
  | 'email'
  | 'phone'
  | 'url'
  | 'name'
  | 'company'
  | 'search'
  | 'text'
  | 'unknown'

                                    
export interface JevCandidate {
  id: string
  title: string
  preview: string
                                                
  content: string
  type: string
  sourceApp: string
  lastUsedAt: number
                              
  kind?: FieldExpect
                                      
  origin?: 'clipboard' | 'history'
}

export interface CandidateFragment {
  value: string
  kind: FieldExpect
  label: string
  context: string
}

export interface ScoreContext {
  expect: FieldExpect
  field: FieldCtx
  page: PageCtx
                                     
  index: number
  total: number
}

                                                                               

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const URL_RE = /^(https?|ftp):\/\/[^\s/$.?#].[^\s]*$/i
const PHONE_RE = /^1[3-9]\d{9}$/
const CN_RE = /^[\u4e00-\u9fa5]+$/
const EN_NAME_RE = /^[A-Za-z][A-Za-z.'\- ]{1,29}$/
const COMPANY_WORDS = [
  '公司',
  '企业',
  '集团',
  '科技',
  '有限',
  'inc',
  'ltd',
  'llc',
  'co.',
  'corp',
  'company',
]

export function isEmail(s: string): boolean {
  return EMAIL_RE.test(s.trim())
}

                                     
export function isPhone(s: string): boolean {
  const t = s.trim().replace(/[\s\-()]/g, '').replace(/^\+?86/, '')
  return PHONE_RE.test(t)
}

export function isUrl(s: string): boolean {
  return URL_RE.test(s.trim())
}

export function looksLikeName(s: string): boolean {
  const t = s.trim()
  if (!t || t.length > 30) return false
  if (CN_RE.test(t)) return t.length >= 2 && t.length <= 6
  return EN_NAME_RE.test(t)
}

export function looksLikeCompany(s: string): boolean {
  const t = s.trim().toLowerCase()
  if (!t || t.length > 60) return false
  return COMPANY_WORDS.some(w => t.includes(w))
}

                                                                                  

const EMAIL_SCAN_RE = /[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+/gi
const URL_SCAN_RE = /\b(?:https?|ftp):\/\/[^\s<>"'`]+/gi
const PHONE_SCAN_RE = /(?:\+?86[\s-]?)?1[3-9](?:[\s()-]?\d){9}/g
const TRAILING_URL_PUNCTUATION = /[.,;:!?，。；：！？、）)\]】}>》」』]+$/u
const LABEL_VALUE_RE = /^\s*([^:：=]{1,30})\s*[:：=]\s*(\S(?:.*\S)?)\s*$/u
const MAX_FRAGMENT_LENGTH = 300

const LABELED_KINDS: Array<{ kind: FieldExpect; words: string[] }> = [
  { kind: 'email', words: ['邮箱', '电子邮件', '电邮', 'email', 'e-mail', 'mail'] },
  { kind: 'phone', words: ['手机', '电话', '手机号', '手机号码', 'phone', 'tel', 'mobile'] },
  { kind: 'url', words: ['网址', '主页', '链接', '网站', 'url', 'website', 'link'] },
  { kind: 'name', words: ['姓名', '名字', '联系人', '收件人', 'name'] },
  { kind: 'company', words: ['公司', '单位', '企业', '组织', 'company', 'organization'] },
  { kind: 'text', words: ['地址', '简介', '介绍', '备注', '说明', 'address', 'bio', 'summary', 'note'] },
]

function contextLine(text: string, offset: number): string {
  const start = Math.max(text.lastIndexOf('\n', offset - 1) + 1, 0)
  const endIndex = text.indexOf('\n', offset)
  const end = endIndex < 0 ? text.length : endIndex
  return text.slice(start, end).replace(/\s+/g, ' ').trim().slice(0, MAX_FRAGMENT_LENGTH)
}

function labelBefore(line: string, value: string, fallback: string): string {
  const at = line.indexOf(value)
  if (at <= 0) return fallback
  const prefix = line.slice(0, at).replace(/^[\s\d._-]+|[\s:：=→>-]+$/g, '').trim()
  return prefix ? prefix.slice(-30) : fallback
}

function labeledKind(label: string): FieldExpect | null {
  const lower = label.toLowerCase()
  for (const item of LABELED_KINDS) {
    if (item.words.some(word => lower.includes(word))) return item.kind
  }
  return null
}

function fragmentKey(kind: FieldExpect, value: string): string {
  return `${kind}\u0000${value.trim().toLowerCase()}`
}

   
                        
                                             
   
export function extractCandidateFragments(input: string): CandidateFragment[] {
  const text = input.replace(/\0/g, '').replace(/\r\n?/g, '\n')
  const out: CandidateFragment[] = []
  const seen = new Set<string>()
  const push = (value: string, kind: FieldExpect, offset: number, fallback: string): void => {
    const clean = value.trim()
    if (!clean || clean.length > MAX_FRAGMENT_LENGTH) return
    const key = fragmentKey(kind, clean)
    if (seen.has(key)) return
    seen.add(key)
    const context = contextLine(text, offset)
    out.push({ value: clean, kind, label: labelBefore(context, value, fallback), context })
  }

  for (const match of text.matchAll(EMAIL_SCAN_RE)) {
    push(match[0], 'email', match.index, '邮箱')
  }
  for (const match of text.matchAll(URL_SCAN_RE)) {
    const value = match[0].replace(TRAILING_URL_PUNCTUATION, '')
    push(value, 'url', match.index, '网址')
  }
  for (const match of text.matchAll(PHONE_SCAN_RE)) {
    const before = match.index > 0 ? text[match.index - 1] : ''
    const after = text[match.index + match[0].length] ?? ''
    if (/\d/.test(before) || /\d/.test(after)) continue
    push(match[0], 'phone', match.index, '手机号码')
  }

  let lineOffset = 0
  for (const line of text.split('\n')) {
    const match = line.match(LABEL_VALUE_RE)
    if (match) {
      const label = match[1].trim()
      const value = match[2].trim()
      const kind = labeledKind(label)
      if (kind && kind !== 'email' && kind !== 'url' && kind !== 'phone') {
        push(value, kind, lineOffset + line.indexOf(value), label)
      }
    }
    lineOffset += line.length + 1
  }
  return out.sort((a, b) => text.indexOf(a.value) - text.indexOf(b.value))
}

export function isCandidateCompatible(cand: JevCandidate, expect: FieldExpect): boolean {
                                                  
  if (cand.kind && cand.kind !== 'text') return cand.kind === expect
  if (expect === 'email') return isEmail(cand.content)
  if (expect === 'phone') return isPhone(cand.content)
  if (expect === 'url') return isUrl(cand.content)
  if (expect === 'name') return looksLikeName(cand.content)
  if (expect === 'company') return looksLikeCompany(cand.content)
  if (cand.kind && cand.kind !== 'text') return false
  return true
}

                                                                                

const FIELD_KEYWORDS: Array<{ expect: FieldExpect; words: string[] }> = [
  { expect: 'email', words: ['邮箱', '电子邮件', '电邮', '邮件地址', 'email', 'e-mail', 'mail'] },
  { expect: 'phone', words: ['手机', '电话', '手机号', '手机号码', '电话号码', 'phone', 'tel', 'mobile'] },
  { expect: 'url', words: ['网址', '链接', '域名', 'url', 'website', 'link', 'domain'] },
  { expect: 'name', words: ['姓名', '名字', '收货人', '收件人', '用户名', 'name', 'username'] },
  { expect: 'company', words: ['公司', '单位', '企业', '单位名称', 'company', 'firm', 'corp', 'organization'] },
  { expect: 'search', words: ['搜索', '关键词', '关键字', 'search', 'query', 'keyword'] },
]

                              
function typeAttrExpect(type: string): FieldExpect | null {
  switch (type) {
    case 'email':
      return 'email'
    case 'tel':
      return 'phone'
    case 'url':
      return 'url'
    case 'search':
      return 'search'
    case 'password':
      return 'unknown'
    default:
      return null
  }
}

function keywordExpect(haystack: string): FieldExpect | null {
  const lower = haystack.toLowerCase()
  if (!lower) return null
  for (const { expect, words } of FIELD_KEYWORDS) {
    if (words.some(w => lower.includes(w))) return expect
  }
  return null
}

                                                      
export function detectFieldType(field: FieldCtx): FieldExpect {
  const type = (field.type ?? '').toLowerCase()
  const byAttr = typeAttrExpect(type)
  if (byAttr) return byAttr
  const byLabel = keywordExpect(field.label ?? '')
  if (byLabel) return byLabel
                                                        
  const byName = keywordExpect(field.name ?? '')
  if (byName) return byName
  return 'text'
}

                        
export function isFillForbidden(field: FieldCtx): boolean {
  return (field.type ?? '').toLowerCase() === 'password'
}

                                                                                 

const EN_STOP = new Set(['the', 'a', 'an', 'of', 'to', 'and', 'or', 'for', 'in', 'on', 'at', 'is', 'are', 'www', 'com'])

                                
function terms(s: string): string[] {
  const out: string[] = []
  const lower = s.toLowerCase()
  for (const w of lower.match(/[a-z0-9]+/g) ?? []) {
    if (w.length >= 2 && !EN_STOP.has(w)) out.push(w)
  }
  for (const run of lower.match(/[\u4e00-\u9fa5]+/g) ?? []) {
    if (run.length === 1) {
      out.push(run)
      continue
    }
    for (let i = 0; i + 1 < run.length; i++) out.push(run.slice(i, i + 2))
  }
  return out
}

                                               
export function labelOverlap(label: string, content: string): number {
  const l = terms(label)
  if (l.length === 0) return 0
  const c = new Set(terms(content))
  let hit = 0
  for (const t of l) if (c.has(t)) hit++
  return hit / l.length
}

                                                    
export function sourceAppRelevance(cand: JevCandidate, page: PageCtx): number {
  const host = (page.host ?? '').toLowerCase()
  if (!host) return 0
  if (cand.content.toLowerCase().includes(host)) return 1
  const tokens = host.split('.').filter(t => t.length >= 3 && t !== 'www')
  const app = (cand.sourceApp ?? '').toLowerCase()
  if (!app) return 0
  return tokens.some(t => app.includes(t)) ? 1 : 0
}

                                                                              

                                              
function baseScore(expect: FieldExpect, content: string): number {
  const c = content.trim()
  switch (expect) {
    case 'email':
      return isEmail(c) ? 0.95 : 0.15
    case 'phone':
      return isPhone(c) ? 0.95 : 0.15
    case 'url':
      return isUrl(c) ? 0.95 : 0.2
    case 'name':
      return looksLikeName(c) ? 0.85 : 0.3
    case 'company':
      return looksLikeCompany(c) ? 0.85 : 0.3
    case 'search':
    case 'text':
      return 0.45
    default:
      return 0.35
  }
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

                                                  
export function scoreCandidate(cand: JevCandidate, ctx: ScoreContext): number {
  const base = baseScore(ctx.expect, cand.content)
  const overlap = labelOverlap(ctx.field.label, `${cand.title} ${cand.preview} ${cand.content}`)
  const appRel = sourceAppRelevance(cand, ctx.page)
  const recency = ctx.total > 1 ? 1 - Math.min(ctx.index, ctx.total - 1) / (ctx.total - 1) : 1
  if (base >= 0.8) {
    return clamp01(0.95 + 0.03 * overlap + 0.01 * appRel + 0.02 * recency)
  }
  const rawHistoryPenalty =
    ctx.expect === 'text' && cand.origin === 'history' && !cand.kind ? 0.15 : 0
  return clamp01(
    base * 0.6 + overlap * 0.35 + appRel * 0.05 + recency * 0.05 - rawHistoryPenalty,
  )
}
