                   
   
                                                                 
  
       
                                                                       
                                                 
                                                        
                                                                                                   
                                                                
  
                                 
                                                                             
   

const fs = require('node:fs')
const path = require('node:path')

const extensionRoot = path.resolve(__dirname, '..')
const manifest = JSON.parse(fs.readFileSync(path.join(extensionRoot, 'manifest.json'), 'utf8'))
const backgroundSource = fs.readFileSync(path.join(extensionRoot, 'background.js'), 'utf8')
const contentSource = fs.readFileSync(path.join(extensionRoot, 'content.js'), 'utf8')

const WS_URL = process.env.CLIPNEST_WS_URL || 'ws://127.0.0.1:9377'
const TOKEN = process.env.CLIPNEST_TOKEN || 'smoke-test'
const EXT_VERSION = manifest.version

let passCount = 0
let failCount = 0

                                                                                                       

const isStr = (v) => typeof v === 'string'
const isNonEmptyStr = (v) => typeof v === 'string' && v.length > 0
const isBool = (v) => typeof v === 'boolean'
const isNum = (v) => typeof v === 'number' && !Number.isNaN(v)

function validateFieldCtx(f, errors) {
  if (!f || typeof f !== 'object') {
    errors.push('field 缺失或不是对象')
    return
  }
  if (!isNonEmptyStr(f.id)) errors.push('field.id 必须是非空字符串')
  if (!['input', 'textarea', 'div'].includes(f.tag)) errors.push(`field.tag 非法: ${JSON.stringify(f.tag)}`)
  if (!isNonEmptyStr(f.type)) errors.push('field.type 必须是非空字符串')
  if (!isStr(f.name)) errors.push('field.name 必须是字符串')
  if (!isStr(f.label)) errors.push('field.label 必须是字符串')
  if (!isStr(f.value)) errors.push('field.value 必须是字符串')
  if (!isNum(f.maxLength)) errors.push('field.maxLength 必须是数字')
  for (const key of ['autocomplete', 'inputMode', 'role', 'html']) {
    if (f[key] !== undefined && !isStr(f[key])) errors.push(`field.${key} 必须是字符串`)
  }
}

function validatePageCtx(p, errors) {
  if (!p || typeof p !== 'object') {
    errors.push('page 缺失或不是对象')
    return
  }
  for (const k of ['url', 'title', 'host']) {
    if (!isStr(p[k])) errors.push(`page.${k} 必须是字符串`)
  }
}

                               
function validateExtToApp(m, errors) {
  if (!m || typeof m !== 'object') {
    errors.push('消息不是对象')
    return
  }
  switch (m.t) {
    case 'hello':
      if (!isStr(m.token)) errors.push('hello.token 必须是字符串')
      if (!isNonEmptyStr(m.ua)) errors.push('hello.ua 必须是非空字符串')
      if (!isNonEmptyStr(m.extVersion)) errors.push('hello.extVersion 必须是非空字符串')
      break
    case 'ping':
      break
    case 'field-focus':
      if (!isNonEmptyStr(m.focusId)) errors.push('field-focus.focusId 必须是非空字符串')
      validateFieldCtx(m.field, errors)
      validatePageCtx(m.page, errors)
      break
    case 'field-blur':
      break
    case 'fill-result':
      if (!isNonEmptyStr(m.reqId)) errors.push('fill-result.reqId 必须是非空字符串')
      if (!isBool(m.ok)) errors.push('fill-result.ok 必须是布尔')
      if (m.err !== undefined && !isStr(m.err)) errors.push('fill-result.err 必须是字符串')
      break
    default:
      errors.push(`未知的扩展→应用消息类型: ${JSON.stringify(m.t)}`)
  }
}

                               
function validateAppToExt(m, errors) {
  if (!m || typeof m !== 'object') {
    errors.push('消息不是对象')
    return
  }
  switch (m.t) {
    case 'welcome':
      if (!isNonEmptyStr(m.app)) errors.push('welcome.app 必须是非空字符串')
      if (!isNonEmptyStr(m.version)) errors.push('welcome.version 必须是非空字符串')
      break
    case 'pong':
      break
    case 'auth-fail':
      if (!isNonEmptyStr(m.reason)) errors.push('auth-fail.reason 必须是非空字符串')
      break
    case 'fill':
      if (!isNonEmptyStr(m.reqId)) errors.push('fill.reqId 必须是非空字符串')
      if (!isNonEmptyStr(m.focusId)) errors.push('fill.focusId 必须是非空字符串')
      if (!isStr(m.value)) errors.push('fill.value 必须是字符串')
      if (!['replace', 'append'].includes(m.mode)) errors.push(`fill.mode 非法: ${JSON.stringify(m.mode)}`)
      if (m.allowSensitive !== undefined && !isBool(m.allowSensitive)) errors.push('fill.allowSensitive 必须是布尔')
      break
    case 'suggest':
      if (!isNonEmptyStr(m.reqId)) errors.push('suggest.reqId 必须是非空字符串')
      if (!isNonEmptyStr(m.focusId)) errors.push('suggest.focusId 必须是非空字符串')
      if (m.allowSensitive !== undefined && !isBool(m.allowSensitive)) errors.push('suggest.allowSensitive 必须是布尔')
      if (!Array.isArray(m.items)) {
        errors.push('suggest.items 必须是数组')
      } else {
        m.items.forEach((it, i) => {
          if (!it || typeof it !== 'object') errors.push(`suggest.items[${i}] 不是对象`)
          else {
            if (!isNonEmptyStr(it.id)) errors.push(`suggest.items[${i}].id 必须是非空字符串`)
            if (!isStr(it.title)) errors.push(`suggest.items[${i}].title 必须是字符串`)
            if (!isStr(it.preview)) errors.push(`suggest.items[${i}].preview 必须是字符串`)
            if (!isStr(it.value)) errors.push(`suggest.items[${i}].value 必须是字符串`)
            if (!['field', 'global'].includes(it.scope)) errors.push(`suggest.items[${i}].scope 非法`)
          }
        })
      }
      break
    default:
      errors.push(`未知的应用→扩展消息类型: ${JSON.stringify(m.t)}`)
  }
}

                                                                                   

function check(name, msg, validator) {
                                               
  let round
  try {
    round = JSON.parse(JSON.stringify(msg))
  } catch (e) {
    console.log(`FAIL  ${name} — JSON 往返失败: ${e}`)
    failCount++
    return
  }
  const errors = []
  validator(round, errors)
  if (errors.length) {
    console.log(`FAIL  ${name}`)
    errors.forEach((e) => console.log(`      - ${e}`))
    failCount++
  } else {
    console.log(`PASS  ${name}`)
    passCount++
  }
}

function checkSource(name, condition, note) {
  if (condition) {
    console.log(`PASS  ${name}`)
    passCount++
    return
  }
  console.log(`FAIL  ${name} — ${note}`)
  failCount++
}

const sampleField = {
  id: '#email',
  tag: 'input',
  type: 'email',
  name: 'email',
  label: '邮箱地址',
  value: '',
  maxLength: 0,
  autocomplete: 'email',
  inputMode: 'email',
  role: '',
  html: '<input id="email" type="email" autocomplete="email">',
}

const samplePage = {
  url: 'https://example.com/login',
  title: '登录 - Example',
  host: 'example.com',
}

console.log('== A. 协议结构校验（JSON 往返 + 字段齐全性） ==')
check('ext→app hello', { t: 'hello', token: TOKEN, ua: 'ClipNest-Smoke/1.0 (node)', extVersion: EXT_VERSION }, validateExtToApp)
check('ext→app ping', { t: 'ping' }, validateExtToApp)
check('ext→app field-focus', { t: 'field-focus', focusId: 'f1', field: sampleField, page: samplePage }, validateExtToApp)
check('ext→app field-blur', { t: 'field-blur' }, validateExtToApp)
check('ext→app fill-result(ok)', { t: 'fill-result', reqId: 'r1', ok: true }, validateExtToApp)
check('ext→app fill-result(err)', { t: 'fill-result', reqId: 'r1', ok: false, err: 'boom' }, validateExtToApp)
check('app→ext welcome', { t: 'welcome', app: 'ClipNest', version: '0.1.0' }, validateAppToExt)
check('app→ext pong', { t: 'pong' }, validateAppToExt)
check('app→ext auth-fail', { t: 'auth-fail', reason: 'token mismatch' }, validateAppToExt)
check('app→ext fill(replace)', { t: 'fill', reqId: 'r2', focusId: 'f1', value: 'hello@clipnest.local', mode: 'replace', allowSensitive: false }, validateAppToExt)
check('app→ext fill(append)', { t: 'fill', reqId: 'r3', focusId: 'f1', value: ' tail', mode: 'append' }, validateAppToExt)
check(
  'app→ext suggest',
  {
    t: 'suggest',
    reqId: 'r4',
    focusId: 'f1',
    allowSensitive: false,
    items: [
      { id: 'p1', title: '邮箱地址', preview: '工作邮箱', value: 'hello@clipnest.local', scope: 'field' },
      { id: 'p2', title: '官网链接', preview: '历史记录', value: 'https://clipnest.local', scope: 'global' },
    ],
  },
  validateAppToExt,
)

                                 
function expectReject(name, msg, validator) {
  const errors = []
  validator(msg, errors)
  if (errors.length) {
    console.log(`PASS  ${name}（正确拒绝: ${errors[0]}）`)
    passCount++
  } else {
    console.log(`FAIL  ${name} — 非法消息被放行`)
    failCount++
  }
}

console.log('== A2. 负向用例（校验器应拒绝） ==')
expectReject('拒绝缺字段的 field-focus', { t: 'field-focus', field: { id: 'x' }, page: {} }, validateExtToApp)
expectReject('拒绝非法 fill.mode', { t: 'fill', reqId: 'r', focusId: 'f1', value: 'v', mode: 'insert' }, validateAppToExt)
expectReject('拒绝未知消息类型', { t: 'no-such-type' }, validateExtToApp)

console.log('== A3. 性能与定向注入约束 ==')
checkSource(
  '只向当前输入目标发送应用消息',
  backgroundSource.includes('sendToActiveTarget') && !backgroundSource.includes('broadcastToTabs'),
  '仍存在全标签页广播',
)
checkSource(
  '按标签页和 frameId 定位输入目标',
  backgroundSource.includes('sender.frameId') && backgroundSource.includes('{ frameId: target.frameId }'),
  '缺少子页面定向信息',
)
checkSource(
  '输入框检索不执行整页 querySelectorAll',
  !contentSource.includes('querySelectorAll'),
  '仍存在无上限的整页节点检索',
)
checkSource(
  '同级元素遍历有明确上限',
  contentSource.includes('SIBLING_SCAN_MAX') && contentSource.includes('scanned < SIBLING_SCAN_MAX'),
  '同级元素遍历缺少上限',
)
checkSource(
  '滚动定位使用逐帧合并',
  contentSource.includes('requestAnimationFrame') && contentSource.includes('scheduleOverlayPosition'),
  '滚动时仍可能重复触发布局计算',
)
checkSource(
  '候选主文字展示实际填充值',
  contentSource.includes("titleText.textContent = typeof item.value === 'string' ? item.value : ''"),
  '候选主文字仍可能展示说明而不是实际填充值',
)
checkSource(
  '上下方向键可选择候选',
  contentSource.includes("e.key === 'ArrowDown'") &&
    contentSource.includes("e.key === 'ArrowUp'") &&
    contentSource.includes('moveSuggestionSelection'),
  '候选浮层缺少上下方向键选择',
)
checkSource(
  '回车可填入当前候选',
  contentSource.includes("e.key === 'Enter'") && contentSource.includes('pickSelectedSuggestion'),
  '候选浮层缺少回车确认',
)
checkSource(
  '上下方向键可切换填写状态分组',
  contentSource.includes('focusRelativeField') &&
    contentSource.includes("e.key === 'ArrowDown' ? 1 : -1") &&
    contentSource.includes('const filled = fields.filter') &&
    contentSource.includes('const unfilled = fields.filter') &&
    !contentSource.includes("e.key === 'ArrowRight'"),
  '输入框仍使用左右方向键切换，或缺少上下分组切换',
)
checkSource(
  '响应式输入框接收标准输入事件',
  contentSource.includes("new InputEvent('input'") &&
    contentSource.includes('composed: true') &&
    contentSource.includes('setNativeValue'),
  '填充值可能无法同步到 Vue 等响应式框架',
)
checkSource(
  '字段上下文包含安全 HTML 标签',
  contentSource.includes('html: getFieldHtml(el)') &&
    contentSource.includes("name === 'value'") &&
    contentSource.includes("name.startsWith('on')"),
  '字段语义缺少 HTML 标签，或未移除敏感属性',
)
checkSource(
  '支持 ARIA 文本输入框',
  contentSource.includes("role === 'textbox'") && contentSource.includes("role === 'searchbox'"),
  '自定义响应式文本输入框可能无法捕获',
)
checkSource(
  '键盘切换不扫描全页选择器',
  contentSource.includes('document.createTreeWalker') &&
    !contentSource.includes("document.querySelectorAll('input"),
  '键盘切换可能使用全页选择器造成性能问题',
)
checkSource(
  '页面恢复时不主动检索输入框',
  !contentSource.includes("window.addEventListener('focus'") && !contentSource.includes('getDeepActiveElement'),
  '页面恢复仍会主动读取焦点元素',
)
checkSource(
  '焦点上报具备短时合并保护',
  contentSource.includes('FOCUS_REPORT_MIN_MS') && contentSource.includes('pendingFocusTimer'),
  '焦点事件可能无上限重复上报',
)
checkSource(
  '异步结果绑定原始输入框',
  contentSource.includes('msg.focusId !== currentFocusId') &&
    backgroundSource.includes('msg.focusId !== target.focusId'),
  '较早字段的异步结果仍可能填入后来聚焦的输入框',
)
checkSource(
  '自动恢复焦点不会触发检索或注入',
  contentSource.includes('USER_INTENT_MAX_AGE_MS') &&
    contentSource.includes('hasRecentUserIntent') &&
    contentSource.includes("document.addEventListener('pointerdown', markUserIntent") &&
    contentSource.includes("document.addEventListener('keydown', markUserIntent"),
  '输入框聚焦缺少用户操作门槛',
)
checkSource(
  '未引入全页变化监听',
  !contentSource.includes('MutationObserver'),
  '发现 MutationObserver，需检查是否造成批量扫描',
)
checkSource(
  '只注入 HTTP 和 HTTPS 页面',
  manifest.content_scripts[0].matches.join(',') === 'http://*/*,https://*/*',
  '页面范围仍然过宽',
)
checkSource(
  '敏感字段需要桌面端明确授权',
  contentSource.includes('allowSensitive === true') &&
    contentSource.includes('sensitiveFieldKind(el)') &&
    contentSource.includes("throw new Error('拒绝填充敏感字段')"),
  '敏感字段缺少扩展端二次授权校验',
)

                                                                                          

function liveSession() {
  return new Promise((resolve) => {
    if (typeof WebSocket !== 'function') {
      resolve({ outcome: 'skip', note: '当前 Node 无内置 WebSocket，跳过连通性测试（结构校验不受影响）' })
      return
    }
    let ws
    let settled = false
    const finish = (outcome, note) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try {
        ws && ws.close()
      } catch {
                
      }
      resolve({ outcome, note })
    }
    const timer = setTimeout(() => finish('timeout', '等待应用响应超时（4s）'), 4000)

    const send = (m) => {
      try {
        ws.send(JSON.stringify(m))
        return true
      } catch (e) {
        return false
      }
    }

    try {
      ws = new WebSocket(WS_URL)
    } catch (e) {
      finish('connect-fail', `无法构造 WebSocket（${e}）`)
      return
    }

    ws.addEventListener('error', () => {
      finish('connect-fail', '无法建立连接：ClipNest 可能未启动，或未在 设置→智能→浏览器扩展连接 中开启')
    })
    ws.addEventListener('open', () => {
                                          
      send({ t: 'hello', token: TOKEN, ua: `ClipNest-Smoke/1.0 (node ${process.version})`, extVersion: EXT_VERSION })
    })
    ws.addEventListener('message', (ev) => {
      let msg
      try {
        msg = JSON.parse(ev.data)
      } catch {
        return
      }
      const errors = []
      validateAppToExt(msg, errors)
      if (errors.length) {
        console.log(`      ! 收到不符合协议的消息: ${errors.join('; ')}`)
      }
      if (msg.t === 'welcome') {
        console.log(`      · 应用已应答 welcome: ${msg.app} ${msg.version}`)
        send({ t: 'ping' })
      } else if (msg.t === 'pong') {
        send({ t: 'field-focus', focusId: 'smoke-focus-1', field: sampleField, page: samplePage })
      } else if (msg.t === 'auth-fail') {
        finish('auth-fail', `应用返回 auth-fail: ${msg.reason}（token 为任意值，属预期）`)
      } else if (msg.t === 'fill') {
        send({ t: 'fill-result', reqId: msg.reqId, ok: true })
        send({ t: 'field-blur' })
        finish('ok', `完整会话成功：hello→welcome→ping→pong→field-focus→fill(${msg.mode})→fill-result→field-blur`)
      } else if (msg.t === 'suggest') {
        console.log(`      · 收到 ${msg.items.length} 条建议（浮层将由 content script 展示）`)
        send({ t: 'field-blur' })
        finish('ok', '完整会话成功：hello→welcome→ping→pong→field-focus→suggest→field-blur')
      }
    })
    ws.addEventListener('close', () => {
      if (!settled) finish('closed', '连接被应用端关闭（可能在 welcome 之前关闭，常见于 token 校验失败）')
    })
  })
}

                                                                               

async function main() {
  console.log('== B. 连通性会话（尽力而为，失败不影响结构校验结论） ==')
  console.log(`目标: ${WS_URL}  token: ${TOKEN}`)
  const { outcome, note } = await liveSession()
  const outcomeText = {
    ok: 'PASS',
    'connect-fail': 'SKIP',
    'auth-fail': 'SKIP',
    timeout: 'SKIP',
    closed: 'SKIP',
    skip: 'SKIP',
  }[outcome] || 'SKIP'
  console.log(`${outcomeText}  连通性 [${outcome}] ${note}`)

  console.log('')
  console.log(`结果: ${passCount} 通过, ${failCount} 失败`)
  if (failCount > 0) {
    console.log('冒烟测试未通过（结构校验存在失败项）')
    process.exit(1)
  }
  console.log('冒烟测试通过（结构校验全部通过；连通性状态见上）')
  process.exit(0)
}

main()
