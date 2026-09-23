import type { FieldCtx, PageCtx, SensitiveFieldKind, SensitiveFillSettings } from '@shared/types'

   
                           
                                                            
   

                                     
export type FieldExpect =
  | 'email'
  | 'phone'
  | 'url'
  | 'name'
  | 'firstName'
  | 'lastName'
  | 'gender'
  | 'company'
  | 'jobTitle'
  | 'username'
  | 'address'
  | 'postalCode'
  | 'country'
  | 'region'
  | 'city'
  | 'county'
  | 'birthday'
  | 'date'
  | 'time'
  | 'number'
  | 'cardNumber'
  | 'cardSecurityCode'
  | 'cardExpiry'
  | 'password'
  | 'verificationCode'
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
const PHONE_CHARS_RE = /^\+?[\d\s().-]{7,25}(?:\s*(?:ext|x|转)\s*\d{1,6})?$/i
const DATE_RE = /^\d{4}(?:[-/.年](?:0?[1-9]|1[0-2])(?:[-/.月](?:0?[1-9]|[12]\d|3[01])日?)?|年)?(?:[ T]\d{1,2}:\d{2}(?::\d{2})?)?$/u
const WEEK_RE = /^\d{4}-W(?:0?[1-9]|[1-4]\d|5[0-3])$/i
const TIME_RE = /^(?:[01]?\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/
const NUMBER_RE = /^[+-]?(?:\d+\.?\d*|\.\d+)$/
const CARD_NUMBER_RE = /^(?:\d[ -]?){12,19}$/
const CARD_SECURITY_CODE_RE = /^\d{3,4}$/
const CARD_EXPIRY_RE = /^(?:0?[1-9]|1[0-2])\s*[/.-]\s*(?:\d{2}|\d{4})$/
const VERIFICATION_CODE_RE = /^[A-Za-z0-9]{4,10}$/
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
  const text = s.trim()
  if (!PHONE_CHARS_RE.test(text)) return false
  const digits = text.replace(/\D/g, '')
  return digits.length >= 7 && digits.length <= 15
}

export function isUrl(s: string): boolean {
  const text = s.trim()
  return URL_RE.test(text) && !/[，。；：！？、]/u.test(text)
}

export function isDate(s: string): boolean {
  const text = s.trim()
  return DATE_RE.test(text) || WEEK_RE.test(text)
}

export function isTime(s: string): boolean {
  return TIME_RE.test(s.trim())
}

export function isNumber(s: string): boolean {
  return NUMBER_RE.test(s.trim().replace(/,/g, ''))
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
const URL_SCAN_RE = /\b(?:https?|ftp):\/\/[^\s<>"'`，。；：！？、）】》」』]+/gi
const PHONE_SCAN_RE = /(?:\+?86[\s-]?)?1[3-9](?:[\s()-]?\d){9}/g
const TRAILING_URL_PUNCTUATION = /[.,;:!?，。；：！？、）)\]】}>》」』]+$/u
const LABEL_VALUE_RE = /^\s*([^:：=]{1,30})\s*[:：=]\s*(\S(?:.*\S)?)\s*$/u
const INLINE_NAME_RE = /(?:^|\n)\s*([\u4e00-\u9fa5]{2,6})(?=的(?:求职|个人|候选人)?资料|是一名|目前(?:居住|就职|从事))/gu
const INLINE_COMPANY_RE = /(?:目前)?(?:就职于|任职于|供职于)\s*([^，。；;\n]{2,60})/gu
const FIELD_LABEL_SCAN_RE = /(?:工作|备用|联系|个人)?(?:邮箱|电子邮件|电邮|手机号码|手机号|手机|电话|个人主页|主页|网址|网站|链接)/giu
const MAX_FRAGMENT_LENGTH = 300

const LABELED_KINDS: Array<{ kind: FieldExpect; words: string[] }> = [
  { kind: 'cardNumber', words: ['卡号', 'card number', 'card no', 'credit card number'] },
  { kind: 'cardSecurityCode', words: ['安全码', 'cvv', 'cvc', 'security code'] },
  { kind: 'cardExpiry', words: ['过期日期', '有效期', 'expiration date', 'expiry date', 'card expiry'] },
  { kind: 'verificationCode', words: ['验证码', '校验码', 'verification code', 'one time code', 'otp'] },
  { kind: 'password', words: ['密码', '口令', 'password', 'passcode'] },
  { kind: 'email', words: ['邮箱', '电子邮件', '电邮', 'email', 'e-mail', 'mail'] },
  { kind: 'phone', words: ['手机', '电话', '手机号', '手机号码', 'phone', 'tel', 'mobile'] },
  { kind: 'url', words: ['网址', '主页', '链接', '网站', 'url', 'website', 'link'] },
  { kind: 'username', words: ['用户名', '账号', '账户名', 'username', 'user id', 'login'] },
  { kind: 'lastName', words: ['姓氏', '姓', 'last name', 'surname', 'family name'] },
  { kind: 'firstName', words: ['名字', '名', 'first name', 'given name'] },
  { kind: 'name', words: ['姓名', '名字', '联系人', '收件人', 'name'] },
  { kind: 'gender', words: ['性别', 'gender', 'sex'] },
  { kind: 'company', words: ['公司', '单位', '企业', '组织', 'company', 'organization'] },
  { kind: 'jobTitle', words: ['职位', '职务', '岗位', 'job title', 'position', 'role'] },
  { kind: 'postalCode', words: ['邮编', '邮政编码', 'postal code', 'zip code', 'zipcode'] },
  { kind: 'country', words: ['国家', 'country'] },
  { kind: 'region', words: ['省份', '州', '地区', 'province', 'state', 'region'] },
  { kind: 'city', words: ['城市', '市', 'city'] },
  { kind: 'county', words: ['区县', '县', 'county', 'district'] },
  { kind: 'birthday', words: ['生日', '出生日期', 'birthday', 'birth date', 'date of birth'] },
  { kind: 'date', words: ['日期', '年月', '月份', '年份', 'date', 'month', 'year'] },
  { kind: 'time', words: ['时间', '时刻', 'time'] },
  { kind: 'number', words: ['数量', '数值', '人数', '次数', 'number', 'quantity', 'count'] },
  { kind: 'address', words: ['地址', '街道', '收货地址', 'address', 'street'] },
  { kind: 'text', words: ['简介', '介绍', '备注', '说明', 'bio', 'summary', 'note'] },
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
  const prefix = line.slice(0, at)
  const labels = [...prefix.matchAll(FIELD_LABEL_SCAN_RE)]
  return labels.at(-1)?.[0] ?? fallback
}

function labeledKind(label: string): FieldExpect | null {
  const lower = label.toLowerCase()
  for (const item of LABELED_KINDS) {
    if (item.words.some(word => keywordMatches(lower, word))) return item.kind
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
  for (const match of text.matchAll(INLINE_NAME_RE)) {
    const value = match[1]
    push(value, 'name', match.index + match[0].indexOf(value), '姓名')
  }
  for (const match of text.matchAll(INLINE_COMPANY_RE)) {
    const value = match[1].trim()
    push(value, 'company', match.index + match[0].indexOf(match[1]), '公司')
  }

  let lineOffset = 0
  const lines = text.split('\n').map(line => {
    const current = { text: line, offset: lineOffset }
    lineOffset += line.length + 1
    return current
  })
  for (const lineInfo of lines) {
    const line = lineInfo.text
    const match = line.match(LABEL_VALUE_RE)
    if (match) {
      const label = match[1].trim()
      const value = match[2].trim()
      const kind = labeledKind(label)
      if (kind && kind !== 'email' && kind !== 'url' && kind !== 'phone') {
        push(value, kind, lineInfo.offset + line.indexOf(value), label)
      }
    }
  }
  for (let index = 0; index < lines.length - 1; index++) {
    const label = lines[index].text.trim()
    if (!label || LABEL_VALUE_RE.test(label)) continue
    const kind = labeledKind(label)
    if (!kind) continue
    let valueIndex = index + 1
    while (valueIndex < lines.length && !lines[valueIndex].text.trim()) valueIndex++
    if (valueIndex >= lines.length) continue
    const value = lines[valueIndex].text.trim()
    if (!value || labeledKind(value) || LABEL_VALUE_RE.test(value)) continue
    push(value, kind, lines[valueIndex].offset + lines[valueIndex].text.indexOf(value), label)
  }
  const firstName = out.find(item => item.kind === 'firstName')
  const lastName = out.find(item => item.kind === 'lastName')
  if (firstName && lastName) {
    const cjk = /^[\u4e00-\u9fa5]+$/u.test(firstName.value) && /^[\u4e00-\u9fa5]+$/u.test(lastName.value)
    const value = cjk ? `${lastName.value}${firstName.value}` : `${firstName.value} ${lastName.value}`
    const key = fragmentKey('name', value)
    if (!seen.has(key)) {
      seen.add(key)
      out.push({
        value,
        kind: 'name',
        label: '完整姓名',
        context: `${firstName.label}: ${firstName.value}; ${lastName.label}: ${lastName.value}`,
      })
    }
  }
  const position = (value: string): number => {
    const index = text.indexOf(value)
    return index < 0 ? Number.MAX_SAFE_INTEGER : index
  }
  return out.sort((a, b) => position(a.value) - position(b.value))
}

export function isCandidateCompatible(cand: JevCandidate, expect: FieldExpect): boolean {
  if (expect === 'unknown') return false
  if (!cand.kind || cand.kind === 'text') {
    if (isEmail(cand.content) && expect !== 'email') return false
    if (isUrl(cand.content) && expect !== 'url') return false
    if (isPhone(cand.content) && expect !== 'phone') return false
  }
  if (cand.kind === 'email') return expect === 'email' && isEmail(cand.content)
  if (cand.kind === 'phone') return expect === 'phone' && isPhone(cand.content)
  if (cand.kind === 'url') return expect === 'url' && isUrl(cand.content)
  if (cand.kind === 'date') return expect === 'date' && isDate(cand.content)
  if (cand.kind === 'time') return expect === 'time' && isTime(cand.content)
  if (cand.kind === 'number') return expect === 'number' && isNumber(cand.content)
  if (cand.kind === 'cardNumber') return expect === 'cardNumber' && CARD_NUMBER_RE.test(cand.content.trim())
  if (cand.kind === 'cardSecurityCode') return expect === 'cardSecurityCode' && CARD_SECURITY_CODE_RE.test(cand.content.trim())
  if (cand.kind === 'cardExpiry') return expect === 'cardExpiry' && CARD_EXPIRY_RE.test(cand.content.trim())
  if (cand.kind === 'verificationCode') return expect === 'verificationCode' && VERIFICATION_CODE_RE.test(cand.content.trim())
  if (cand.kind === 'password') return expect === 'password' && cand.content.length > 0
  if (cand.kind && cand.kind !== 'text') return cand.kind === expect
  if (expect === 'email') return isEmail(cand.content)
  if (expect === 'phone') return isPhone(cand.content)
  if (expect === 'url') return isUrl(cand.content)
  if (expect === 'date' || expect === 'birthday') return isDate(cand.content)
  if (expect === 'time') return isTime(cand.content)
  if (expect === 'number') return isNumber(cand.content)
  if (expect === 'cardNumber') return CARD_NUMBER_RE.test(cand.content.trim())
  if (expect === 'cardSecurityCode') return CARD_SECURITY_CODE_RE.test(cand.content.trim())
  if (expect === 'cardExpiry') return CARD_EXPIRY_RE.test(cand.content.trim())
  if (expect === 'verificationCode') return VERIFICATION_CODE_RE.test(cand.content.trim())
  if (expect === 'password') return cand.content.length > 0 && cand.content.length <= 256
  if (expect === 'name') return looksLikeName(cand.content)
  if (expect === 'company') return looksLikeCompany(cand.content)
  if (cand.kind && cand.kind !== 'text') return false
  return true
}

                                                                                

const FIELD_KEYWORDS: Array<{ expect: FieldExpect; words: string[] }> = [
  { expect: 'cardNumber', words: ['卡号', 'card number', 'card no', 'credit card number'] },
  { expect: 'cardSecurityCode', words: ['安全码', 'cvv', 'cvc', 'security code'] },
  { expect: 'cardExpiry', words: ['过期日期', '有效期', 'expiration date', 'expiry date', 'card expiry'] },
  { expect: 'verificationCode', words: ['验证码', '校验码', 'verification code', 'one time code', 'otp'] },
  { expect: 'password', words: ['密码', '口令', 'password', 'passcode'] },
  { expect: 'email', words: ['邮箱', '电子邮件', '电邮', '邮件地址', 'email', 'e-mail', 'mail'] },
  { expect: 'phone', words: ['手机', '电话', '手机号', '手机号码', '电话号码', 'phone', 'tel', 'mobile'] },
  { expect: 'url', words: ['网址', '链接', '域名', 'url', 'website', 'link', 'domain'] },
  { expect: 'username', words: ['用户名', '用户账号', '登录名', 'username', 'user id', 'login'] },
  { expect: 'lastName', words: ['姓氏', '姓', 'last name', 'surname', 'family name'] },
  { expect: 'firstName', words: ['名字', '名', 'first name', 'given name'] },
  { expect: 'name', words: ['姓名', '名字', '收货人', '收件人', 'name'] },
  { expect: 'gender', words: ['性别', 'gender', 'sex'] },
  { expect: 'jobTitle', words: ['职位', '职务', '岗位', 'job title', 'organization-title', 'position', 'occupation'] },
  { expect: 'company', words: ['公司', '单位', '企业', '单位名称', 'company', 'firm', 'corp', 'organization'] },
  { expect: 'postalCode', words: ['邮编', '邮政编码', 'postal code', 'zip code', 'zipcode'] },
  { expect: 'country', words: ['国家', 'country'] },
  { expect: 'region', words: ['省份', '州', '行政区', 'province', 'state', 'region'] },
  { expect: 'city', words: ['城市', '所在市', 'city', 'locality'] },
  { expect: 'county', words: ['区县', '县', 'county', 'district'] },
  { expect: 'birthday', words: ['生日', '出生日期', 'birthday', 'birth date', 'date of birth'] },
  { expect: 'date', words: ['日期', '年月', '月份', '年份', 'date', 'month', 'year'] },
  { expect: 'time', words: ['时间', '时刻', 'time', 'hour'] },
  { expect: 'number', words: ['数量', '数值', '人数', '次数', 'number', 'quantity', 'count'] },
  { expect: 'address', words: ['地址', '街道', '收货地址', 'address', 'street'] },
  { expect: 'text', words: ['简介', '介绍', '备注', '说明', '摘要', 'bio', 'profile', 'summary', 'introduction', 'intro', 'note', 'description'] },
  { expect: 'search', words: ['搜索', '关键词', '关键字', 'search', 'query', 'keyword'] },
]

const AUTOCOMPLETE_EXPECT: Record<string, FieldExpect> = {
  name: 'name',
  'given-name': 'firstName',
  'additional-name': 'name',
  'family-name': 'lastName',
  'cc-name': 'name',
  'cc-number': 'cardNumber',
  'cc-csc': 'cardSecurityCode',
  'cc-exp': 'cardExpiry',
  'cc-exp-month': 'cardExpiry',
  'cc-exp-year': 'cardExpiry',
  'one-time-code': 'verificationCode',
  email: 'email',
  tel: 'phone',
  'tel-country-code': 'phone',
  'tel-national': 'phone',
  'tel-area-code': 'phone',
  'tel-local': 'phone',
  url: 'url',
  organization: 'company',
  'organization-title': 'jobTitle',
  username: 'username',
  'street-address': 'address',
  'address-line1': 'address',
  'address-line2': 'address',
  'address-line3': 'address',
  'postal-code': 'postalCode',
  country: 'country',
  'country-name': 'country',
  'address-level1': 'region',
  'address-level2': 'city',
  bday: 'birthday',
  'bday-day': 'birthday',
  'bday-month': 'birthday',
  'bday-year': 'birthday',
}

                              
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
    case 'date':
    case 'datetime-local':
    case 'month':
    case 'week':
      return 'date'
    case 'time':
      return 'time'
    case 'number':
      return 'number'
    case 'password':
      return 'password'
    default:
      return null
  }
}

function keywordExpect(haystack: string): FieldExpect | null {
  const lower = haystack.toLowerCase()
  if (!lower) return null
  for (const { expect, words } of FIELD_KEYWORDS) {
    if (words.some(word => keywordMatches(lower, word))) return expect
  }
  return null
}

function keywordMatches(text: string, word: string): boolean {
  const lowerWord = word.toLowerCase()
  if (/^[\u4e00-\u9fa5]$/.test(lowerWord)) {
    const escaped = lowerWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return new RegExp(`(?:^|[^\\u4e00-\\u9fa5])${escaped}(?:$|[^\\u4e00-\\u9fa5])`, 'u').test(text)
  }
  if (!/^[a-z0-9 -]+$/.test(lowerWord)) return text.includes(lowerWord)
  const escaped = lowerWord
    .split(/[ -]+/)
    .map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('[\\s_-]+')
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`, 'i').test(text)
}

function htmlSemanticValues(html: string): string {
  const values: string[] = []
  const attr = /\s(?:id|class|placeholder|aria-label|data-[\w-]+)\s*=\s*["']([^"']+)["']/gi
  for (const match of html.matchAll(attr)) values.push(match[1])
  return values.join(' ')
}

                                                      
export function detectFieldType(field: FieldCtx): FieldExpect {
  const autocomplete = (field.autocomplete ?? '').toLowerCase().split(/\s+/)
  for (const token of autocomplete) {
    const expected = AUTOCOMPLETE_EXPECT[token]
    if (expected) return expected
  }
  const type = (field.type ?? '').toLowerCase()
  const byAttr = typeAttrExpect(type)
  if (byAttr) return byAttr
  const semanticText = [
    field.label,
    field.name,
    field.role,
    field.inputMode,
    htmlSemanticValues(field.html ?? ''),
  ]
    .filter(Boolean)
    .join(' ')
  const byLabel = keywordExpect(semanticText)
  if (byLabel) return byLabel
                                                        
  const byName = keywordExpect(field.name ?? '')
  if (byName) return byName
  return 'unknown'
}

                        
export function detectSensitiveField(field: FieldCtx): SensitiveFieldKind | null {
  const type = (field.type ?? '').toLowerCase()
  const autocomplete = (field.autocomplete ?? '').toLowerCase()
  const semantic = [field.label, field.name, field.html].filter(Boolean).join(' ').toLowerCase()
  if (/(?:^|\s)one-time-code(?:\s|$)/.test(autocomplete) || /(?:验证码|校验码|verification[\s_-]*code|one[\s_-]*time[\s_-]*code|otp)/.test(semantic)) return 'verificationCode'
  if (type === 'password' || /(?:^|\s)(?:current-password|new-password)(?:\s|$)/.test(autocomplete)) return 'password'
  if (/(?:^|\s)cc-number(?:\s|$)/.test(autocomplete) || /(?:卡号|card[\s_-]*(?:number|no))/.test(semantic)) return 'cardNumber'
  if (/(?:^|\s)cc-csc(?:\s|$)/.test(autocomplete) || /(?:安全码|cvv|cvc|security[\s_-]*code)/.test(semantic)) return 'cardSecurityCode'
  if (/(?:^|\s)cc-(?:exp|exp-month|exp-year)(?:\s|$)/.test(autocomplete) || /(?:过期日期|有效期|expir(?:y|ation))/.test(semantic)) return 'cardExpiry'
  return null
}

export function isFillForbidden(field: FieldCtx, allowed?: SensitiveFillSettings): boolean {
  const kind = detectSensitiveField(field)
  return kind ? allowed?.[kind] !== true : false
}

                                                                                 

const EN_STOP = new Set(['the', 'a', 'an', 'of', 'to', 'and', 'or', 'for', 'in', 'on', 'at', 'is', 'are', 'www', 'com'])
const INTENT_GROUPS = [
  ['work', 'business', 'office', 'company', '工作', '办公', '公司'],
  ['personal', 'private', '个人', '私人'],
  ['backup', 'alternate', 'secondary', '备用', '备选'],
  ['home', '家庭', '住宅'],
  ['shipping', 'delivery', '收货', '邮寄'],
  ['billing', 'invoice', '账单', '发票'],
  ['portfolio', '作品集'],
  ['github', 'gitlab', '代码仓库', '开源'],
  ['bio', 'biography', 'profile', 'summary', 'introduction', 'intro', '简介', '介绍', '自我'],
] as const

                                
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

function intentAffinity(fieldText: string, candidateText: string): number {
  const field = fieldText.toLowerCase()
  const candidate = candidateText.toLowerCase()
  const fieldGroups = INTENT_GROUPS.filter(group => group.some(term => field.includes(term)))
  if (fieldGroups.length === 0) return 0
  let matched = 0
  let conflicted = 0
  for (const group of INTENT_GROUPS) {
    const inField = fieldGroups.includes(group)
    const inCandidate = group.some(term => candidate.includes(term))
    if (inField && inCandidate) matched++
    else if (!inField && inCandidate) conflicted++
  }
  return clamp01(0.5 + matched * 0.5 - conflicted * 0.2)
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
    case 'firstName':
    case 'lastName':
      return looksLikeName(c) ? 0.88 : 0.2
    case 'company':
      return looksLikeCompany(c) ? 0.85 : 0.3
    case 'birthday':
    case 'date':
      return isDate(c) ? 0.9 : 0.1
    case 'time':
      return isTime(c) ? 0.9 : 0.1
    case 'number':
      return isNumber(c) ? 0.9 : 0.1
    case 'cardNumber':
      return CARD_NUMBER_RE.test(c) ? 0.95 : 0.05
    case 'cardSecurityCode':
      return CARD_SECURITY_CODE_RE.test(c) ? 0.95 : 0.05
    case 'cardExpiry':
      return CARD_EXPIRY_RE.test(c) ? 0.95 : 0.05
    case 'verificationCode':
      return VERIFICATION_CODE_RE.test(c) ? 0.9 : 0.1
    case 'password':
      return c.length > 0 && c.length <= 256 ? 0.85 : 0.05
    case 'jobTitle':
    case 'username':
    case 'gender':
    case 'address':
    case 'postalCode':
    case 'country':
    case 'region':
    case 'city':
    case 'county':
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
  const typedBase = cand.kind === ctx.expect || (ctx.expect === 'text' && cand.kind === 'text') ? 0.9 : 0
  const base = Math.max(baseScore(ctx.expect, cand.content), typedBase)
  const fieldText = [
    ctx.field.label,
    ctx.field.name,
    ctx.field.type,
    ctx.field.autocomplete,
    ctx.field.inputMode,
    ctx.field.role,
    ctx.field.html,
  ].filter(Boolean).join(' ')
  const candidateText = `${cand.title} ${cand.preview} ${cand.content}`
  const overlap = labelOverlap(fieldText, candidateText)
  const intent = intentAffinity(fieldText, candidateText)
  const appRel = sourceAppRelevance(cand, ctx.page)
  const recency = ctx.total > 1 ? 1 - Math.min(ctx.index, ctx.total - 1) / (ctx.total - 1) : 1
  if (base >= 0.8) {
    return clamp01(0.9 + 0.04 * overlap + 0.04 * intent + 0.01 * appRel + 0.01 * recency)
  }
  const rawHistoryPenalty =
    ctx.expect === 'text' && cand.origin === 'history' && !cand.kind ? 0.15 : 0
  return clamp01(
    base * 0.55 + overlap * 0.25 + intent * 0.15 + appRel * 0.03 + recency * 0.04 - rawHistoryPenalty,
  )
}
