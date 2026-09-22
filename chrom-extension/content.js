   
                                                       
  
      
                                                         
                                                              
                                                           
                                             
  
                                                      
                                           
   
(function () {
  'use strict'

  if (window.__clipnestContentLoaded) return                   
  window.__clipnestContentLoaded = true

                                                                                

  const LABEL_MAX = 100                            
  const VALUE_MAX = 500                                   
  const BLUR_DELAY = 300          
  const SUGGEST_MAX = 5            
  const OVERLAY_Z = '2147483647'

                                         
  const TEXT_INPUT_TYPES = new Set(['', 'text', 'search', 'tel', 'email', 'url', 'number'])
  const NON_HINT_TAGS = ['script', 'style', 'select', 'input', 'textarea', 'img', 'svg']

                                                                                

                                
  let currentField = null
  let blurTimer = 0
  let inputTimer = 0
  let applyingFill = false

  const overlay = { root: null, field: null, reqId: '' }

                                                                                  

  function send(msg) {
    try {
      const r = chrome.runtime.sendMessage(msg)
                                                       
      if (r && typeof r.catch === 'function') r.catch(() => {})
    } catch {
                      
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
    if (name) {
      try {
        if (document.querySelectorAll(`${tag}[name="${cssEscapeValue(name)}"]`).length === 1) {
          return `${tag}[name=${name}]`
        }
      } catch {
                         
      }
    }
    return getDomPathId(el)
  }

  function getDomPathId(el) {
    const parts = []
    let node = el
    while (node && node.nodeType === 1 && parts.length < 5) {
      const tag = node.tagName.toLowerCase()
      if (node === document.body) {
        parts.unshift('body')
        break
      }
      let index = 1
      let sib = node.previousElementSibling
      while (sib) {
        if (sib.tagName === node.tagName) index++
        sib = sib.previousElementSibling
      }
      parts.unshift(`${tag}[${index}]`)
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
      if (el.isContentEditable) return el.textContent || ''
      return el.value || ''
    } catch {
      return ''
    }
  }

  function clip(s) {
    return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, LABEL_MAX)
  }

     
                       
                                                                                   
     
  function getFieldLabel(el) {
                                                     
    if (el.labels && el.labels.length) {
      for (const lb of el.labels) {
        const clone = lb.cloneNode(true)
        clone.querySelectorAll('input,textarea,select,[contenteditable]').forEach((n) => n.remove())
        const t = clip(clone.textContent)
        if (t) return t
      }
    }
    const by = el.getAttribute('aria-labelledby')
    if (by) {
      const t = clip(
        by
          .split(/\s+/)
          .map((id) => (document.getElementById(id) || { textContent: '' }).textContent)
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
      const t = (c.textContent || '').replace(/\s+/g, ' ').trim()
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
    return { url: location.href, title: document.title, host: location.host }
  }

                                                                                  

  function onFocusIn(e) {
                                                    
    const path = typeof e.composedPath === 'function' ? e.composedPath() : []
    const target = path.length && path[0] && path[0].nodeType === 1 ? path[0] : e.target
    const field = resolveTextField(target)

    clearTimeout(blurTimer)
    if (!field) {
                          
      if (currentField) {
        currentField = null
        hideSuggest()
        send({ t: 'field-blur' })
      }
      return
    }
    if (field !== currentField) hideSuggest()
    currentField = field
    send({ t: 'field-focus', field: buildFieldCtx(field), page: buildPageCtx() })
  }

  function onFocusOut() {
    clearTimeout(blurTimer)
                                       
    blurTimer = setTimeout(() => {
      blurTimer = 0
      if (currentField) {
        currentField = null
        hideSuggest()
        send({ t: 'field-blur' })
      }
    }, BLUR_DELAY)
  }

                                         
  function onFieldInput(event) {
    if (applyingFill || !currentField || event.target !== currentField) return
    clearTimeout(inputTimer)
    inputTimer = setTimeout(() => {
      inputTimer = 0
      if (!currentField || !document.contains(currentField)) return
      send({ t: 'field-focus', field: buildFieldCtx(currentField), page: buildPageCtx() })
    }, 180)
  }

                                                                                  

  function handleFill(msg) {
    const field = currentField
    if (!field || !document.contains(field)) return                           
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
    if (!field || !document.contains(field)) return
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
      'position:absolute',
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
    const rect = field.getBoundingClientRect()
    const h = root.offsetHeight
    const w = root.offsetWidth
    let y = rect.bottom + window.scrollY + 4
                          
    if (rect.bottom + h + 8 > window.innerHeight && rect.top - h - 4 > 0) {
      y = rect.top + window.scrollY - h - 4
    }
    const maxX = document.documentElement.clientWidth - w - 4
    const x = Math.max(4, Math.min(rect.left + window.scrollX, Math.max(4, maxX)))
    root.style.left = `${x}px`
    root.style.top = `${y}px`
  }

  function hideSuggest() {
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
    () => {
      if (overlay.root && overlay.field) positionOverlay(overlay.root, overlay.field)
    },
    { passive: true },
  )
  window.addEventListener('resize', () => {
    if (overlay.root && overlay.field) positionOverlay(overlay.root, overlay.field)
  })

                         
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
