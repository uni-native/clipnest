const $ = id => document.getElementById(id)
const state = {
  items: [], selected: new Set(), cursor: null, loading: false,
  analytics: null, focusIds: null, focusLabel: '', tab: 'analysis', date: todayKey(),
}
const typeLabels = { text: '文', link: '链', image: '图', file: '件', folder: '夹' }
let searchTimer = 0
let toastTimer = 0

function todayKey() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function shiftDate(key, days) {
  const [year, month, day] = key.split('-').map(Number)
  const d = new Date(year, month - 1, day + days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[ch])
}

function formatTime(ms) {
  const date = new Date(ms)
  if (date.toDateString() === new Date().toDateString()) return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  return date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function toast(message) {
  const el = $('toast')
  el.textContent = message
  el.hidden = false
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { el.hidden = true }, 2200)
}

async function request(path, options) {
  const response = await fetch(path, options)
  const body = await response.json()
  if (!response.ok) throw new Error(body.error || '请求失败')
  return body
}

function visibleItems() {
  if (!state.focusIds) return state.items
  return state.items.filter(item => state.focusIds.has(item.id))
}

function renderSelection() {
  const visible = visibleItems().map(item => item.id)
  $('selected-count').textContent = String(state.selected.size)
  $('selection').hidden = state.selected.size === 0
  $('select-all').checked = visible.length > 0 && visible.every(id => state.selected.has(id))
  $('select-all').indeterminate = visible.some(id => state.selected.has(id)) && !visible.every(id => state.selected.has(id))
}

function renderList() {
  const items = visibleItems()
  $('result-count').textContent = `${items.length} 条结果`
  $('empty').hidden = items.length > 0 || state.loading
  $('load-more').hidden = !state.cursor || state.focusIds !== null
  $('list-title').textContent = state.tab === 'content' ? '全部剪切板内容' : state.focusLabel || '今日内容'
  $('clear-focus').hidden = state.tab === 'content' || !state.focusLabel
  $('list').innerHTML = items.map(item => `
    <article class="item" data-id="${escapeHtml(item.id)}">
      <input class="pick" type="checkbox" aria-label="选择此条" ${state.selected.has(item.id) ? 'checked' : ''} />
      <span class="type-icon">${typeLabels[item.type] || '文'}</span>
      <div class="content"><div class="title" title="${escapeHtml(item.title)}">${escapeHtml(item.title || item.preview || '未命名内容')}</div><div class="preview">${escapeHtml(item.preview)}</div></div>
      <span class="source" title="${escapeHtml(item.sourceApp)}">${escapeHtml(item.sourceApp || '未知来源')}</span>
      <time class="time">${formatTime(item.lastUsedAt)}</time>
      <button class="delete-one" type="button" title="删除">×</button>
    </article>`).join('')
  renderSelection()
}

function renderMetrics(data) {
  const summary = data.summary
  $('metric-copies').textContent = summary.copies
  $('metric-unique').textContent = summary.unique
  $('metric-repeat').textContent = `${summary.repeatRate}%`
  $('metric-pastes').textContent = summary.pastes
  const delta = summary.copies - summary.previousCopies
  $('copy-delta').textContent = summary.previousCopies === 0 ? '暂无昨日对比' : `${delta >= 0 ? '比昨日多' : '比昨日少'} ${Math.abs(delta)} 次`
  $('active-hours').textContent = `${summary.activeHours} 个活跃时段`
  $('repeat-count').textContent = `${summary.repeats} 次重复复制`
  $('saved-chars').textContent = `至少节省 ${summary.savedChars} 字`
  $('total-size').textContent = `唯一内容 ${formatBytes(summary.totalBytes)}`
}

function renderHours(data) {
  const max = Math.max(1, ...data.hours.map(item => item.count))
  $('hour-chart').innerHTML = data.hours.map(item => `<span class="hour-bar ${item.hour === data.peak.hour && item.count > 0 ? 'peak' : ''}" data-height="${Math.max(2, item.count / max * 100)}" data-count="${item.hour} 时 · ${item.count} 次" title="${item.hour} 时 ${item.count} 次"></span>`).join('')
  $('hour-chart').querySelectorAll('.hour-bar').forEach(bar => { bar.style.height = `${bar.dataset.height}%` })
  $('peak-copy').textContent = data.peak.count > 0 ? `${String(data.peak.hour).padStart(2, '0')}:00 到 ${String((data.peak.hour + 1) % 24).padStart(2, '0')}:00 最活跃，共 ${data.peak.count} 次` : '这一天没有复制记录'
}

function renderBars(container, rows, total, clickable) {
  const max = Math.max(1, ...rows.map(row => row.count))
  $(container).innerHTML = rows.map(row => {
    const tag = clickable ? 'button' : 'div'
    const attrs = clickable ? `type="button" data-category="${escapeHtml(row.key)}"` : ''
    return `<${tag} class="rank-row ${row.key === 'sensitive' ? 'sensitive' : ''}" ${attrs}><span class="rank-label" title="${escapeHtml(row.label || row.name)}">${escapeHtml(row.label || row.name)}</span><span class="bar-track"><span class="bar-fill" data-width="${row.count / max * 100}"></span></span><span class="rank-value">${row.count} · ${total ? Math.round(row.count / total * 100) : 0}%</span></${tag}>`
  }).join('') || '<p class="preview">暂无数据</p>'
  $(container).querySelectorAll('.bar-fill').forEach(bar => { bar.style.width = `${bar.dataset.width}%` })
}

function focusItems(ids, label) {
  state.focusIds = new Set(ids)
  state.focusLabel = label
  state.selected.clear()
  renderList()
  $('workspace').scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function renderInsights(data) {
  const topSource = data.sources[0]
  const category = [...data.categories].sort((a, b) => b.count - a.count)[0]
  const rows = []
  if (data.peak.count > 0) rows.push({ title: `${data.peak.hour} 时是复制高峰`, detail: `这个时段复制 ${data.peak.count} 次` })
  if (data.summary.repeats > 0) rows.push({ title: `出现 ${data.summary.repeats} 次重复复制`, detail: `重复率 ${data.summary.repeatRate}%，常用内容适合收藏`, ids: data.cleanup.duplicates.ids, action: '查看重复内容' })
  if (data.cleanup.sensitive.count > 0) rows.push({ title: `检测到 ${data.cleanup.sensitive.count} 条可能的敏感内容`, detail: '包含密码、令牌或身份信息关键词', ids: data.cleanup.sensitive.ids, action: '立即检查' })
  if (topSource) rows.push({ title: `${topSource.name} 是主要来源`, detail: `贡献 ${topSource.count} 次复制，占今天最多` })
  if (category?.count > 0) rows.push({ title: `${category.label} 是主要内容`, detail: `共有 ${category.count} 条唯一内容`, ids: category.ids, action: '查看此类内容' })
  if (rows.length === 0) rows.push({ title: '今天还很安静', detail: '新的复制活动会自动出现在这里' })
  $('insights').innerHTML = rows.slice(0, 3).map((row, index) => `<li><span class="insight-number">${index + 1}</span><span class="insight-copy"><strong>${escapeHtml(row.title)}</strong><small>${escapeHtml(row.detail)}</small></span>${row.ids ? `<button class="insight-action" type="button" data-insight="${index}">${escapeHtml(row.action)} ›</button>` : ''}</li>`).join('')
  $('insights').querySelectorAll('[data-insight]').forEach(button => button.addEventListener('click', () => {
    const row = rows[Number(button.dataset.insight)]
    if (row?.ids) focusItems(row.ids, row.action.replace('查看', ''))
  }))
}

function renderAnalytics() {
  const data = state.analytics
  if (!data) return
  const date = new Date(`${data.date}T00:00:00`)
  $('date-label').textContent = data.date === todayKey() ? '今天' : date.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' })
  $('date-value').textContent = data.date === todayKey() ? '今天' : data.date
  $('next-day').disabled = data.date >= todayKey()
  $('accuracy-note').textContent = data.accuracy === 'precise' ? '事件精确统计' : data.accuracy === 'estimated' ? '旧数据按最后使用时间估算' : '部分旧数据按最后使用时间估算'
  renderMetrics(data)
  renderHours(data)
  renderInsights(data)
  renderBars('category-bars', data.categories, data.summary.unique, true)
  renderBars('source-bars', data.sources, data.summary.copies, false)
  $('cleanup-duplicates').textContent = data.cleanup.duplicates.count
  $('cleanup-sensitive').textContent = data.cleanup.sensitive.count
  $('cleanup-low').textContent = data.cleanup.lowValue.count
  if (state.tab === 'analysis' && !state.focusLabel) state.focusIds = new Set(data.ids)
  renderList()
}

async function loadAnalytics() {
  try {
    const data = await request(`/api/analytics?date=${encodeURIComponent(state.date)}`)
    state.analytics = data.analytics
    state.focusLabel = ''
    state.focusIds = state.tab === 'analysis' ? new Set(data.analytics.ids) : null
    renderAnalytics()
  } catch (error) { toast(error.message) }
}

async function load(reset = true) {
  if (state.loading) return
  state.loading = true
  if (reset) { state.cursor = null; state.selected.clear() }
  try {
    const params = new URLSearchParams({ limit: '100' })
    const keyword = $('search').value.trim()
    if (keyword) params.set('keyword', keyword)
    if ($('type').value !== 'all') params.set('type', $('type').value)
    if ($('group').value !== 'all') params.set('groupId', $('group').value)
    if (!reset && state.cursor) { params.set('cursorAt', String(state.cursor.lastUsedAt)); params.set('cursorId', state.cursor.id) }
    const page = await request(`/api/posts?${params}`)
    state.items = reset ? page.items : state.items.concat(page.items)
    state.cursor = page.nextCursor
  } catch (error) { toast(error.message) } finally { state.loading = false; renderList() }
}

async function loadGroups() {
  try {
    const data = await request('/api/groups')
    for (const group of data.groups) {
      const option = document.createElement('option')
      option.value = group.id
      option.textContent = group.name
      $('group').appendChild(option)
    }
  } catch (error) { toast(error.message) }
}

async function removeIds(ids) {
  if (!ids.length || !window.confirm(`确定删除 ${ids.length} 条内容？删除后无法恢复。`)) return
  try {
    await request('/api/posts/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }) })
    const removed = new Set(ids)
    state.items = state.items.filter(item => !removed.has(item.id))
    ids.forEach(id => state.selected.delete(id))
    await loadAnalytics()
    renderList()
    toast(`已删除 ${ids.length} 条内容`)
  } catch (error) { toast(error.message) }
}

function setTab(tab) {
  state.tab = tab
  document.querySelectorAll('.tab').forEach(button => button.classList.toggle('active', button.dataset.tab === tab))
  $('analysis-view').hidden = tab !== 'analysis'
  state.focusLabel = ''
  state.focusIds = tab === 'analysis' && state.analytics ? new Set(state.analytics.ids) : null
  renderList()
}

document.querySelectorAll('.tab').forEach(button => button.addEventListener('click', () => setTab(button.dataset.tab)))
$('category-bars').addEventListener('click', event => {
  const button = event.target.closest('[data-category]')
  const row = state.analytics?.categories.find(item => item.key === button?.dataset.category)
  if (row) focusItems(row.ids, row.label)
})
document.querySelectorAll('[data-cleanup]').forEach(button => button.addEventListener('click', () => {
  const key = button.dataset.cleanup
  const item = state.analytics?.cleanup[key]
  const labels = { duplicates: '重复内容', sensitive: '敏感内容', lowValue: '低价值内容' }
  if (!item?.count) { toast('今天没有这类内容'); return }
  focusItems(item.ids, labels[key])
}))
$('prev-day').addEventListener('click', () => { state.date = shiftDate(state.date, -1); void loadAnalytics() })
$('next-day').addEventListener('click', () => { if (state.date < todayKey()) { state.date = shiftDate(state.date, 1); void loadAnalytics() } })
$('clear-focus').addEventListener('click', () => { state.focusLabel = ''; state.focusIds = new Set(state.analytics?.ids || []); renderList() })
$('list').addEventListener('click', event => {
  const item = event.target.closest('.item')
  if (!item) return
  const id = item.dataset.id
  if (event.target.classList.contains('delete-one')) { void removeIds([id]); return }
  if (event.target.classList.contains('pick')) {
    if (event.target.checked) state.selected.add(id); else state.selected.delete(id)
    renderSelection()
  }
})
$('select-all').addEventListener('change', event => { for (const item of visibleItems()) { if (event.target.checked) state.selected.add(item.id); else state.selected.delete(item.id) } renderList() })
$('clear-selection').addEventListener('click', () => { state.selected.clear(); renderList() })
$('delete-selected').addEventListener('click', () => void removeIds([...state.selected]))
$('load-more').addEventListener('click', () => void load(false))
$('refresh').addEventListener('click', () => { void load(); void loadAnalytics() })
$('type').addEventListener('change', () => void load())
$('group').addEventListener('change', () => void load())
$('search').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => void load(), 220) })

void Promise.all([loadGroups(), load(), loadAnalytics()])
