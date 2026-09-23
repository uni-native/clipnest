                                                  
const WebSocket = require('C:/Users/liuhao/.zcode/workspace/default/clipnest/node_modules/ws')

const token = process.argv[2] || ''
const fieldValue = process.argv[3] || ''
const fieldType = process.argv[4] || 'email'
const fieldLabel = process.argv[5] || '邮箱地址'
const fieldName = process.argv[6] || fieldType
const ws = new WebSocket('ws://127.0.0.1:9377')
const log = (m) => console.log('[client]', m)

ws.on('open', () => {
  log('connected, sending hello')
  ws.send(JSON.stringify({ t: 'hello', token, ua: 'sim-client', extVersion: '1.0.0' }))
  setTimeout(() => ws.send(JSON.stringify({ t: 'ping' })), 150)
  setTimeout(() => {
    ws.send(JSON.stringify({
      t: 'field-focus',
      focusId: 'sim-focus-1',
      field: {
        id: `${fieldName}[0]`,
        tag: 'input',
        type: fieldType,
        name: fieldName,
        label: fieldLabel,
        value: fieldValue,
        maxLength: 200,
      },
      page: { url: 'http://127.0.0.1:8899/test-form.html', title: '测试表单', host: '127.0.0.1' },
    }))
  }, 300)
})
ws.on('message', (d) => {
  const text = d.toString()
  log('recv: ' + text.slice(0, 1200))
  try {
    const message = JSON.parse(text)
    if (['fill', 'suggest', 'none', 'error'].includes(message.t)) {
      ws.close()
      setTimeout(() => process.exit(0), 100)
    }
  } catch (error) {
    console.error('[client] invalid response', error)
  }
})
ws.on('error', (e) => log('error: ' + e.message))
ws.on('close', () => { log('closed'); process.exit(0) })
setTimeout(() => { log('timeout done'); process.exit(1) }, 4000)
