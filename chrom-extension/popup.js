   
                             
  
                                                                    
                                                                  
   
(function () {
  'use strict'

  const $ = (id) => document.getElementById(id)
  const els = {
    dot: $('dot'),
    statusText: $('statusText'),
    version: $('version'),
    wsUrl: $('wsUrl'),
    token: $('token'),
    autoFill: $('autoFill'),
    save: $('save'),
    test: $('test'),
    testResult: $('testResult'),
  }

  const STATUS_META = {
    connected: { color: '#22c55e', text: '已连接' },
    connecting: { color: '#f59e0b', text: '连接中…' },
    disconnected: { color: '#9ca3af', text: '未连接' },
    'auth-failed': { color: '#ef4444', text: '令牌不正确' },
  }

                                                    
  function bg(msg) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(msg, (resp) => {
          resolve(chrome.runtime.lastError ? null : resp)
        })
      } catch {
        resolve(null)
      }
    })
  }

  function renderStatus(status) {
    const meta = STATUS_META[status] || STATUS_META.disconnected
    els.dot.style.background = meta.color
    els.statusText.textContent = meta.text
    els.statusText.style.color = meta.color
  }

  function showResult(text, ok) {
    els.testResult.textContent = text
    els.testResult.style.color = ok ? '#16a34a' : '#ef4444'
  }

  async function loadForm() {
    try {
      const res = await chrome.storage.local.get(['wsUrl', 'token', 'autoFill'])
      els.wsUrl.value = res.wsUrl || 'ws://127.0.0.1:9377'
      els.token.value = res.token || ''
      els.autoFill.checked = res.autoFill !== false
    } catch (e) {
      showResult('读取配置失败：' + e, false)
    }
  }

  async function refreshStatus() {
    const st = await bg({ t: 'popup:get-status' })
    if (!st) {
      renderStatus('disconnected')
      return
    }
    renderStatus(st.status)
    if (st.status === 'auth-failed' && st.authFailReason) {
      showResult(st.authFailReason, false)
    }
  }

  els.save.addEventListener('click', async () => {
    const wsUrl = els.wsUrl.value.trim()
    const token = els.token.value.trim()
    if (!/^wss?:\/\/.+/i.test(wsUrl)) {
      showResult('服务地址格式不正确，应以 ws:// 或 wss:// 开头', false)
      return
    }
    els.save.disabled = true
    try {
      await chrome.storage.local.set({ wsUrl, token, autoFill: els.autoFill.checked })
                                                 
      await bg({ t: 'popup:reconnect' })
      showResult('已保存，正在重连…', true)
    } catch (e) {
      showResult('保存失败：' + e, false)
    } finally {
      els.save.disabled = false
      refreshStatus()
    }
  })

  els.test.addEventListener('click', async () => {
    els.test.disabled = true
    els.testResult.style.color = '#6b7280'
    els.testResult.textContent = '检测中…'
    const r = await bg({ t: 'popup:test' })
    els.test.disabled = false
    if (r && r.ok) showResult('连通正常（收到 pong）', true)
    else showResult('检测失败：' + ((r && r.err) || '无法与后台通信'), false)
  })

                                             
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.t === 'ext-status') renderStatus(msg.status)
  })

  els.version.textContent = 'v' + chrome.runtime.getManifest().version
  loadForm()
  refreshStatus()
  setInterval(refreshStatus, 1000)
})()
