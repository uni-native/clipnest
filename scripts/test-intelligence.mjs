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
    ['address', '北京市海淀区中关村大街 1 号'],
  ],
)

const duplicate = extractCandidateFragments('工作邮箱：same@example.com\n备用邮箱：same@example.com')
assert.equal(duplicate.filter(item => item.kind === 'email').length, 1)

const prose = [
  '张三的求职资料',
  '张三是一名专注桌面效率工具的产品设计师。',
  '如需联系，请优先使用工作邮箱 zhangsan@example.com。备用邮箱是 backup.zhang@example.net。手机号码为 139 0000 5678。',
  '个人主页是 https://github.com/clipnest/clipnest。',
  '张三目前就职于 ClipNest Studio，负责智能剪贴板、表单填充和本地搜索体验。',
  '个人简介：我喜欢打造安静、快速、可信赖的效率工具。',
].join('\n')
const proseFragments = extractCandidateFragments(prose)
assert.deepEqual(
  proseFragments.map(item => [item.kind, item.value, item.label]),
  [
    ['name', '张三', '姓名'],
    ['email', 'zhangsan@example.com', '工作邮箱'],
    ['email', 'backup.zhang@example.net', '备用邮箱'],
    ['phone', '139 0000 5678', '手机号码'],
    ['url', 'https://github.com/clipnest/clipnest', '个人主页'],
    ['company', 'ClipNest Studio', '公司'],
    ['text', '我喜欢打造安静、快速、可信赖的效率工具。', '个人简介'],
  ],
)

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
const rawUrlCandidate = {
  ...baseCandidate,
  kind: undefined,
  content: 'http://localhost:5201/s/a3e37965ae',
}
assert.equal(isCandidateCompatible(rawUrlCandidate, 'name'), false)
assert.equal(isCandidateCompatible(rawUrlCandidate, 'email'), false)
assert.equal(isCandidateCompatible(rawUrlCandidate, 'phone'), false)
assert.equal(isCandidateCompatible(rawUrlCandidate, 'company'), false)
assert.equal(isCandidateCompatible(rawUrlCandidate, 'url'), true)
assert.equal(isCandidateCompatible({ ...rawUrlCandidate, content: '\\left(x-1\\right)\\left(x+3\\right)' }, 'url'), false)
assert.equal(
  isCandidateCompatible({ ...baseCandidate, kind: 'url', content: 'https://example.com/profile，点击查看详情' }, 'url'),
  false,
)
assert.equal(
  isCandidateCompatible({ ...baseCandidate, kind: 'phone', content: '+1 (415) 555-0136' }, 'phone'),
  true,
)
assert.equal(detectFieldType({ id: '1', tag: 'input', type: 'tel', name: '', label: '', value: '' }), 'phone')
assert.equal(isFillForbidden({ id: '2', tag: 'input', type: 'password', name: '', label: '', value: '' }), true)
assert.equal(
  detectFieldType({
    id: '3', tag: 'input', type: 'text', name: '', label: '', value: '', maxLength: 0,
    autocomplete: 'shipping postal-code', html: '<input autocomplete="shipping postal-code">',
  }),
  'postalCode',
)
assert.equal(
  detectFieldType({
    id: '4', tag: 'div', type: 'textbox', name: '', label: '', value: '', maxLength: 0,
    role: 'textbox', html: '<div role="textbox" data-field="organization-title"></div>',
  }),
  'jobTitle',
)
assert.equal(
  isFillForbidden({
    id: '5', tag: 'input', type: 'text', name: '', label: '', value: '', maxLength: 0,
    autocomplete: 'one-time-code',
  }),
  true,
)
assert.equal(
  detectFieldType({
    id: 'otp', tag: 'input', type: 'password', name: 'otp', label: 'Verification code', value: '', maxLength: 6,
    autocomplete: 'one-time-code',
  }),
  'verificationCode',
)
const introField = {
  id: '#intro',
  tag: 'textarea',
  type: 'textarea',
  name: 'intro',
  label: '自我介绍',
  value: '',
  maxLength: 0,
  html: '<textarea id="intro" name="intro" placeholder="简单介绍一下自己"></textarea>',
}
assert.equal(detectFieldType(introField), 'text')
assert.equal(isCandidateCompatible({ ...baseCandidate, kind: 'name', content: '张三' }, 'text'), false)
const introFragment = proseFragments.find(item => item.label === '个人简介')
assert.ok(introFragment)
assert.ok(scoreCandidate(
  {
    ...baseCandidate,
    kind: introFragment.kind,
    title: introFragment.label,
    preview: introFragment.context,
    content: introFragment.value,
  },
  {
    expect: 'text',
    field: introField,
    page: { url: '', title: '', host: '' },
    index: 0,
    total: 2,
  },
) >= 0.9)
assert.equal(
  detectFieldType({
    id: 'month', tag: 'input', type: 'month', name: 'month', label: 'Month', value: '', maxLength: 0,
    html: '<input id="month" name="month" type="month">',
  }),
  'date',
)
assert.equal(
  detectFieldType({
    id: 'mystery', tag: 'input', type: 'text', name: 'field_42', label: '偏好项', value: '', maxLength: 0,
    html: '<input id="mystery" name="field_42" type="text">',
  }),
  'unknown',
)
assert.equal(
  detectFieldType({
    id: 'account', tag: 'input', type: 'text', name: 'username', label: 'Username', value: '', maxLength: 0,
    html: '<input id="account" name="username" type="text">',
  }),
  'username',
)
assert.equal(isCandidateCompatible({ ...baseCandidate, kind: 'text', content: '任意说明' }, 'unknown'), false)

const stackedProfile = [
  '姓 / Last Name',
  'Stewart',
  '名 / First Name',
  'Jordan',
  '性别 / Gender',
  'Male',
  '电话 / Phone',
  '302-555-2367',
  '邮编 / Zip Code',
  '19810',
  '街道地址 / Street Address',
  '10 Ridgeway Sq, Unit APT F',
  '城市 / City',
  'Wilmington',
  '区县 / County',
  'N/A',
  '州 / State',
  'Delaware (DE)',
  '电子邮件 / Email',
  'jordan@example.com',
  '完整地址 / Full Address',
  '10 Ridgeway Sq, Unit APT F, Wilmington, DE 19810',
  '信用卡信息',
  '类型 / Card Type',
  'Test Card',
  '卡号 / Card Number',
  '**** **** **** 0108',
  'CVV',
  '***',
  '过期日期 / Expiration Date',
  '09/28',
].join('\n')
const stackedFragments = extractCandidateFragments(stackedProfile)
assert.deepEqual(
  stackedFragments.map(item => [item.kind, item.value]),
  [
    ['lastName', 'Stewart'],
    ['firstName', 'Jordan'],
    ['gender', 'Male'],
    ['phone', '302-555-2367'],
    ['postalCode', '19810'],
    ['address', '10 Ridgeway Sq, Unit APT F'],
    ['city', 'Wilmington'],
    ['county', 'N/A'],
    ['region', 'Delaware (DE)'],
    ['email', 'jordan@example.com'],
    ['address', '10 Ridgeway Sq, Unit APT F, Wilmington, DE 19810'],
    ['cardNumber', '**** **** **** 0108'],
    ['cardSecurityCode', '***'],
    ['cardExpiry', '09/28'],
    ['name', 'Jordan Stewart'],
  ],
)
assert.equal(
  detectFieldType({
    id: 'billingName', tag: 'input', type: 'text', name: 'billingName', label: 'Cardholder name', value: '', maxLength: 0,
    autocomplete: 'cc-name',
  }),
  'name',
)
assert.equal(
  detectFieldType({
    id: 'family', tag: 'input', type: 'text', name: 'familyName', label: 'Last Name', value: '', maxLength: 0,
    autocomplete: 'family-name',
  }),
  'lastName',
)
assert.equal(
  detectFieldType({
    id: 'given', tag: 'input', type: 'text', name: 'givenName', label: 'First Name', value: '', maxLength: 0,
    autocomplete: 'given-name',
  }),
  'firstName',
)
assert.equal(
  isFillForbidden({
    id: 'card', tag: 'input', type: 'text', name: 'cardNumber', label: 'Card Number', value: '', maxLength: 0,
    autocomplete: 'cc-number',
  }),
  true,
)
assert.equal(
  isFillForbidden(
    {
      id: 'card', tag: 'input', type: 'text', name: 'cardNumber', label: 'Card Number', value: '', maxLength: 0,
      autocomplete: 'cc-number',
    },
    {
      cardNumber: true,
      cardSecurityCode: false,
      cardExpiry: false,
      password: false,
      verificationCode: false,
    },
  ),
  false,
)

const workField = {
  expect: 'email',
  field: { id: '4', tag: 'input', type: 'email', name: 'business_email', label: 'Work email', value: '' },
  page: { url: '', title: '', host: '' },
  index: 0,
  total: 2,
}
const workScore = scoreCandidate(
  { ...baseCandidate, title: 'Business contact', preview: 'Work email', content: 'hello@studio.dev' },
  workField,
)
const backupScore = scoreCandidate(
  { ...baseCandidate, title: 'Alternate contact', preview: 'Backup email', content: 'backup@home.dev' },
  { ...workField, index: 1 },
)
assert.ok(workScore > backupScore)

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

console.log('intelligence tests passed')
