import assert from 'node:assert/strict'
import {
  detectFieldType,
  extractCandidateFragments,
  isCandidateCompatible,
  isFillForbidden,
  scoreCandidate,
} from '../src/main/intelligence/matchers.ts'

const card = [
  '姓名：李雷',
  '工作邮箱：lilei@company.cn',
  '备用邮箱：lilei.home@example.com',
  '手机：13800138000',
  '备用手机：+86 186-1234-5678',
  '个人主页：https://example.com/profile）。',
  '公司：星河科技',
  '地址：北京市海淀区中关村大街 1 号',
].join('\n')

const fragments = extractCandidateFragments(card)
assert.deepEqual(
  fragments.map(item => [item.kind, item.value]),
  [
    ['name', '李雷'],
    ['email', 'lilei@company.cn'],
    ['email', 'lilei.home@example.com'],
    ['phone', '13800138000'],
    ['phone', '+86 186-1234-5678'],
    ['url', 'https://example.com/profile'],
    ['company', '星河科技'],
    ['text', '北京市海淀区中关村大街 1 号'],
  ],
)

const duplicate = extractCandidateFragments('工作邮箱：same@example.com\n备用邮箱：same@example.com')
assert.equal(duplicate.filter(item => item.kind === 'email').length, 1)

const baseCandidate = {
  id: '1',
  title: '工作邮箱',
  preview: '工作邮箱：lilei@company.cn',
  content: 'lilei@company.cn',
  type: 'text',
  sourceApp: '',
  lastUsedAt: 1,
  kind: 'email',
  origin: 'clipboard',
}
assert.equal(isCandidateCompatible(baseCandidate, 'email'), true)
assert.equal(isCandidateCompatible(baseCandidate, 'company'), false)
assert.equal(detectFieldType({ id: '1', tag: 'input', type: 'tel', name: '', label: '', value: '' }), 'phone')
assert.equal(isFillForbidden({ id: '2', tag: 'input', type: 'password', name: '', label: '', value: '' }), true)

const rawHistoryScore = scoreCandidate(
  { ...baseCandidate, kind: undefined, origin: 'history', title: '自我反思', content: '自我反思记录' },
  {
    expect: 'text',
    field: { id: '3', tag: 'textarea', type: 'text', name: 'bio', label: '自我介绍', value: '' },
    page: { url: '', title: '', host: '' },
    index: 0,
    total: 1,
  },
)
assert.ok(rawHistoryScore < 0.42)

console.log('intelligence tests: 13 passed')
