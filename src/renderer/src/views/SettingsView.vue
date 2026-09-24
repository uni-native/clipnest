<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import type { DeepPartial, IntelligenceStatus, ModelConfig, SensitiveFieldKind, Settings, ThemeType } from '@shared/types'
import { useSettingsStore } from '../stores/settings'
import { api } from '../api/bridge'
import { playClipboardSound, type ClipboardSoundKind } from '../utils/sound'
import Toggle from '../components/Toggle.vue'
import HotkeyRecorder from '../components/HotkeyRecorder.vue'
import ModelManagerModal from '../components/ModelManagerModal.vue'

type SectionKey = 'clipboard' | 'shortcuts' | 'browser' | 'general' | 'intelligence'

const NAV: Array<{ key: SectionKey; label: string; icon: string }> = [
  { key: 'clipboard', label: '剪切版', icon: 'clipboard' },
  { key: 'shortcuts', label: '快捷键', icon: 'keyboard' },
  { key: 'browser', label: '浏览器', icon: 'globe' },
  { key: 'general', label: '通用', icon: 'gear' },
  { key: 'intelligence', label: '智能', icon: 'spark' },
]

                   
const HISTORY_TICKS: Array<{ value: string; label: string }> = [
  { value: 'day', label: '天' },
  { value: 'week', label: '周' },
  { value: 'month', label: '月' },
  { value: 'quarter', label: '季度' },
  { value: 'half', label: '半年' },
  { value: 'year', label: '年' },
  { value: 'infinity', label: '无限制' },
]

const SOUND_TYPES: Array<{ value: number; label: string }> = [
  { value: 0, label: '默认音效' },
  { value: 1, label: '小黑音效' },
  { value: 2, label: '自定义音效' },
]

const THEMES: Array<{ value: ThemeType; label: string; icon: string }> = [
  { value: 'light', label: '浅色', icon: 'sun' },
  { value: 'dark', label: '深色', icon: 'moon' },
  { value: 'system', label: '跟随系统', icon: 'half' },
]

type GeneralKey = 'autoOpen' | 'minTray' | 'menuIcon' | 'launchAtLogin'

const store = useSettingsStore()
const { settings, browserStatus } = storeToRefs(store)

const section = ref<SectionKey>('clipboard')
const intel = ref<IntelligenceStatus | null>(null)
const recError = ref('')
const soundError = ref('')
const copySoundInput = ref<HTMLInputElement | null>(null)
const pasteSoundInput = ref<HTMLInputElement | null>(null)

                                                      
function sectionFromHash(): SectionKey | null {
  const m = window.location.hash.match(/\/settings\/([a-z]+)/)
  const k = m && m[1]
  if (k && NAV.some((n) => n.key === k)) return k as SectionKey
  return null
}

function onHashChange(): void {
  const s = sectionFromHash()
  if (s) section.value = s
}

                         
const showHide = ref(settings.value.shortcutKeys.showOrHide)
const prevGroup = ref(settings.value.shortcutKeys.previousGroup)
const nextGroup = ref(settings.value.shortcutKeys.nextGroup)

let offIntel: (() => void) | null = null

onMounted(() => {
  const init = sectionFromHash()
  if (init) section.value = init
  window.addEventListener('hashchange', onHashChange)
  void refreshIntel()
  void store.initBrowser()
  offIntel = window.clipnest.onIntelligenceStatus((s) => (intel.value = s))
})

onUnmounted(() => {
  window.removeEventListener('hashchange', onHashChange)
  offIntel?.()
  offIntel = null
})

async function refreshIntel(): Promise<void> {
  try {
    intel.value = await api.intelligence.status()
  } catch (e) {
    console.error('[settings] intelligence status failed', e)
  }
}

function patch(p: DeepPartial<Settings>): void {
  void store.update(p)
}

function onWebManagerEnabled(enabled: boolean): void {
  patch({ webManager: { enabled } })
}

function onWebManagerPortChange(e: Event): void {
  const port = Number((e.target as HTMLInputElement).value)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    tokenTip.value = '端口需在 1 到 65535 之间'
    return
  }
  patch({ webManager: { port } })
}

function setTheme(t: ThemeType): void {
  patch({ clipboard: { theme: t } })
}

function setLayout(l: 'vertical' | 'horizontal'): void {
  patch({ clipboard: { layout: l } })
}

async function onSoundsOpen(v: boolean): Promise<void> {
  const next = await store.update({ clipboard: { sounds: { open: v } } })
  if (v && next) void playClipboardSound('copy', next.clipboard.sounds)
}

async function setSound(type: number): Promise<void> {
  soundError.value = ''
  const next = await store.update({ clipboard: { sounds: { type } } })
  if (!next) return
  if (type === 2 && !next.clipboard.sounds.copy && !next.clipboard.sounds.paste) {
    soundError.value = '请上传复制音效或粘贴音效'
    return
  }
  void playClipboardSound('copy', next.clipboard.sounds)
}

function readAudioFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('音效读取结果无效'))
    reader.onerror = () => reject(reader.error ?? new Error('音效文件读取失败'))
    const ext = file.name.split('.').pop()?.toLowerCase()
    const mime = ext === 'wav' ? 'audio/wav' : ext === 'aac' ? 'audio/aac' : ext === 'm4a' ? 'audio/mp4' : 'audio/mpeg'
    reader.readAsDataURL(new Blob([file], { type: mime }))
  })
}

async function uploadSound(kind: ClipboardSoundKind, event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  soundError.value = ''
  const allowed = /\.(mp3|wav|aac|m4a)$/i.test(file.name)
  if (!allowed || file.size > 1024 * 1024) {
    soundError.value = '请选择 1MB 以内的 MP3、WAV 或 AAC 文件'
    return
  }
  try {
    const dataUrl = await readAudioFile(file)
    const sounds = kind === 'copy' ? { type: 2, copy: dataUrl } : { type: 2, paste: dataUrl }
    const next = await store.update({ clipboard: { sounds } })
    if (next) void playClipboardSound(kind, next.clipboard.sounds)
  } catch (e) {
    console.error('[settings] sound upload failed', e)
    soundError.value = '音效文件读取失败，请更换文件重试'
  }
}

function onGeneral(key: GeneralKey, v: boolean): void {
  if (key === 'autoOpen') patch({ general: { autoOpen: v } })
  else if (key === 'minTray') patch({ general: { minTray: v } })
  else if (key === 'menuIcon') patch({ general: { menuIcon: v } })
  else patch({ general: { launchAtLogin: v } })
}

function onHistory(value: string): void {
  patch({ general: { historyCache: value } })
}

function onShowHideInput(v: string): void {
  showHide.value = v
}

function onPrevGroupInput(v: string): void {
  prevGroup.value = v
}

function onNextGroupInput(v: string): void {
  nextGroup.value = v
}

async function onQuickPaste(v: boolean): Promise<void> {
  const ok = await api.settings.setQuickPaste(v)
  if (ok) patch({ shortcutKeys: { quickPasteEnable: v } })
  else recError.value = '快速粘贴开关失败'
}

async function onRecordShowHide(key: string): Promise<void> {
  const ok = await api.settings.setShowHideHotkey(key)
  if (!ok) {
    showHide.value = settings.value.shortcutKeys.showOrHide
    recError.value = '该组合键注册失败，已还原'
    return
  }
  recError.value = ''
  patch({ shortcutKeys: { showOrHide: key } })
}

async function onRecordGroup(which: 'previous' | 'next', key: string): Promise<void> {
  const ok = await api.settings.setGroupShortcut(which, key)
  if (!ok) {
    if (which === 'previous') prevGroup.value = settings.value.shortcutKeys.previousGroup
    else nextGroup.value = settings.value.shortcutKeys.nextGroup
    recError.value = '该组合键注册失败，已还原'
    return
  }
  recError.value = ''
  patch(which === 'previous' ? { shortcutKeys: { previousGroup: key } } : { shortcutKeys: { nextGroup: key } })
}

async function onClearHistory(): Promise<void> {
  if (!window.confirm('确定清空全部剪贴板历史？此操作不可恢复。')) return
  try {
    await api.posts.clearHistory()
  } catch (e) {
    console.error('[settings] clearHistory failed', e)
  }
}

async function onCheckUpdate(): Promise<void> {
  try {
    await api.common.checkUpdate()
    recError.value = ''
  } catch (e) {
    console.error('[settings] checkUpdate failed', e)
  }
}

const APP_VERSION = 'v0.1.0'
const dataDir = ref('')

                     
const isL1 = computed(() => settings.value.intelligence.tier === 'embedding')
const l1StateText = computed(() => {
  if (!isL1.value) return '未启用'
  if (!intel.value) return '加载中…'
  return intel.value.state === 'ready' ? `就绪 · ${intel.value.model}` : intel.value.state
})
const l1Progress = computed(() => {
  if (!isL1.value || !intel.value) return ''
  return `${intel.value.indexed} / ${intel.value.total} 条已索引`
})

function onL1Toggle(v: boolean): void {
  patch({ intelligence: { tier: v ? 'embedding' : 'rule' } })
}

async function onReindex(): Promise<void> {
  try {
    await api.intelligence.reindex()
  } catch (e) {
    console.error('[settings] reindex failed', e)
  }
}

onMounted(() => {
  void api.common
    .dataDir()
    .then(d => (dataDir.value = d))
    .catch(() => (dataDir.value = ''))
})

                                                                           

type ConnState = 'on' | 'off' | 'err'

const pinging = ref(false)
const pingResult = ref<'' | 'ok' | 'fail'>('')
const tokenTip = ref('')

const connState = computed<ConnState>(() => {
  if (browserStatus.value?.connected) return 'on'
  if (pingResult.value === 'fail') return 'err'
  return 'off'
})

const connText = computed(() =>
  connState.value === 'on' ? '已连接' : connState.value === 'err' ? '连接异常' : '未连接',
)

const clientUa = computed(() => {
  const c = browserStatus.value?.client
  if (!c) return ''
  return c.extVersion ? `${c.ua} · ${c.extVersion}` : c.ua
})

const pingText = computed(() =>
  pingResult.value === 'ok' ? '连通正常' : pingResult.value === 'fail' ? '未连接或响应超时' : '',
)

const SENSITIVE_FILL_OPTIONS: Array<{ key: SensitiveFieldKind; label: string }> = [
  { key: 'cardNumber', label: '卡号' },
  { key: 'cardSecurityCode', label: 'CVV 与 CVC' },
  { key: 'cardExpiry', label: '有效期' },
  { key: 'password', label: '密码' },
  { key: 'verificationCode', label: '验证码' },
]

const sensitiveFillCount = computed(() =>
  SENSITIVE_FILL_OPTIONS.filter(item => settings.value.browser.sensitiveFill[item.key]).length,
)

async function onBrowserEnabled(v: boolean): Promise<void> {
  pingResult.value = ''
  tokenTip.value = ''
  await applyBrowserConfig({ enabled: v })
}

async function onAutoFill(v: boolean): Promise<void> {
  await applyBrowserConfig({ autoFill: v })
}

function onSensitiveFill(kind: SensitiveFieldKind, label: string, enabled: boolean): void {
  if (enabled && !window.confirm(`允许剪巢向“${label}”字段填入剪贴板内容？请仅在可信页面开启。`)) return
  void store.update({ browser: { sensitiveFill: { [kind]: enabled } } })
}

function onPortChange(e: Event): void {
  const el = e.target as HTMLInputElement
  const v = Math.floor(Number(el.value))
  if (!Number.isFinite(v) || v <= 0 || v > 65535) return
  void applyBrowserConfig({ port: v })
}

async function applyBrowserConfig(patch: DeepPartial<Settings['browser']>): Promise<void> {
  try {
    browserStatus.value = await api.browser.setConfig(patch)
  } catch (e) {
    console.error('[settings] browser config failed', e)
  }
}

async function onRegenToken(): Promise<void> {
  pingResult.value = ''
  tokenTip.value = ''
  try {
    const token = await api.browser.regenerateToken()
    if (!token) return
    if (browserStatus.value) {
      browserStatus.value = { ...browserStatus.value, token }
    } else {
      browserStatus.value = await api.browser.status()
    }
    tokenTip.value = '已生成新令牌'
  } catch (e) {
    console.error('[settings] regenerate browser token failed', e)
  }
}

                                           
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      const ok = document.execCommand('copy')
      document.body.removeChild(ta)
      return ok
    } catch {
      return false
    }
  }
}

async function onCopyToken(): Promise<void> {
  const token = browserStatus.value?.token ?? ''
  if (!token) {
    tokenTip.value = '令牌为空，请先重新生成'
    return
  }
  tokenTip.value = (await copyText(token)) ? '已复制到剪贴板' : '复制失败，请手动复制'
}

async function onPing(): Promise<void> {
  pinging.value = true
  pingResult.value = ''
  try {
    pingResult.value = (await api.browser.ping()) ? 'ok' : 'fail'
  } catch {
    pingResult.value = 'fail'
  } finally {
    pinging.value = false
  }
}

async function onOpenWebManager(): Promise<void> {
  try {
    const ok = await api.common.openWebManager()
    if (!ok) tokenTip.value = '网页版管理未启动'
  } catch (e) {
    console.error('[settings] open web manager failed', e)
    tokenTip.value = '网页版管理打开失败'
  }
}

                                                                            

function onJevEnabled(v: boolean): void {
  patch({ jev: { enabled: v } })
}

function onJevMode(mode: 'rule' | 'model'): void {
  void store.update({ jev: { mode } })
}

                        
const activeModel = computed<ModelConfig | null>(() => {
  const list = settings.value.intelligence.models ?? []
  const id = settings.value.intelligence.activeModelId
  if (!id) return null
  return list.find(m => m.id === id) ?? null
})
const activeModelName = computed<string>(() => activeModel.value?.name ?? '')
const showModelManager = ref(false)

function onManageModels(): void {
  showModelManager.value = true
}

                            
const thresholdDraft = ref(settings.value.jev.threshold)
watch(
  () => settings.value.jev.threshold,
  v => {
    thresholdDraft.value = v
  },
)

function onThresholdInput(e: Event): void {
  thresholdDraft.value = Number((e.target as HTMLInputElement).value)
}

function onThresholdChange(): void {
  void store.update({ jev: { threshold: thresholdDraft.value } })
}

                                                 
const navRef = ref<HTMLElement | null>(null)
const indicatorStyle = ref<{ transform: string; height: string; opacity: number }>({
  transform: 'translateY(0px)',
  height: '44px',
  opacity: 0,
})
const dotStyle = ref<{ transform: string; opacity: number }>({
  transform: 'translateY(0px)',
  opacity: 0,
})

                                                 
const VB_H = 476                     
const sidePath = ref(buildPath(84))
let pinchY = 0
let pinchAnim = 0

                                        
function buildPath(w: number): string {  const edge = 64.5
  const waist = 59.2
  const half = 16.2
  return (
    `M${waist} ${w}` +
    `C${waist} ${w - 2.9} ${waist + 1.07} ${w - 6.7} ${edge - 2.79} ${w - 9.6}` +
    `C${edge - 1.2} ${w - 11.6} ${edge} ${w - 13.9} ${edge} ${w - half}` +
    `L${edge} 33.5` +
    `C${edge} 15 50 0 31 0` +
    `L0 0L0 ${VB_H}L31 ${VB_H}` +
    `C50 ${VB_H} ${edge} 461 ${edge} 442.5` +
    `L${edge} ${w + half}` +
    `C${edge} ${w + 13.9} ${edge - 1.2} ${w + 11.6} ${edge - 2.79} ${w + 9.6}` +
    `C${waist + 1.07} ${w + 6.7} ${waist} ${w + 2.9} ${waist} ${w}Z`
  )
}

                                                     
function easeStandard(t: number): number {
  const x1 = 0.4, y1 = 0, x2 = 0.2, y2 = 1
  const bx = (u: number) => 3 * (1 - u) * (1 - u) * u * x1 + 3 * (1 - u) * u * u * x2 + u * u * u
  const by = (u: number) => 3 * (1 - u) * (1 - u) * u * y1 + 3 * (1 - u) * u * u * y2 + u * u * u
  let lo = 0, hi = 1, u = t
  for (let i = 0; i < 20; i++) {
    if (Math.abs(bx(u) - t) < 1e-4) break
    if (bx(u) < t) lo = u; else hi = u
    u = (lo + hi) / 2
  }
  return by(u)
}

                                     
function movePinch(viewBoxY: number, animate: boolean): void {
  const from = pinchY
  if (!animate || from === viewBoxY) {
    pinchY = viewBoxY
    sidePath.value = buildPath(viewBoxY)
    return
  }
  cancelAnimationFrame(pinchAnim)
  const start = performance.now()
  const dur = 280
  const step = (): void => {
    const t = Math.min(1, (performance.now() - start) / dur)
    pinchY = from + (viewBoxY - from) * easeStandard(t)
    sidePath.value = buildPath(pinchY)
    if (t < 1) pinchAnim = requestAnimationFrame(step)
  }
  pinchAnim = requestAnimationFrame(step)
}

                                            
function moveIndicator(animate: boolean): void {
  const nav = navRef.value
  if (!nav) return
  const btn = nav.querySelector<HTMLElement>('.nav-item.active')
  if (!btn) return
  if (!animate) nav.classList.add('no-indicator-anim')
  const centerCss = btn.offsetTop + btn.offsetHeight / 2
  indicatorStyle.value = {
    transform: `translateY(${btn.offsetTop}px)`,
    height: `${btn.offsetHeight}px`,
    opacity: 1,
  }
                                         
  dotStyle.value = {
    transform: `translateY(${centerCss - 3}px)`,
    opacity: 1,
  }
                                           
  const scale = VB_H / nav.clientHeight
  movePinch(centerCss * scale, animate)
  if (!animate) {
    requestAnimationFrame(() => nav.classList.remove('no-indicator-anim'))
  }
}

                                           
watch(section, () => moveIndicator(true), { flush: 'post' })
onMounted(() => {
  nextTick(() => moveIndicator(false))
})
</script>

<template>
  <div class="settings">
                                               
    <nav ref="navRef" class="settings-nav">
                                                         
      <svg class="nav-bg" viewBox="0 0 80 476" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id="navSideGrad" x1="32" y1="0" x2="32" y2="476" gradientUnits="userSpaceOnUse">
            <stop class="nav-grad-1" />
            <stop offset="0.48" class="nav-grad-2" />
            <stop offset="1" class="nav-grad-3" />
          </linearGradient>
        </defs>
        <path :d="sidePath" fill="url(#navSideGrad)" />
      </svg>
                                                 
      <span class="nav-dot" :style="dotStyle" aria-hidden="true"></span>
                                    
      <span class="nav-indicator" :style="indicatorStyle" aria-hidden="true"></span>
      <button
        v-for="item in NAV"
        :key="item.key"
        class="nav-item"
        :class="{ active: section === item.key }"
        @click="section = item.key"
      >
                            
        <svg v-if="item.icon === 'clipboard'" class="nav-ico" viewBox="0 0 20 20" fill="currentColor" fill-rule="evenodd" aria-hidden="true">
          <path d="M7 1.5h6a1.5 1.5 0 0 1 1.5 1.5v2h-9V3A1.5 1.5 0 0 1 7 1.5z" />
          <path d="M4 5.5h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2zM7 9h6v1.5H7zM7 12.2h4v1.5H7z" />
        </svg>
                           
        <svg v-else-if="item.icon === 'keyboard'" class="nav-ico" viewBox="0 0 20 20" fill="currentColor" fill-rule="evenodd" aria-hidden="true">
          <path d="M3 5h14a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zM5.6 7.8h1.3v1.3H5.6zM9.35 7.8h1.3v1.3h-1.3zM13.1 7.8h1.3v1.3h-1.3zM7 11.8h6v1.3H7z" />
        </svg>
                           
        <svg v-else-if="item.icon === 'globe'" class="nav-ico" viewBox="0 0 20 20" fill="currentColor" fill-rule="evenodd" aria-hidden="true">
          <path d="M10 1.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zM10 3.2c-2.2 2-3.3 4.3-3.3 6.8s1.1 4.8 3.3 6.8c2.2-2 3.3-4.3 3.3-6.8S12.2 5.2 10 3.2zM2.4 9.2h15.2v1.6H2.4z" />
        </svg>
                          
        <svg v-else-if="item.icon === 'gear'" class="nav-ico" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path d="M2.8 4.2h2.65v1.7H2.8zM8.15 4.2h9.05v1.7H8.15z" />
          <path d="M2.8 9.15h9.05v1.7H2.8zM14.55 9.15h2.65v1.7h-2.65z" />
          <path d="M2.8 14.1h1.25v1.7H2.8zM6.75 14.1h10.45v1.7H6.75z" />
          <circle cx="6.8" cy="5.05" r="1.35" />
          <circle cx="13.2" cy="10" r="1.35" />
          <circle cx="5.4" cy="14.95" r="1.35" />
        </svg>
                          
        <svg v-else class="nav-ico" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path d="M10 1.6l1.8 4.9 4.9 1.8-4.9 1.8L10 15l-1.8-4.9L3.3 8.3l4.9-1.8L10 1.6z" />
          <path d="M16.4 13.2l.7 1.9 1.9.7-1.9.7-.7 1.9-.7-1.9-1.9-.7 1.9-.7.7-1.9z" />
        </svg>
        <span class="nav-label">{{ item.label }}</span>
      </button>
                                              
      <span class="nav-hairline" aria-hidden="true"></span>
      <button class="nav-foot-btn" title="关于剪巢" @click="section = 'general'">关于</button>
    </nav>

                    
    <div class="settings-main">
      <header class="settings-header">
        <div class="settings-brand">
          <img class="settings-logo" src="../assets/app-icon.png" alt="剪巢" />
          <span class="settings-title">剪巢</span>
          <span class="settings-ver">{{ APP_VERSION }}</span>
        </div>
        <div class="win-btns">
          <button class="win-btn min" title="最小化" @click="api.window.minimizeSettings()"></button>
          <button class="win-btn close" title="关闭" @click="api.window.closeSettings()"></button>
        </div>
      </header>

      <main class="settings-body">
                                             
        <div class="pane-fade" :key="section">
                                                                              
        <section v-show="section === 'clipboard'" class="pane-grid">
          <div class="col">
                       
            <div class="card">
              <div class="card-head">
                <span class="card-dot" style="background: #ff7d38"></span>
                <span class="card-title">音效</span>
              </div>
              <div class="spread">
                <div class="srow">
                  <span class="srow-label">启用音效</span>
                  <div class="srow-ctrl">
                    <Toggle :model-value="settings.clipboard.sounds.open" @update:model-value="onSoundsOpen" />
                  </div>
                </div>
                <div v-for="s in SOUND_TYPES" :key="s.value" class="srow">
                  <span class="srow-label">{{ s.label }}</span>
                  <div class="srow-ctrl">
                    <label class="radio">
                      <input
                        type="radio"
                        name="sound"
                        :checked="settings.clipboard.sounds.type === s.value"
                        @change="setSound(s.value)"
                      />
                      <span class="mark"></span>
                    </label>
                  </div>
                </div>
              </div>
              <div class="uploads">
                <button class="upload" type="button" @click="copySoundInput?.click()">
                  <svg class="up-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M12 16V4M7 9l5-5 5 5" />
                    <path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
                  </svg>
                  <div class="up-title">上传复制音效</div>
                  <div class="up-hint">{{ settings.clipboard.sounds.copy ? '已上传，点击可替换' : '支持 MP3、WAV、AAC，文件不超过 1MB' }}</div>
                </button>
                <input ref="copySoundInput" class="sound-file-input" type="file" accept=".mp3,.wav,.aac,.m4a,audio/mpeg,audio/wav,audio/aac,audio/mp4" @change="uploadSound('copy', $event)" />
                <button class="upload" type="button" @click="pasteSoundInput?.click()">
                  <svg class="up-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M12 16V4M7 9l5-5 5 5" />
                    <path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
                  </svg>
                  <div class="up-title">上传粘贴音效</div>
                  <div class="up-hint">{{ settings.clipboard.sounds.paste ? '已上传，点击可替换' : '支持 MP3、WAV、AAC，文件不超过 1MB' }}</div>
                </button>
                <input ref="pasteSoundInput" class="sound-file-input" type="file" accept=".mp3,.wav,.aac,.m4a,audio/mpeg,audio/wav,audio/aac,audio/mp4" @change="uploadSound('paste', $event)" />
              </div>
              <div v-if="soundError" class="sound-error">{{ soundError }}</div>
            </div>
          </div>

          <div class="col">
                        
            <div class="card">
              <div class="card-head">
                <span class="card-dot" style="background: #726cff"></span>
                <span class="card-title">主题色</span>
              </div>
              <div class="theme-opts">
                <button
                  v-for="t in THEMES"
                  :key="t.value"
                  class="theme-opt"
                  :class="{ sel: settings.clipboard.theme === t.value }"
                  type="button"
                  @click="setTheme(t.value)"
                >
                  <span class="theme-ico">
                               
                    <svg v-if="t.icon === 'sun'" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                      <circle cx="12" cy="12" r="4" />
                      <path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M19 5l-1.5 1.5M6.5 17.5L5 19" />
                    </svg>
                               
                    <svg v-else-if="t.icon === 'moon'" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
                    </svg>
                                 
                    <svg v-else width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                      <circle cx="12" cy="12" r="9" />
                      <path d="M12 3a9 9 0 0 0 0 18z" fill="currentColor" stroke="none" />
                    </svg>
                  </span>
                  <span class="t-label">{{ t.label }}</span>
                </button>
              </div>
            </div>

                       
            <div class="card">
              <div class="card-head">
                <span class="card-dot" style="background: #726cff"></span>
                <span class="card-title">布局</span>
              </div>
                            
              <svg class="layout-diagram" viewBox="0 0 260 156" fill="none" preserveAspectRatio="xMidYMid meet">
                <rect x="1" y="1" width="258" height="154" rx="12" fill="var(--surface-2)" stroke="var(--border)" />
                <template v-if="settings.clipboard.layout === 'horizontal'">
                  <rect x="18" y="16" width="120" height="10" rx="5" fill="var(--dash)" opacity="0.5" />
                  <rect x="18" y="36" width="180" height="10" rx="5" fill="var(--dash)" opacity="0.35" />
                  <rect x="18" y="56" width="150" height="10" rx="5" fill="var(--dash)" opacity="0.35" />
                  <rect x="16" y="104" width="228" height="36" rx="9" fill="var(--brand)" opacity="0.92" />
                  <rect x="26" y="113" width="26" height="18" rx="4" fill="#fff" opacity="0.9" />
                  <rect x="60" y="113" width="26" height="18" rx="4" fill="#fff" opacity="0.6" />
                  <rect x="94" y="113" width="26" height="18" rx="4" fill="#fff" opacity="0.6" />
                  <rect x="128" y="113" width="26" height="18" rx="4" fill="#fff" opacity="0.6" />
                  <rect x="162" y="113" width="26" height="18" rx="4" fill="#fff" opacity="0.6" />
                  <rect x="196" y="113" width="26" height="18" rx="4" fill="#fff" opacity="0.6" />
                </template>
                <template v-else>
                  <rect x="18" y="16" width="120" height="10" rx="5" fill="var(--dash)" opacity="0.5" />
                  <rect x="18" y="36" width="170" height="10" rx="5" fill="var(--dash)" opacity="0.35" />
                  <rect x="18" y="56" width="140" height="10" rx="5" fill="var(--dash)" opacity="0.35" />
                  <rect x="160" y="14" width="84" height="128" rx="9" fill="var(--brand)" opacity="0.92" />
                  <rect x="170" y="24" width="64" height="30" rx="4" fill="#fff" opacity="0.9" />
                  <rect x="170" y="62" width="64" height="30" rx="4" fill="#fff" opacity="0.6" />
                  <rect x="170" y="100" width="64" height="30" rx="4" fill="#fff" opacity="0.6" />
                </template>
              </svg>
              <div class="seg">
                <button :class="{ sel: settings.clipboard.layout === 'horizontal' }" type="button" @click="setLayout('horizontal')">横向</button>
                <button :class="{ sel: settings.clipboard.layout === 'vertical' }" type="button" @click="setLayout('vertical')">纵向</button>
              </div>
            </div>
          </div>
        </section>

                                                                              
        <section v-show="section === 'shortcuts'" class="pane-grid">
          <div class="col">
                          
            <div class="card">
              <div class="card-head">
                <span class="card-dot" style="background: #ff7d38"></span>
                <span class="card-title">唤出/隐藏剪切板</span>
              </div>
              <div class="spread">
                <div class="srow">
                  <span class="srow-label">快捷键</span>
                  <div class="srow-ctrl">
                    <div class="hotkey" :class="{ empty: !showHide }">
                      <svg class="hk-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                        <rect x="2.5" y="6" width="19" height="12" rx="2.5" />
                        <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8" />
                      </svg>
                      <span class="hk-keys">
                        <span v-if="showHide" class="key-badge">{{ showHide }}</span>
                        <span v-else>未设置</span>
                      </span>
                    </div>
                    <HotkeyRecorder :model-value="showHide" @update:model-value="onShowHideInput" @record="onRecordShowHide" />
                  </div>
                </div>
              </div>
            </div>

                         
            <div class="card">
              <div class="card-head">
                <span class="card-dot" style="background: #726cff"></span>
                <span class="card-title">切换分组</span>
              </div>
              <div class="spread">
                <div class="srow">
                  <span class="srow-label">切换上一组</span>
                  <div class="srow-ctrl">
                    <div class="hotkey" :class="{ empty: !prevGroup }">
                      <svg class="hk-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                        <rect x="2.5" y="6" width="19" height="12" rx="2.5" />
                        <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8" />
                      </svg>
                      <span class="hk-keys">
                        <span v-if="prevGroup" class="key-badge">{{ prevGroup }}</span>
                        <span v-else>未设置</span>
                      </span>
                    </div>
                    <HotkeyRecorder :model-value="prevGroup" @update:model-value="onPrevGroupInput" @record="(v) => onRecordGroup('previous', v)" />
                  </div>
                </div>
                <div class="srow">
                  <span class="srow-label">切换下一组</span>
                  <div class="srow-ctrl">
                    <div class="hotkey" :class="{ empty: !nextGroup }">
                      <svg class="hk-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                        <rect x="2.5" y="6" width="19" height="12" rx="2.5" />
                        <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8" />
                      </svg>
                      <span class="hk-keys">
                        <span v-if="nextGroup" class="key-badge">{{ nextGroup }}</span>
                        <span v-else>未设置</span>
                      </span>
                    </div>
                    <HotkeyRecorder :model-value="nextGroup" @update:model-value="onNextGroupInput" @record="(v) => onRecordGroup('next', v)" />
                  </div>
                </div>
              </div>
            </div>

                         
            <div class="card">
              <div class="card-head">
                <span class="card-dot" style="background: #cd75ff"></span>
                <span class="card-title">快速粘贴</span>
              </div>
              <div class="spread">
                <div class="srow">
                  <span class="srow-label">开启快速粘贴</span>
                  <div class="srow-ctrl">
                    <button class="cbx" :class="{ on: settings.shortcutKeys.quickPasteEnable }" type="button" @click="onQuickPaste(!settings.shortcutKeys.quickPasteEnable)"></button>
                  </div>
                </div>
                <div class="srow">
                  <span class="srow-label">快速粘贴</span>
                  <div class="srow-ctrl">
                    <div class="hotkey">
                      <svg class="hk-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                        <rect x="2.5" y="6" width="19" height="12" rx="2.5" />
                        <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8" />
                      </svg>
                      <span class="hk-keys">
                        <span class="key-badge">{{ settings.shortcutKeys.quickPaste }}</span>
                      </span>
                    </div>
                    <span class="muted">+ 数字1~9</span>
                  </div>
                </div>
                <p v-if="recError" class="form-error">{{ recError }}</p>
              </div>
            </div>
          </div>

          <div class="col">
                                 
            <div class="card">
              <div class="card-head">
                <span class="card-dot" style="background: #726cff"></span>
                <span class="card-title">指定内容快捷键</span>
              </div>
              <div class="empty-state">
                <svg class="empty-art" viewBox="0 0 96 96" fill="none" aria-hidden="true">
                  <rect x="18" y="14" width="60" height="46" rx="8" fill="var(--brand)" opacity="0.1" />
                  <rect x="24" y="20" width="48" height="34" rx="5" fill="var(--brand)" opacity="0.18" />
                  <rect x="32" y="28" width="14" height="5" rx="2.5" fill="var(--brand)" opacity="0.55" />
                  <rect x="32" y="38" width="26" height="5" rx="2.5" fill="var(--brand)" opacity="0.35" />
                  <circle cx="66" cy="66" r="17" fill="var(--brand)" opacity="0.92" />
                  <path d="M66 56v20M56 66h20" stroke="#fff" stroke-width="4" stroke-linecap="round" />
                </svg>
                <div class="empty-title">您还没有为内容指定过快捷键</div>
                <div class="empty-hint">在剪贴板面板中右键点击任意条目，选择「指定快捷键」，即可用组合键一键粘贴该内容</div>
              </div>
            </div>
          </div>
        </section>

                                                                             
        <section v-show="section === 'general'" class="pane-grid">
          <div class="col">
                         
            <div class="card">
              <div class="card-head">
                <span class="card-dot" style="background: #ff7d38"></span>
                <span class="card-title">启动设置</span>
              </div>
              <div class="rows">
                <div class="srow">
                  <span class="srow-label">开机时自动运行</span>
                  <div class="srow-ctrl">
                    <Toggle :model-value="settings.general.launchAtLogin" @update:model-value="(v) => onGeneral('launchAtLogin', v)" />
                  </div>
                </div>
                <div class="srow">
                  <span class="srow-label">启动时最小化到托盘</span>
                  <div class="srow-ctrl">
                    <Toggle :model-value="settings.general.minTray" @update:model-value="(v) => onGeneral('minTray', v)" />
                  </div>
                </div>
                <div class="srow">
                  <span class="srow-label">显示菜单栏图标</span>
                  <div class="srow-ctrl">
                    <Toggle :model-value="settings.general.menuIcon" @update:model-value="(v) => onGeneral('menuIcon', v)" />
                  </div>
                </div>
              </div>
            </div>

                            
            <div class="card">
              <div class="card-head">
                <span class="card-dot" style="background: #cd75ff"></span>
                <span class="card-title">关于与更新</span>
              </div>
              <div class="rows">
                <div class="srow">
                  <span class="srow-label">当前版本</span>
                  <div class="srow-ctrl"><span class="muted">{{ APP_VERSION }}</span></div>
                </div>
                <div class="srow">
                  <span class="srow-label">数据存储位置</span>
                  <div class="srow-ctrl"><span class="muted path" :title="dataDir">{{ dataDir || '加载中…' }}</span></div>
                </div>
                <div class="srow">
                  <span class="srow-label">检查更新</span>
                  <div class="srow-ctrl">
                    <button class="pill-btn sm" type="button" @click="onCheckUpdate">检查更新</button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div class="col">
                             
            <div class="card">
              <div class="card-head">
                <span class="card-dot" style="background: #726cff"></span>
                <span class="card-title">历史记录容量设置</span>
              </div>
              <div class="hist-zone">
                <div class="hist">
                  <div class="hist-line"></div>
                  <div class="hist-ticks">
                    <button
                      v-for="t in HISTORY_TICKS"
                      :key="t.value"
                      class="hist-tick"
                      :class="{ sel: settings.general.historyCache === t.value }"
                      type="button"
                      @click="onHistory(t.value)"
                    >
                      <span class="dot"></span>
                      <span class="lbl">{{ t.label }}</span>
                    </button>
                  </div>
                </div>
              </div>
              <p class="hist-desc">历史记录达到所选时长上限后，较早的内容会被自动清理</p>
              <div class="hist-act">
                <button class="pill-btn" type="button" @click="onClearHistory">清空历史记录</button>
              </div>
            </div>
          </div>
        </section>

                                                                             
        <section v-show="section === 'intelligence'" class="pane-grid single page-intel">
          <div class="col">
            <div class="card card-intel">
              <div class="card-head">
                <span class="card-dot" style="background: #cd75ff"></span>
                <span class="card-title">智能</span>
              </div>
              <div class="intel-toggles">
                <div class="srow">
                  <span class="srow-label">智能分组</span>
                  <div class="srow-ctrl">
                    <Toggle :model-value="settings.intelligence.autoGroup" @update:model-value="(v) => patch({ intelligence: { autoGroup: v } })" />
                  </div>
                </div>
                <div class="srow">
                  <span class="srow-label">语义搜索</span>
                  <div class="srow-ctrl">
                    <Toggle :model-value="settings.intelligence.semanticSearch" @update:model-value="(v) => patch({ intelligence: { semanticSearch: v } })" />
                  </div>
                </div>
                <div class="srow">
                  <span class="srow-label">智能粘贴匹配</span>
                  <div class="srow-ctrl">
                    <Toggle :model-value="settings.intelligence.smartPasteMatch" @update:model-value="(v) => patch({ intelligence: { smartPasteMatch: v } })" />
                  </div>
                </div>
                <div class="srow model-entry-row">
                  <span class="srow-label">MiniLM 精排</span>
                  <span class="srow-grow"></span>
                  <span v-if="activeModelName" class="muted model-name" :title="activeModelName">{{ activeModelName }}</span>
                  <span v-else class="tip warn">未启用</span>
                  <button class="pill-btn sm" type="button" @click="onManageModels">管理</button>
                </div>
              </div>
            </div>

                                     
            <div class="card card-l1">
              <div class="card-head">
                <span class="card-dot" style="background: #726cff"></span>
                <span class="card-title">本地向量</span>
              </div>
              <div class="rows">
                <div class="srow">
                  <span class="srow-label">启用本地向量</span>
                  <div class="srow-ctrl">
                    <Toggle :model-value="isL1" @update:model-value="onL1Toggle" />
                  </div>
                  <span class="srow-grow"></span>
                  <span class="muted">{{ l1StateText }}</span>
                </div>
                <div class="srow">
                  <span class="srow-label">向量后端</span>
                  <div class="srow-ctrl">
                    <div class="seg">
                      <button :class="{ sel: true }" type="button">内置轻量向量</button>
                      <button class="disabled" type="button" disabled title="预留：放置本地 ONNX 模型后启用">本地 ONNX 模型</button>
                    </div>
                  </div>
                  <span class="srow-grow"></span>
                  <span class="muted">离线可用 · 零下载</span>
                </div>
                <div class="srow">
                  <span class="srow-label">索引进度</span>
                  <span class="muted">{{ l1Progress || '—' }}</span>
                  <span class="srow-grow"></span>
                  <div class="srow-ctrl">
                    <button class="pill-btn sm ghost" type="button" :disabled="!isL1" @click="onReindex">重建索引</button>
                  </div>
                </div>
              </div>
              <p class="tip">开启后支持语义搜索与智能匹配，规则继续参与排序。</p>
            </div>
          </div>
        </section>

                                                                              
        <section v-show="section === 'browser'" class="pane-grid single page-browser">
          <div class="col">
                            
            <div class="card card-browser">
              <div class="card-head">
                <div class="card-heading">
                  <span class="card-dot" style="background: #ff7d38"></span>
                  <span class="card-title">浏览器扩展连接</span>
                </div>
                <div class="connection-summary">
                  <span class="conn-dot" :class="connState"></span>
                  <span :class="{ 'conn-err': connState === 'err' }">{{ connText }}</span>
                  <span v-if="clientUa" class="conn-ua" :title="clientUa">{{ clientUa }}</span>
                </div>
              </div>
              <div class="brow-rows">
                <div class="srow">
                  <span class="srow-label">启用桥接</span>
                  <div class="srow-ctrl">
                    <Toggle :model-value="browserStatus?.enabled ?? false" @update:model-value="onBrowserEnabled" />
                  </div>
                  <span class="srow-grow"></span>
                  <span class="srow-label">端口</span>
                  <div class="srow-ctrl">
                    <input
                      class="ipt num"
                      type="number"
                      min="1"
                      max="65535"
                      :value="browserStatus?.port ?? 9377"
                      @change="onPortChange"
                    />
                  </div>
                  <span v-if="pingText" class="ping-result" :class="pingResult">{{ pingText }}</span>
                  <button class="pill-btn sm ghost" type="button" :disabled="pinging" @click="onPing">
                    {{ pinging ? '检测中…' : '测试连接' }}
                  </button>
                </div>
                <div class="srow">
                  <span class="srow-label">连接令牌</span>
                  <div class="srow-ctrl brow-token">
                    <input class="ipt mono" type="text" readonly :value="browserStatus?.token ?? ''" placeholder="点击重新生成" />
                    <button class="pill-btn sm" type="button" @click="onCopyToken">复制</button>
                    <button class="pill-btn sm ghost" type="button" @click="onRegenToken">重新生成</button>
                  </div>
                </div>
                <div class="srow card-footer-row">
                  <span class="token-tip">{{ tokenTip || '令牌仅保存在本机' }}</span>
                  <span class="srow-grow"></span>
                  <span class="muted">网页版仅限本机访问</span>
                  <button class="pill-btn sm" type="button" @click="onOpenWebManager">打开管理页</button>
                </div>
                <div class="srow">
                  <span class="srow-label">网页版管理随软件启动</span>
                  <div class="srow-ctrl">
                    <Toggle :model-value="settings.webManager.enabled" @update:model-value="onWebManagerEnabled" />
                  </div>
                  <span class="srow-grow"></span>
                  <span class="srow-label">管理页端口</span>
                  <div class="srow-ctrl">
                    <input class="ipt num" type="number" min="1" max="65535" :value="settings.webManager.port" @change="onWebManagerPortChange" />
                  </div>
                </div>
              </div>
            </div>

                           
            <div class="card card-jev">
              <div class="card-head">
                <div class="card-heading">
                  <span class="card-dot" style="background: #726cff"></span>
                  <span class="card-title">网页智能填充</span>
                </div>
                <div class="header-toggle">
                  <span>{{ settings.jev.enabled ? '已启用' : '未启用' }}</span>
                  <Toggle :model-value="settings.jev.enabled" @update:model-value="onJevEnabled" />
                </div>
              </div>
              <div class="brow-rows">
                <div class="srow">
                  <span class="srow-label">匹配方式</span>
                  <div class="srow-ctrl">
                    <div class="seg">
                      <button :class="{ sel: settings.jev.mode === 'rule' }" type="button" @click="onJevMode('rule')">规则匹配</button>
                      <button :class="{ sel: settings.jev.mode === 'model' }" type="button" @click="onJevMode('model')">模型匹配</button>
                    </div>
                  </div>
                </div>
                <div class="srow">
                  <span class="srow-label">置信度阈值</span>
                  <div class="srow-ctrl">
                    <input
                      class="slider"
                      type="range"
                      min="0.3"
                      max="0.9"
                      step="0.05"
                      :value="thresholdDraft"
                      @input="onThresholdInput"
                      @change="onThresholdChange"
                    />
                    <span class="slider-val">{{ thresholdDraft.toFixed(2) }}</span>
                  </div>
                </div>
                <div class="srow fill-behavior-row">
                  <div>
                    <div class="srow-label">唯一结果自动填入</div>
                    <div class="tip">关闭后只显示候选，由你确认后填入</div>
                  </div>
                  <span class="srow-grow"></span>
                  <Toggle :model-value="browserStatus?.autoFill ?? true" @update:model-value="onAutoFill" />
                </div>
                <details class="sensitive-settings">
                  <summary>
                    <span class="srow-label">敏感字段</span>
                    <span class="sensitive-state">{{ sensitiveFillCount ? `${sensitiveFillCount} 项已允许` : '全部关闭' }}</span>
                    <span class="srow-grow"></span>
                    <span class="sensitive-action">配置</span>
                  </summary>
                  <div class="sensitive-grid">
                    <div v-for="item in SENSITIVE_FILL_OPTIONS" :key="item.key" class="sensitive-option">
                      <span>{{ item.label }}</span>
                      <Toggle
                        :model-value="settings.browser.sensitiveFill[item.key]"
                        @update:model-value="(enabled) => onSensitiveFill(item.key, item.label, enabled)"
                      />
                    </div>
                  </div>
                  <p class="tip sensitive-tip">仅在你点击对应字段时使用剪贴板候选，请只在可信页面开启。</p>
                </details>
                <div v-if="settings.jev.mode === 'model'" class="srow model-row">
                  <span class="srow-label">决策模型</span>
                  <span v-if="activeModelName" class="muted model-name" :title="activeModelName">{{ activeModelName }}</span>
                  <span v-else class="tip warn">尚未选择模型</span>
                  <span class="srow-grow"></span>
                  <button class="pill-btn sm ghost" type="button" @click="section = 'intelligence'">前往智能</button>
                </div>
                <p v-else class="tip mode-tip">当前使用规则与内置向量，无需下载模型</p>
              </div>
            </div>
          </div>
        </section>
        </div>
      </main>

                                 
      <ModelManagerModal v-if="showModelManager" @close="showModelManager = false" />
    </div>
  </div>
</template>

<style scoped>
                                     
.pane-grid.single {
  gap: 14px;
}
.pane-grid.single > .col > .card {
  flex: 1 1 0;
  min-height: 0;
}
                      
.page-intel > .col > .card.card-intel {
  flex: 0 0 auto;
  min-height: 198px;
}
                                 
.page-browser > .col > .card.card-browser {
  flex: 0.88 1 0;
}
.page-browser > .col > .card.card-jev {
  flex: 1.12 1 0;
  overflow-y: auto;
}
                     
.card-browser,
.card-jev {
  padding: 16px 20px;
}
.card-browser .card-head,
.card-jev .card-head {
  justify-content: space-between;
  margin-bottom: 14px;
}
.card-browser .card-title,
.card-jev .card-title {
  font-size: 13px;
}
.card-heading,
.connection-summary,
.header-toggle {
  display: flex;
  align-items: center;
}
.card-heading {
  gap: 9px;
}
.connection-summary {
  gap: 7px;
  min-width: 0;
  color: var(--text-2);
  font-size: 11.5px;
}
.header-toggle {
  gap: 10px;
  color: var(--text-2);
  font-size: 11.5px;
}

                                                 
:deep(.switch) {
  position: relative;
  width: 44px;
  height: 24px;
  flex: none;
  display: inline-block;
}
:deep(.switch input) {
  position: absolute;
  opacity: 0;
  width: 0;
  height: 0;
}
:deep(.switch .track) {
  position: absolute;
  inset: 0;
  border-radius: var(--r-pill);
  background: var(--track-off);
  transition: background 0.16s;
}
:deep(.switch .knob) {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.22);
  transition: transform 0.16s;
}
:deep(.switch input:checked + .track) {
  background: var(--brand);
}
:deep(.switch input:checked + .track .knob) {
  transform: translateX(20px);
}
:deep(.switch.disabled) {
  opacity: 0.5;
  pointer-events: none;
}

                            
.brow-rows {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
  gap: 14px;
}
.brow-rows .srow {
  min-height: 28px;
  padding: 0;
}
.brow-rows .srow-label {
  font-size: 12.5px;
  white-space: nowrap;
}
.brow-rows .tip {
  padding: 0;
}
.srow-grow {
  flex: 1;
}
.sensitive-settings {
  border-top: 1px solid var(--border-2);
  padding-top: 6px;
}
.sensitive-settings summary {
  min-height: 30px;
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
  list-style: none;
}
.sensitive-settings summary::-webkit-details-marker {
  display: none;
}
.sensitive-state,
.sensitive-action {
  font-size: 11.5px;
}
.sensitive-state {
  color: var(--text-3);
}
.sensitive-action {
  color: var(--brand);
}
.sensitive-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  column-gap: 18px;
}
.sensitive-option {
  min-width: 0;
  min-height: 38px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  border-bottom: 1px solid var(--border-2);
  color: var(--text-2);
  font-size: 12px;
}
.sensitive-tip {
  margin-top: 8px;
}

                                      
.conn-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex: none;
  display: inline-block;
}
.conn-dot.off {
  background: var(--dash);
}
.conn-dot.on {
  background: #22c55e;
}
.conn-dot.err {
  background: #e5484d;
}
.conn-err {
  color: #e5484d;
}
.conn-ua {
  font-size: 11px;
  color: var(--text-3);
  max-width: 190px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

                          
.ipt {
  height: 22px;
  border: none;
  background: var(--input-bg);
  border-radius: 8px;
  padding: 0 10px;
  font-size: 11.5px;
  color: var(--text);
  min-width: 0;
}
.ipt:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.ipt.mono {
  flex: 1;
  min-width: 80px;
  font-family: ui-monospace, Consolas, 'Courier New', monospace;
  letter-spacing: 0.6px;
}
.ipt.num {
  width: 76px;
}
.brow-token {
  flex: 1;
  min-width: 0;
  justify-content: flex-end;
}

          
.brow-rows .seg {
  padding: 2px;
}
.brow-rows .seg button {
  padding: 4px 14px;
  font-size: 12px;
}
.slider {
  -webkit-appearance: none;
  appearance: none;
  width: 140px;
  height: 4px;
  border-radius: 2px;
  background: var(--track-off);
  outline: none;
}
.slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--brand);
  cursor: pointer;
}
.slider-val {
  font-size: 12px;
  font-weight: 600;
  color: var(--brand);
  min-width: 32px;
  text-align: right;
}

          
.tip {
  font-size: 11px;
  color: var(--text-2);
  line-height: 1.5;
  margin: 0;
}
                     
.model-name {
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tip.warn {
  color: #f59e0b;
  white-space: nowrap;
}
.ping-result {
  font-size: 11px;
  white-space: nowrap;
}
.ping-result.ok {
  color: #22c55e;
}
.ping-result.fail {
  color: #e5484d;
}
.token-tip {
  font-size: 11px;
  color: var(--text-2);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.card-footer-row {
  margin-top: auto;
  padding-top: 11px !important;
  border-top: 1px solid var(--border-2);
}
.fill-behavior-row {
  min-height: 42px !important;
}
.model-row {
  padding-top: 2px !important;
}
.model-entry-row {
  min-height: 30px !important;
  gap: 12px;
}
.mode-tip {
  margin-top: auto;
  padding-top: 10px;
  border-top: 1px solid var(--border-2);
}
</style>
