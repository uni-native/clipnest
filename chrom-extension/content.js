   
                                                       
  
      
                                                         
                                                              
                                                           
                                             
  
                                                      
                                           
   
(function () {
  'use strict'

  if (window.__clipnestContentLoaded) return                   
  window.__clipnestContentLoaded = true

                                                                                

  const LABEL_MAX = 100                            
  const VALUE_MAX = 500                                   
  const BLUR_DELAY = 300          
  const SUGGEST_MAX = 5            
  const OVERLAY_Z = '2147483647'
  const DOM_PATH_DEPTH_MAX = 5
  const SIBLING_SCAN_MAX = 64
  const LABEL_NODE_MAX = 64
  const VALUE_NODE_MAX = 128
  const PAGE_URL_MAX = 2048
  const PAGE_TITLE_MAX = 200
  const FOCUS_REPORT_MIN_MS = 250
  const USER_INTENT_MAX_AGE_MS = 1_000

                                         
  const TEXT_INPUT_TYPES = new Set([
    '',
    'text',
    'search',
    'tel',
    'email',
    'url',
    'number',
    'date',
    'datetime-local',
    'month',
    'week',
    'time',
  ])
  const NON_HINT_TAGS = ['script', 'style', 'select', 'input', 'textarea', 'img', 'svg']

                                                                                

                                
  let currentField = null
  let blurTimer = 0
  let inputTimer = 0
  let applyingFill = false
  let lastContextSignature = ''
  let lastFocusSentAt = 0
  let lastUserIntentAt = 0
  let pendingFocusTimer = 0
  let positionFrame = 0

  const overlay = { root: null, field: null, reqId: '' }

                                                                                  

  function send(msg) {
    try {
      const r = chrome.runtime.sendMessage(msg)

      if (r && typeof r.catch === 'function') {
        r.catch((e) => console.error('[ClipNest] 发送消息失败', e))
      }
    } catch (e) {
      console.error('[ClipNest] 发送消息失败', e)
    }
  }

                                                                                  

     
                                
                                          
     
  function resolveTextField(node) {
    if (!node || node.nodeType !== 1) return null
    const tag = node.tagName.toLowerCase()
    if (tag === 'input') {
      const type = (node.getAttribute('type') || '').toLowerCase()
      if (type === 'password') return null
      return TEXT_INPUT_TYPES.has(type) ? node : null
    }
    if (tag === 'textarea') return node
                                                   
    const ce = node.closest('[contenteditable]')
    if (ce && ce.isContentEditable) return ce
    return null
  }

  function cssEscapeValue(v) {
    if (window.CSS && CSS.escape) return CSS.escape(v)
    return String(v).replace(/["\\]/g, '\\$1')
  }

     
                                               
                                                 
     
  function getFieldId(el) {
    if (el.id) return '#' + el.id
    const tag = el.tagName.toLowerCase()
    const name = el.getAttribute('name')
    if (name) return `${tag}[name="${cssEscapeValue(name)}"]`
    const testId = el.getAttribute('data-testid')
    if (testId) return `${tag}[data-testid="${cssEscapeValue(testId)}"]`
    const autocomplete = el.getAttribute('autocomplete')
    if (autocomplete) return `${tag}[autocomplete="${cssEscapeValue(autocomplete)}"]`
    return getDomPathId(el)
  }

  function getDomPathId(el) {
    const parts = []
    let node = el
    while (node && node.nodeType === 1 && parts.length < DOM_PATH_DEPTH_MAX) {
      const tag = node.tagName.toLowerCase()
      if (node === document.body) {
        parts.unshift('body')
        break
      }
      let index = 1
      let scanned = 0
      let sib = node.previousElementSibling
      while (sib && scanned < SIBLING_SCAN_MAX) {
        if (sib.tagName === node.tagName) index++
        sib = sib.previousElementSibling
        scanned++
      }
      parts.unshift(sib ? tag : `${tag}[${index}]`)
      node = node.parentElement
    }
    return parts.join('>') || 'unknown'
  }

  function getFieldType(el) {
    const tag = el.tagName.toLowerCase()
    if (tag === 'input') return (el.getAttribute('type') || 'text').toLowerCase()
    if (tag === 'textarea') return 'textarea'
    return 'contenteditable'
  }

  function getFieldValue(el) {
    try {
      if (el.isContentEditable) return boundedText(el, VALUE_MAX, VALUE_NODE_MAX)
      return String(el.value || '').slice(0, VALUE_MAX)
    } catch {
      return ''
    }
  }

  function clip(s) {
    return String(s == null ? '' : s)
      .slice(0, LABEL_MAX * 4)
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, LABEL_MAX)
  }

  function boundedText(root, charMax = LABEL_MAX, nodeMax = LABEL_NODE_MAX) {
    if (!root) return ''
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    const parts = []
    let chars = 0
    let nodes = 0
    let textNode
    while ((textNode = walker.nextNode()) && nodes < nodeMax && chars < charMax * 4) {
      nodes++
      const parent = textNode.parentElement
      const blocked = parent && parent.closest('script,style,input,textarea,select,svg,[contenteditable]')
      if (blocked && blocked !== root) continue
      const value = String(textNode.nodeValue || '').trim()
      if (!value) continue
      parts.push(value)
      chars += value.length
    }
    return String(parts.join(' ')).replace(/\s+/g, ' ').trim().slice(0, charMax)
  }

     
                       
                                                                                   
     
  function getFieldLabel(el) {
    const by = el.getAttribute('aria-labelledby')
    if (by) {
      const root = el.getRootNode()
      const t = clip(
        by
          .split(/\s+/)
          .slice(0, 4)
          .map((id) => {
            const labelled = root && typeof root.getElementById === 'function' ? root.getElementById(id) : null
            return boundedText(labelled || document.getElementById(id))
          })
          .join(' '),
      )
      if (t) return t
    }
    const aria = el.getAttribute('aria-label')
    if (aria) {
      const t = clip(aria)
      if (t) return t
    }
    const ph = el.getAttribute('placeholder')
    if (ph) {
      const t = clip(ph)
      if (t) return t
    }
    if (el.labels && el.labels.length) {
      for (const label of Array.from(el.labels).slice(0, 3)) {
        const t = boundedText(label)
        if (t) return t
      }
    }
    return findNearbyHint(el)
  }

                                               
  function findNearbyHint(el) {
    const candidates = []
    const prev = el.previousElementSibling
    if (prev) candidates.push(prev)
    const parent = el.parentElement
    if (parent && parent !== document.body) {
      const pprev = parent.previousElementSibling
      if (pprev) candidates.push(pprev)
    }
    for (const c of candidates) {
      if (NON_HINT_TAGS.includes(c.tagName.toLowerCase())) continue
      const t = boundedText(c, 30, 24)
      if (t && t.length <= 30) return t               
    }
    return ''
  }

  function buildFieldCtx(el) {
    const tag = el.tagName.toLowerCase()
    return {
      id: getFieldId(el),
      tag: tag === 'input' || tag === 'textarea' ? tag : 'div',
      type: getFieldType(el),
      name: el.getAttribute('name') || '',
      label: getFieldLabel(el),
      value: getFieldValue(el).slice(0, VALUE_MAX),
                                            
      maxLength: typeof el.maxLength === 'number' && el.maxLength > 0 ? el.maxLength : 0,
    }
  }

  function buildPageCtx() {
    return {
      url: location.href.slice(0, PAGE_URL_MAX),
      title: document.title.slice(0, PAGE_TITLE_MAX),
      host: location.host,
    }
  }

  function isLiveField(field) {
    return !!field && field.isConnected && document.visibilityState === 'visible'
  }

  function markUserIntent(event) {
    if (event && event.isTrusted === false) return
    lastUserIntentAt = performance.now()
  }

  function hasRecentUserIntent() {
    return lastUserIntentAt > 0 && performance.now() - lastUserIntentAt <= USER_INTENT_MAX_AGE_MS
  }

  function emitFieldFocus(field, force = false) {
    if (!isLiveField(field)) return false
    const message = { t: 'field-focus', field: buildFieldCtx(field), page: buildPageCtx() }
    const signature = JSON.stringify(message)
    if (!force && signature === lastContextSignature) return false
    const wait = FOCUS_REPORT_MIN_MS - (performance.now() - lastFocusSentAt)
    if (!force && wait > 0) {
      clearTimeout(pendingFocusTimer)
      pendingFocusTimer = setTimeout(() => {
        pendingFocusTimer = 0
        if (currentField === field) emitFieldFocus(field, true)
      }, wait)
      return false
    }
    lastContextSignature = signature
    lastFocusSentAt = performance.now()
    send(message)
    return true
  }

  function clearCurrentField(reason) {
    clearTimeout(inputTimer)
    inputTimer = 0
    clearTimeout(pendingFocusTimer)
    pendingFocusTimer = 0
    lastContextSignature = ''
    if (!currentField) return
    currentField = null
    hideSuggest()
    send({ t: 'field-blur', reason })
  }

                                                                                  

  function onFocusIn(e) {
                                                    
    const path = typeof e.composedPath === 'function' ? e.composedPath() : []
    const target = path.length && path[0] && path[0].nodeType === 1 ? path[0] : e.target
    const field = resolveTextField(target)

    clearTimeout(blurTimer)
    if (!field) {
                          
      if (currentField) {
        clearCurrentField('焦点离开输入框')
      }
      return
    }
    const changed = field !== currentField
    if (changed) hideSuggest()
    currentField = field
    if (!hasRecentUserIntent()) return
    emitFieldFocus(field)
  }

  function onFocusOut() {
    clearTimeout(blurTimer)
                                       
    blurTimer = setTimeout(() => {
      blurTimer = 0
      clearCurrentField('输入框失焦')
    }, BLUR_DELAY)
  }

                                         
  function onFieldInput(event) {
    const path = typeof event.composedPath === 'function' ? event.composedPath() : []
    if (applyingFill || !currentField || (event.target !== currentField && !path.includes(currentField))) return
    markUserIntent(event)
    clearTimeout(inputTimer)
    inputTimer = setTimeout(() => {
      inputTimer = 0
      if (!isLiveField(currentField)) {
        clearCurrentField('输入框已从页面移除')
        return
      }
      emitFieldFocus(currentField)
    }, 180)
  }

                                                                                  

  function handleFill(msg) {
    const field = currentField
    if (!isLiveField(field)) {
      clearCurrentField('填充时输入框不可用')
      send({ t: 'fill-result', reqId: msg.reqId, ok: false, err: '输入框已失焦或离开页面' })
      return
    }
    if (!resolveTextField(field)) {
      currentField = null
      return
    }
    try {
      applyFill(field, typeof msg.value === 'string' ? msg.value : '', msg.mode === 'append' ? 'append' : 'replace')
      hideSuggest()
      send({ t: 'fill-result', reqId: msg.reqId, ok: true })
    } catch (e) {
      send({ t: 'fill-result', reqId: msg.reqId, ok: false, err: String((e && e.message) || e) })
    }
  }

  function applyFill(el, value, mode) {
                                 
    if (el.tagName.toLowerCase() === 'input' && (el.getAttribute('type') || '').toLowerCase() === 'password') {
      throw new Error('拒绝填充密码字段')
    }
    let next = mode === 'append' ? getFieldValue(el) + value : value
    const max = typeof el.maxLength === 'number' && el.maxLength > 0 ? el.maxLength : 0
    if (max) next = next.slice(0, max)                

    applyingFill = true
    try {
      el.focus()
      if (el.isContentEditable) {
        el.textContent = next
        moveCaretToEnd(el)
      } else {
        setNativeValue(el, next)
        try {
          const n = el.value.length
          el.setSelectionRange(n, n)
        } catch {
                                      
        }
      }
      dispatchInputEvents(el)
    } finally {
      applyingFill = false
    }
  }

     
                                             
                                                            
     
  function setNativeValue(el, value) {
    const proto =
      el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype
    const desc = Object.getOwnPropertyDescriptor(proto, 'value')
    if (desc && desc.set) desc.set.call(el, value)
    else el.value = value
  }

  function dispatchInputEvents(el) {
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  }

  function moveCaretToEnd(el) {
    try {
      const sel = window.getSelection()
      const range = document.createRange()
      range.selectNodeContents(el)
      range.collapse(false)
      sel.removeAllRanges()
      sel.addRange(range)
    } catch {
              
    }
  }

                                                                                  

  function handleSuggest(msg) {
    const field = currentField
    if (!isLiveField(field)) {
      clearCurrentField('显示建议时输入框不可用')
      return
    }
    const items = Array.isArray(msg.items) ? msg.items.slice(0, SUGGEST_MAX) : []
    if (!items.length) {
      hideSuggest()
      return
    }
    showSuggest(field, msg.reqId, items)
  }

  function showSuggest(field, reqId, items) {
    hideSuggest()
    const root = document.createElement('div')
    root.setAttribute('data-clipnest-overlay', '1')
    root.style.cssText = [
      'position:fixed',
      `z-index:${OVERLAY_Z}`,
      'background:#ffffff',
      'color:#1f2329',
      'border:1px solid rgba(17,24,39,0.08)',
      'border-radius:10px',
      'box-shadow:0 8px 30px rgba(17,24,39,0.16)',
      'padding:6px',
      'min-width:200px',
      'max-width:320px',
      'box-sizing:border-box',
      'font:13px/1.5 system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif',
      'user-select:none',
    ].join(';')

    const header = document.createElement('div')
    header.textContent = '剪巢建议 · Esc 关闭'
    header.style.cssText = 'font-size:11px;color:#8a8f99;padding:2px 8px 6px;white-space:nowrap'
    root.appendChild(header)

    for (const item of items) {
      root.appendChild(buildSuggestRow(item, reqId))
    }

    ;(document.body || document.documentElement).appendChild(root)
    positionOverlay(root, field)
    overlay.root = root
    overlay.field = field
    overlay.reqId = reqId
  }

  function buildSuggestRow(item, reqId) {
    const row = document.createElement('div')
    row.setAttribute('role', 'button')
    row.style.cssText = 'padding:7px 8px;border-radius:6px;cursor:pointer'

    const title = document.createElement('div')
    title.style.cssText = 'display:flex;align-items:center;gap:6px;font-weight:600;white-space:nowrap;overflow:hidden'
    const titleText = document.createElement('span')
    titleText.textContent = item.title || '(无标题)'
    titleText.style.cssText = 'overflow:hidden;text-overflow:ellipsis'
    const badge = document.createElement('span')
    badge.textContent = item.scope === 'global' ? '全库候选' : '当前内容'
    badge.style.cssText = item.scope === 'global'
      ? 'flex:none;font-size:10px;font-weight:500;color:#9a6700;background:#fff3cd;padding:1px 5px;border-radius:999px'
      : 'flex:none;font-size:10px;font-weight:500;color:#625bd8;background:#eeecff;padding:1px 5px;border-radius:999px'
    title.append(titleText, badge)

    const preview = document.createElement('div')
    preview.textContent = item.preview || ''
    preview.style.cssText = 'font-size:12px;color:#6b7280;white-space:nowrap;overflow:hidden;text-overflow:ellipsis'

    row.append(title, preview)
    row.addEventListener('mouseenter', () => {
      row.style.background = '#F1F0FF'           
    })
    row.addEventListener('mouseleave', () => {
      row.style.background = 'transparent'
    })
                                                                    
    row.addEventListener('mousedown', (e) => {
      e.preventDefault()
      e.stopPropagation()
    })
    row.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      pickSuggestion(item, reqId)
    })
    return row
  }

     
                                                  
     
  function pickSuggestion(item, reqId) {
    const field = currentField
    hideSuggest()
    if (!field) return
    try {
      applyFill(field, typeof item.value === 'string' ? item.value : '', 'replace')
      send({ t: 'fill-result', reqId, ok: true })
    } catch (e) {
      send({ t: 'fill-result', reqId, ok: false, err: String((e && e.message) || e) })
    }
    send({ t: 'suggest-pick', reqId, itemId: item.id })
  }

  function positionOverlay(root, field) {
    if (!root || !field || !field.isConnected) return
    const rect = field.getBoundingClientRect()
    const h = root.offsetHeight
    const w = root.offsetWidth
    let y = rect.bottom + 4
                          
    if (rect.bottom + h + 8 > window.innerHeight && rect.top - h - 4 > 0) {
      y = rect.top - h - 4
    }
    const maxX = document.documentElement.clientWidth - w - 4
    const x = Math.max(4, Math.min(rect.left, Math.max(4, maxX)))
    root.style.left = `${x}px`
    root.style.top = `${y}px`
  }

  function scheduleOverlayPosition() {
    if (!overlay.root || !overlay.field || positionFrame) return
    positionFrame = requestAnimationFrame(() => {
      positionFrame = 0
      if (overlay.root && overlay.field) positionOverlay(overlay.root, overlay.field)
    })
  }

  function hideSuggest() {
    if (positionFrame) cancelAnimationFrame(positionFrame)
    positionFrame = 0
    if (overlay.root && overlay.root.parentNode) {
      overlay.root.parentNode.removeChild(overlay.root)
    }
    overlay.root = null
    overlay.field = null
    overlay.reqId = ''
  }

                                                                                  

  document.addEventListener('focusin', onFocusIn, true)
  document.addEventListener('focusout', onFocusOut, true)
  document.addEventListener('input', onFieldInput, true)
  document.addEventListener('pointerdown', markUserIntent, true)
  document.addEventListener('keydown', markUserIntent, true)

             
  document.addEventListener(
    'mousedown',
    (e) => {
      if (overlay.root && !overlay.root.contains(e.target)) hideSuggest()
    },
    true,
  )

                                   
  document.addEventListener(
    'keydown',
    (e) => {
      if (e.key === 'Escape' && overlay.root) {
        hideSuggest()
        e.stopPropagation()
      }
    },
    true,
  )

                      
  window.addEventListener(
    'scroll',
    scheduleOverlayPosition,
    { passive: true },
  )
  window.addEventListener('resize', scheduleOverlayPosition)

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'hidden') return
    lastUserIntentAt = 0
    clearCurrentField('页面已隐藏')
  })

  window.addEventListener('pagehide', () => clearCurrentField('页面卸载'))

                         
  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg || typeof msg.t !== 'string') return
    if (msg.t === 'fill') {
      handleFill(msg)
      return
    }
    if (msg.t === 'suggest') {
      handleSuggest(msg)
    }
  })
})()
