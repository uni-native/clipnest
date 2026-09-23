   
                                           
  
      
                                                                        
                                                               
                                                                     
  
                                                    
                                                   
   

                                                                              

const EXT_VERSION = chrome.runtime.getManifest().version
const DEFAULT_WS_URL = 'ws://127.0.0.1:9377'

const HEARTBEAT_MS = 25_000                  
const PONG_TIMEOUT_MS = 120_000                             
const WATCHDOG_MS = 10_000                      
const RECONNECT_BASE_MS = 1_000        
const RECONNECT_MAX_MS = 30_000        
const RECONNECT_JITTER = 0.2                         
const PING_TEST_TIMEOUT_MS = 2_000                  
const KEEPALIVE_ALARM = 'clipnest-keepalive'
const TARGET_TTL_MS = 120_000

                                                                              

                                                                    
let status = 'disconnected'
let authFailReason = ''
                             
let ws = null
let config = { wsUrl: DEFAULT_WS_URL, token: '', autoFill: true }
let reconnectAttempt = 0
let reconnectTimer = 0
let heartbeatTimer = 0
let watchdogTimer = 0
let lastPongAt = 0
                                            
const pendingTests = []
let activeTarget = null

                                                                              

function log(...args) {
  console.log('[ClipNest]', ...args)
}

function setStatus(next) {
  if (status === next) return
  status = next
  broadcastStatus()
}

                                        
function broadcastStatus() {
  try {
    const r = chrome.runtime.sendMessage({
      t: 'ext-status',
      status,
      wsUrl: config.wsUrl,
      authFailReason,
      extVersion: EXT_VERSION,
    })
    if (r && typeof r.catch === 'function') r.catch(() => {})
  } catch {
                 
  }
}

function sendToApp(msg) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return false
  try {
    ws.send(JSON.stringify(msg))
    return true
  } catch (e) {
    log('发送失败', e)
    return false
  }
}

                                               
function ensureConnected() {
  if (status === 'auth-failed') return
  const alive = ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)
  if (!alive && !reconnectTimer) connect()
}

                                                                                

function connect() {
  if (status === 'auth-failed') return                      
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return

  const url = config.wsUrl || DEFAULT_WS_URL
  setStatus('connecting')
  let socket
  try {
    socket = new WebSocket(url)
  } catch (e) {
    log('WebSocket 构造失败（地址非法？）', url, e)
    scheduleReconnect()
    return
  }
  ws = socket

  socket.addEventListener('open', () => {
    if (ws !== socket) {
      socket.close()
      return
    }
    reconnectAttempt = 0
    lastPongAt = Date.now()
                                          
    sendToApp({ t: 'hello', token: config.token, ua: navigator.userAgent, extVersion: EXT_VERSION })
    startHeartbeat()
  })

  socket.addEventListener('message', (ev) => {
    if (ws !== socket) return
    let msg
    try {
      msg = JSON.parse(ev.data)
    } catch {
      return                
    }
    handleAppMessage(msg)
  })

  socket.addEventListener('close', () => {
    if (ws !== socket) return
    stopHeartbeat()
    ws = null
    if (status === 'auth-failed') return              
    setStatus('disconnected')
    scheduleReconnect()
  })

  socket.addEventListener('error', () => {
    if (ws !== socket) return

    log('WebSocket 连接错误', url)
  })
}

function scheduleReconnect() {
  if (status === 'auth-failed') return
  if (reconnectTimer) return
  const exp = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** reconnectAttempt)
  const jitter = exp * RECONNECT_JITTER * (Math.random() * 2 - 1)
  const delay = Math.max(200, Math.round(exp + jitter))
  reconnectAttempt = Math.min(reconnectAttempt + 1, 10)
  reconnectTimer = setTimeout(() => {
    reconnectTimer = 0
    connect()
  }, delay)
  log(`${delay}ms 后重连（第 ${reconnectAttempt} 次尝试）`)
}

function startHeartbeat() {
  stopHeartbeat()
  heartbeatTimer = setInterval(() => sendToApp({ t: 'ping' }), HEARTBEAT_MS)
  watchdogTimer = setInterval(() => {
    if (status !== 'connected') return
    if (Date.now() - lastPongAt > PONG_TIMEOUT_MS) {
      log('超过 120s 未收到 pong，强制断开重连')
      try {
        ws && ws.close()
      } catch {
                
      }
    }
  }, WATCHDOG_MS)
}

function stopHeartbeat() {
  if (heartbeatTimer) clearInterval(heartbeatTimer)
  if (watchdogTimer) clearInterval(watchdogTimer)
  heartbeatTimer = 0
  watchdogTimer = 0
}

                                                                                  

function handleAppMessage(msg) {
  if (!msg || typeof msg.t !== 'string') return
  switch (msg.t) {
    case 'welcome':
      lastPongAt = Date.now()
      setStatus('connected')
      flushPendingTests(true)
      log('已连接 ClipNest', msg.app, msg.version)
      break
    case 'pong':
      lastPongAt = Date.now()
      flushPendingTests(true)
      break
    case 'auth-fail':
      authFailReason = msg.reason || '令牌不正确'
      setStatus('auth-failed')
      stopHeartbeat()
      try {
        ws && ws.close()
      } catch {
                
      }
      log('令牌被拒绝：', authFailReason)
      break
    case 'fill':
      void sendToActiveTarget({
        t: 'fill',
        reqId: msg.reqId,
        value: typeof msg.value === 'string' ? msg.value : '',
        mode: msg.mode === 'append' ? 'append' : 'replace',
      })
      break
    case 'suggest':
      void sendToActiveTarget({
        t: 'suggest',
        reqId: msg.reqId,
        items: Array.isArray(msg.items) ? msg.items.slice(0, 5) : [],
      })
      break
    default:
      log('未知的应用消息类型', msg.t)
  }
}

function flushPendingTests(ok) {
  while (pendingTests.length) {
    const entry = pendingTests.shift()
    entry.settle(ok)
  }
}

                                                                                 

function senderTarget(sender) {
  if (!sender || !sender.tab || typeof sender.tab.id !== 'number') return null
  return {
    tabId: sender.tab.id,
    frameId: typeof sender.frameId === 'number' ? sender.frameId : 0,
    documentId: typeof sender.documentId === 'string' ? sender.documentId : '',
    focusedAt: Date.now(),
  }
}

function isSameTarget(sender, target = activeTarget) {
  if (!target) return false
  const next = senderTarget(sender)
  if (!next || next.tabId !== target.tabId || next.frameId !== target.frameId) return false
  return !target.documentId || !next.documentId || target.documentId === next.documentId
}

function clearActiveTarget(reason) {
  if (!activeTarget) return
  activeTarget = null
  log('清除输入目标', reason)
}

async function sendToActiveTarget(msg) {
  if (!config.autoFill) return false
  const target = activeTarget
  if (!target) {
    log('忽略应用消息：没有已聚焦输入框', msg.t)
    return false
  }
  if (Date.now() - target.focusedAt > TARGET_TTL_MS) {
    clearActiveTarget('目标已过期')
    return false
  }
  try {
    await chrome.tabs.sendMessage(target.tabId, msg, { frameId: target.frameId })
    return true
  } catch (e) {
    if (activeTarget === target) clearActiveTarget('目标页面不可用')
    log('向输入目标发送消息失败', e)
    return false
  }
}

                                                                                

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg.t !== 'string') return

  switch (msg.t) {
                                           
    case 'field-focus':
      activeTarget = senderTarget(sender)
      if (!activeTarget) {
        log('忽略来源不明的输入框消息')
        break
      }
      if (config.autoFill) {
        if (!sendToApp({ t: 'field-focus', field: msg.field, page: msg.page })) ensureConnected()
      }
      break
    case 'field-blur':
      if (!isSameTarget(sender)) break
      clearActiveTarget('输入框失焦')
      if (!sendToApp({ t: 'field-blur' })) ensureConnected()
      break
    case 'fill-result':
      if (!isSameTarget(sender)) {
        log('忽略非当前输入目标的填充结果')
        break
      }
      sendToApp({
        t: 'fill-result',
        reqId: msg.reqId,
        ok: !!msg.ok,
        ...(msg.err ? { err: String(msg.err) } : {}),
      })
      break
    case 'suggest-pick':
      if (!isSameTarget(sender)) break
                                                           
      log('suggest-pick（协议 v1 仅记录）', msg.reqId, msg.itemId)
      break

                                  
    case 'popup:get-status':
      sendResponse({
        status,
        wsUrl: config.wsUrl,
        token: config.token,
        autoFill: config.autoFill,
        authFailReason,
        extVersion: EXT_VERSION,
      })
      break
    case 'popup:test':
      handlePingTest(sendResponse)
      return true        
    case 'popup:reconnect':
      authFailReason = ''
      reconnectAttempt = 0
      setStatus('disconnected')
      if (reconnectTimer) clearTimeout(reconnectTimer)
      reconnectTimer = 0
      const previous = ws
      ws = null
      stopHeartbeat()
      try {
        previous && previous.close()
      } catch (e) {
        log('关闭旧连接失败', e)
      }
      connect()
      break
  }
})

function handlePingTest(sendResponse) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    sendResponse({ ok: false, err: '未连接到 ClipNest，请先保存配置' })
    return
  }
  let settled = false
  const timer = setTimeout(() => {
    if (settled) return
    settled = true
    const i = pendingTests.indexOf(entry)
    if (i >= 0) pendingTests.splice(i, 1)
    sendResponse({ ok: false, err: '等待 pong 超时（2s）' })
  }, PING_TEST_TIMEOUT_MS)
  const entry = {
    settle(ok) {
      if (settled) return
      settled = true
      clearTimeout(timer)
      const i = pendingTests.indexOf(entry)
      if (i >= 0) pendingTests.splice(i, 1)
      sendResponse({ ok: !!ok, err: ok ? undefined : '未收到 pong' })
    },
  }
  pendingTests.push(entry)
  sendToApp({ t: 'ping' })
}

                                                                              

function loadConfig() {
  return chrome.storage.local.get(['wsUrl', 'token', 'autoFill']).then((res) => {
    config = {
      wsUrl: typeof res.wsUrl === 'string' && res.wsUrl ? res.wsUrl : DEFAULT_WS_URL,
      token: typeof res.token === 'string' ? res.token : '',
      autoFill: res.autoFill !== false,        
    }
    return config
  })
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return
  let needReconnect = false
  if (changes.wsUrl) {
    config.wsUrl = changes.wsUrl.newValue || DEFAULT_WS_URL
    needReconnect = true
  }
  if (changes.token) {
    config.token = typeof changes.token.newValue === 'string' ? changes.token.newValue : ''
    needReconnect = true
  }
  if (changes.autoFill) {
    config.autoFill = changes.autoFill.newValue !== false
    if (!config.autoFill) {
      clearActiveTarget('智能填充已关闭')
      sendToApp({ t: 'field-blur' })
    }
  }
  if (needReconnect) {
                                               
    authFailReason = ''
    reconnectAttempt = 0
    setStatus('disconnected')
    if (reconnectTimer) clearTimeout(reconnectTimer)
    reconnectTimer = 0
    const previous = ws
    ws = null
    stopHeartbeat()
    try {
      previous && previous.close()
    } catch (e) {
      log('关闭旧连接失败', e)
    }
    connect()
  }
})

chrome.tabs.onRemoved.addListener((tabId) => {
  if (activeTarget && activeTarget.tabId === tabId) clearActiveTarget('标签页已关闭')
})

chrome.tabs.onActivated.addListener(({ tabId }) => {
  if (!activeTarget || activeTarget.tabId === tabId) return
  clearActiveTarget('已切换标签页')
  sendToApp({ t: 'field-blur' })
})

                                                                              

                                                
                                                        
try {
  chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 0.5 })
} catch (e) {
  log('创建保活闹钟失败', e)
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== KEEPALIVE_ALARM) return
  const alive = ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)
  if (!alive && status !== 'auth-failed' && !reconnectTimer) {
    log('保活闹钟：连接不在位，补一次重连')
    connect()
  }
})

                                                                              

loadConfig()
  .then(() => connect())
  .catch((e) => {
    log('初始化失败', e)
    connect()
  })
