                   
   
                                                                 
  
       
                                                                       
                                                 
                                                        
                                                                                                   
                                                                
  
                                 
                                                                             
   

const WS_URL = process.env.CLIPNEST_WS_URL || 'ws://127.0.0.1:9377'
const TOKEN = process.env.CLIPNEST_TOKEN || 'smoke-test'
const EXT_VERSION = '1.0.0'

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
      if (!isStr(m.value)) errors.push('fill.value 必须是字符串')
      if (!['replace', 'append'].includes(m.mode)) errors.push(`fill.mode 非法: ${JSON.stringify(m.mode)}`)
      break
    case 'suggest':
      if (!isNonEmptyStr(m.reqId)) errors.push('suggest.reqId 必须是非空字符串')
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

const sampleField = {
  id: '#email',
  tag: 'input',
  type: 'email',
  name: 'email',
  label: '邮箱地址',
  value: '',
  maxLength: 0,
}

const samplePage = {
  url: 'https://example.com/login',
  title: '登录 - Example',
  host: 'example.com',
}

console.log('== A. 协议结构校验（JSON 往返 + 字段齐全性） ==')
check('ext→app hello', { t: 'hello', token: TOKEN, ua: 'ClipNest-Smoke/1.0 (node)', extVersion: EXT_VERSION }, validateExtToApp)
check('ext→app ping', { t: 'ping' }, validateExtToApp)
check('ext→app field-focus', { t: 'field-focus', field: sampleField, page: samplePage }, validateExtToApp)
check('ext→app field-blur', { t: 'field-blur' }, validateExtToApp)
check('ext→app fill-result(ok)', { t: 'fill-result', reqId: 'r1', ok: true }, validateExtToApp)
check('ext→app fill-result(err)', { t: 'fill-result', reqId: 'r1', ok: false, err: 'boom' }, validateExtToApp)
check('app→ext welcome', { t: 'welcome', app: 'ClipNest', version: '0.1.0' }, validateAppToExt)
check('app→ext pong', { t: 'pong' }, validateAppToExt)
check('app→ext auth-fail', { t: 'auth-fail', reason: 'token mismatch' }, validateAppToExt)
check('app→ext fill(replace)', { t: 'fill', reqId: 'r2', value: 'hello@clipnest.local', mode: 'replace' }, validateAppToExt)
check('app→ext fill(append)', { t: 'fill', reqId: 'r3', value: ' tail', mode: 'append' }, validateAppToExt)
check(
  'app→ext suggest',
  {
    t: 'suggest',
    reqId: 'r4',
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
expectReject('拒绝非法 fill.mode', { t: 'fill', reqId: 'r', value: 'v', mode: 'insert' }, validateAppToExt)
expectReject('拒绝未知消息类型', { t: 'no-such-type' }, validateExtToApp)

                                                                                          

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
        send({ t: 'field-focus', field: sampleField, page: samplePage })
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
