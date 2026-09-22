<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import type { ModelConfig, ModelDownloadInfo, ModelState } from '@shared/types'
import { api } from '../api/bridge'
import { useSettingsStore } from '../stores/settings'
import Toggle from './Toggle.vue'

   
                                      
                                                                         
                                            
   

const emit = defineEmits<{ (e: 'close'): void }>()

const store = useSettingsStore()
const models = computed<ModelConfig[]>(() => store.settings.intelligence.models ?? [])
const activeId = computed<string>(() => store.settings.intelligence.activeModelId ?? '')

const KIND_LABEL: Record<ModelConfig['kind'], string> = {
  decision: '决策',
  embedding: '向量',
  llm: 'LLM',
}

const STATE_LABEL: Record<ModelState, string> = {
  unloaded: '未加载',
  loading: '加载中…',
  ready: '已加载',
  failed: '加载失败',
}

                                                            
const TEMPLATES: Record<'zh' | 'multi', Omit<FormState, 'id' | 'enabled'>> = {
  zh: {
    name: 'BGE Small 中文轻量版',
    kind: 'decision',
    backend: 'onnx',
    task: 'feature-extraction',
    dtype: 'q8',
    downloadId: 'bge-small-zh-q8',
    sizeBytes: 25_000_000,
    repo: 'Xenova/bge-small-zh-v1.5',
    path: 'bge-small-zh-q8',
    note: '中文优先 · INT8 · 约 25 MB · 推荐',
  },
  multi: {
    name: 'MiniLM 多语言轻量版',
    kind: 'decision',
    backend: 'onnx',
    task: 'feature-extraction',
    dtype: 'q8',
    downloadId: 'minilm-multilingual-q8',
    sizeBytes: 136_000_000,
    repo: 'Xenova/paraphrase-multilingual-MiniLM-L12-v2',
    path: 'minilm-multilingual-q8',
    note: '多语言 · INT8 · 约 136 MB',
  },
}

interface FormState {
                
  id: string
  name: string
  kind: ModelConfig['kind']
  backend: ModelConfig['backend']
  task?: ModelConfig['task']
  dtype?: ModelConfig['dtype']
  downloadId?: string
  sizeBytes?: number
  repo: string
  path: string
  note: string
  enabled: boolean
}

function emptyForm(): FormState {
  return {
    id: '',
    name: '',
    kind: 'decision',
    backend: 'onnx',
    repo: '',
    path: '',
    note: '',
    enabled: true,
  }
}

const form = ref<FormState | null>(null)
const error = ref('')
const stateMap = ref<Record<string, ModelState>>({})
const downloadMap = ref<Record<string, ModelDownloadInfo>>({})
const dataDir = ref('')

function newId(): string {
  return `m_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

async function refreshStatus(): Promise<void> {
  try {
    const st = await api.intelligence.modelStatus()
    const map: Record<string, ModelState> = {}
    const downloads: Record<string, ModelDownloadInfo> = {}
    for (const m of st.models) {
      map[m.id] = m.state
      downloads[m.id] = m.download
    }
    stateMap.value = map
    downloadMap.value = downloads
  } catch (e) {
    console.error('[model-manager] model status failed', e)
  }
}

let offStatus: (() => void) | null = null
let offDownload: (() => void) | null = null

onMounted(() => {
  void refreshStatus()
                                                             
  offStatus = window.clipnest.onIntelligenceStatus(s => {
    if (!s.models) return
    const map: Record<string, ModelState> = {}
    for (const m of s.models) map[m.id] = m.state
    stateMap.value = map
  })
  offDownload = window.clipnest.onModelDownload(info => {
    downloadMap.value = { ...downloadMap.value, [info.modelId]: info }
  })
  void api.common
    .dataDir()
    .then(d => (dataDir.value = d))
    .catch(e => {
      console.error('[model-manager] data directory failed', e)
      dataDir.value = ''
    })
})

onUnmounted(() => {
  offStatus?.()
  offDownload?.()
  offStatus = null
  offDownload = null
})

function stateOf(m: ModelConfig): ModelState {
  if (m.id !== activeId.value) return 'unloaded'
  return stateMap.value[m.id] ?? 'unloaded'
}

function onAdd(): void {
  error.value = ''
  form.value = emptyForm()
}

function onEdit(m: ModelConfig): void {
  error.value = ''
  form.value = { ...m }
}

function onApplyTemplate(key: 'zh' | 'multi'): void {
  if (!form.value) return
  error.value = ''
  form.value = { ...form.value, ...TEMPLATES[key] }
}

function onKindChange(kind: ModelConfig['kind']): void {
  if (!form.value) return
  form.value.kind = kind
                                      
  if (kind !== 'decision' && form.value.backend === 'onnx') form.value.backend = 'builtin'
}

async function persist(next: ModelConfig[], nextActive: string): Promise<void> {
  try {
    await api.settings.update({ intelligence: { models: next, activeModelId: nextActive } })
  } catch (e) {
    console.error('[model-manager] save failed', e)
    error.value = '保存失败，请重试'
  }
}

async function onSave(): Promise<void> {
  const f = form.value
  if (!f) return
  const name = f.name.trim()
  const path = f.path.trim()
  if (!name) {
    error.value = '请填写模型名称'
    return
  }
  if (!path) {
    error.value = '请填写本地模型目录'
    return
  }
  error.value = ''
  const id = f.id || newId()
  const cfg: ModelConfig = {
    id,
    name,
    kind: f.kind,
    backend: f.backend,
    task: f.task,
    dtype: f.dtype,
    downloadId: f.downloadId,
    sizeBytes: f.sizeBytes,
    repo: f.repo.trim(),
    path,
    enabled: f.enabled,
    note: f.note.trim(),
  }
  const exists = models.value.some(m => m.id === id)
  const next = exists ? models.value.map(m => (m.id === id ? cfg : m)) : [...models.value, cfg]
  await persist(next, activeId.value)
  form.value = null
}

async function onDelete(m: ModelConfig): Promise<void> {
  if (!window.confirm(`确定删除模型「${m.name}」？仅移除注册信息，不会删除模型文件。`)) return
  error.value = ''
  const next = models.value.filter(x => x.id !== m.id)
  const nextActive = activeId.value === m.id ? '' : activeId.value
  await persist(next, nextActive)
  if (form.value?.id === m.id) form.value = null
}

async function onToggleEnabled(m: ModelConfig, v: boolean): Promise<void> {
  error.value = ''
  const next = models.value.map(x => (x.id === m.id ? { ...x, enabled: v } : x))
  await persist(next, activeId.value)
}

async function onSetActive(m: ModelConfig): Promise<void> {
  error.value = ''
  if (m.downloadId && downloadMap.value[m.id]?.state !== 'downloaded') {
    error.value = '请先下载模型，再设为当前模型'
    return
  }
                                     
  const next = models.value.map(x => (x.id === m.id ? { ...x, enabled: true } : x))
  await persist(next, m.id)
}

function downloadOf(m: ModelConfig): ModelDownloadInfo | null {
  return m.downloadId ? downloadMap.value[m.id] ?? null : null
}

function downloadLabel(m: ModelConfig): string {
  const info = downloadOf(m)
  if (!info || info.state === 'not-downloaded') return '下载'
  if (info.state === 'downloaded') return '已下载'
  if (info.state === 'failed') return '重试下载'
  const total = Math.max(info.totalBytes, 1)
  return `下载 ${Math.min(99, Math.round((info.receivedBytes / total) * 100))}%`
}

async function onDownload(m: ModelConfig): Promise<void> {
  if (!m.downloadId || downloadOf(m)?.state === 'downloading') return
  error.value = ''
  try {
    const result = await api.intelligence.downloadModel(m.id)
    downloadMap.value = { ...downloadMap.value, [m.id]: result.info }
    if (!result.ok) error.value = result.info.error || '下载失败，请重试'
  } catch (e) {
    console.error('[model-manager] download failed', e)
    error.value = '下载失败，请检查网络后重试'
  }
}

                                  
function absHint(path: string): string {
  const p = path.trim()
  if (!p) return ''
  if (/^[a-zA-Z]:[\\/]/.test(p) || p.startsWith('\\\\')) return p
  const root = dataDir.value ? `${dataDir.value}\\models` : '模型目录'
  return `${root}\\${p.replace(/\//g, '\\')}`
}
</script>

<template>
  <div class="mask" @click.self="emit('close')">
    <div class="modal" role="dialog" aria-label="本地模型管理">
      <header class="mm-head">
        <span class="mm-title">本地模型管理</span>
        <button class="mm-close" type="button" title="关闭" @click="emit('close')"></button>
      </header>

      <div class="mm-body">
                       
        <section class="mm-list">
          <div class="mm-list-head">
            <span class="mm-sub">已注册 {{ models.length }} 个</span>
            <button class="mini-btn" type="button" @click="onAdd">+ 添加模型</button>
          </div>
          <p v-if="models.length === 0" class="mm-empty">还没有注册模型，点击「添加模型」或用右侧模板快速填入。</p>
          <div v-for="m in models" :key="m.id" class="mrow" :class="{ active: m.id === activeId }">
            <label class="radio" title="设为当前模型">
              <input type="radio" :checked="m.id === activeId" @change="onSetActive(m)" />
              <span class="mark"></span>
            </label>
            <div class="minfo">
              <div class="mname">
                <span class="mname-text">{{ m.name }}</span>
                <span class="badge" :class="m.kind">{{ KIND_LABEL[m.kind] }}</span>
                <span class="badge backend">{{ m.backend === 'onnx' ? 'ONNX' : '内置' }}</span>
              </div>
              <div class="mpath" :title="absHint(m.path)">{{ m.path || '（未设置路径）' }}</div>
              <div v-if="m.note" class="mnote">{{ m.note }}</div>
            </div>
            <div class="macts">
              <span class="state-dot" :class="stateOf(m)"></span>
              <span class="state-text" :class="stateOf(m)">{{ STATE_LABEL[stateOf(m)] }}</span>
              <button
                v-if="m.downloadId"
                class="mini-btn download-btn"
                type="button"
                :disabled="downloadOf(m)?.state === 'downloading' || downloadOf(m)?.state === 'downloaded'"
                @click="onDownload(m)"
              >{{ downloadLabel(m) }}</button>
              <Toggle :model-value="m.enabled" @update:model-value="(v: boolean) => onToggleEnabled(m, v)" />
              <button class="mini-btn" type="button" @click="onEdit(m)">编辑</button>
              <button class="mini-btn danger" type="button" @click="onDelete(m)">删除</button>
            </div>
          </div>
          <p v-if="activeId && stateMap[activeId] === 'failed'" class="mm-fail-tip">
            当前模型加载失败，已自动回退规则打分：请检查模型目录文件是否完整（需 config.json、tokenizer 与权重）。
          </p>
          <p v-if="error && !form" class="mm-fail-tip">{{ error }}</p>
        </section>

                          
        <section v-if="form" class="mm-form">
          <div class="mm-form-head">
            <span class="mm-sub">{{ form.id ? '编辑模型' : '添加模型' }}</span>
            <div class="tpl-btns">
              <button class="mini-btn" type="button" @click="onApplyTemplate('zh')">填入中文轻量模板</button>
              <button class="mini-btn" type="button" @click="onApplyTemplate('multi')">填入多语言模板</button>
            </div>
          </div>
          <label class="fld">
            <span class="fld-label">名称</span>
            <input v-model="form.name" class="ipt" type="text" placeholder="如 BGE Small 中文轻量版" />
          </label>
          <div class="fld-row">
            <label class="fld">
              <span class="fld-label">类型</span>
              <select v-model="form.kind" class="ipt" @change="onKindChange(($event.target as HTMLSelectElement).value as ModelConfig['kind'])">
                <option value="decision">决策模型</option>
                <option value="embedding">向量模型</option>
                <option value="llm">LLM</option>
              </select>
            </label>
            <label class="fld">
              <span class="fld-label">后端</span>
              <select v-model="form.backend" class="ipt">
                <option value="onnx" :disabled="form.kind !== 'decision'">ONNX</option>
                <option value="builtin" disabled>内置</option>
              </select>
            </label>
          </div>
          <label class="fld">
            <span class="fld-label">本地路径</span>
            <input v-model="form.path" class="ipt mono" type="text" placeholder="bge-small-zh-q8" />
            <span class="fld-hint">相对路径基于模型目录；绝对路径可直接填写</span>
            <span v-if="absHint(form.path)" class="fld-hint mono">→ {{ absHint(form.path) }}</span>
          </label>
          <label class="fld">
            <span class="fld-label">HF 仓库（备注）</span>
            <input v-model="form.repo" class="ipt mono" type="text" placeholder="Xenova/bge-small-zh-v1.5" />
          </label>
          <label class="fld">
            <span class="fld-label">语言/尺寸备注</span>
            <input v-model="form.note" class="ipt" type="text" placeholder="仅英文 · 0.4B" />
          </label>
          <div class="fld fld-toggle">
            <span class="fld-label">启用</span>
            <Toggle v-model="form.enabled" />
          </div>
          <p v-if="error" class="form-error">{{ error }}</p>
          <div class="mm-form-foot">
            <button class="pill-btn sm" type="button" @click="onSave">保存</button>
            <button class="pill-btn sm ghost" type="button" @click="form = null">取消</button>
          </div>
        </section>

                       
        <section v-else class="mm-guide">
          <p class="mm-guide-title">决策模型</p>
          <p class="mm-guide-text">
            决策模型是 Jev 智能填充的"大脑"：输入字段上下文与剪贴板候选，一次前向选出最匹配项并给出置信度。
            两个预置模型都只在点击下载后联网，下载完成后可设为当前模型。
          </p>
          <p class="mm-guide-text">
            中文轻量版约 25 MB，多语言轻量版约 136 MB；加载失败时仍会使用规则匹配。
          </p>
        </section>
      </div>

      <footer class="mm-foot">
        <span class="mm-foot-tip">模型仅在点击下载后联网；加载失败会自动回退规则打分。</span>
        <button class="pill-btn sm ghost" type="button" @click="emit('close')">关闭</button>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.mask {
  position: fixed;
  inset: 0;
  z-index: 300;
  background: rgba(17, 12, 46, 0.35);
  display: flex;
  align-items: center;
  justify-content: center;
}

.modal {
  width: 720px;
  max-width: calc(100vw - 48px);
  max-height: calc(100vh - 64px);
  background: var(--surface);
  border-radius: var(--r-card);
  box-shadow: var(--shadow-pop);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.mm-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 20px 10px;
  flex: none;
}
.mm-title {
  font-size: 15px;
  font-weight: 700;
  color: var(--text);
}
.mm-close {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #ff5f57;
  padding: 0;
  transition: filter 0.12s;
}
.mm-close:hover {
  filter: brightness(0.9);
}

.mm-body {
  flex: 1;
  min-height: 0;
  display: flex;
  gap: 16px;
  padding: 4px 20px 12px;
}

          
.mm-list {
  flex: 1.2 1 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  overflow-y: auto;
  padding-right: 4px;
}
.mm-list-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex: none;
}
.mm-sub {
  font-size: 12px;
  color: var(--text-2);
}
.mm-empty {
  font-size: 12px;
  color: var(--text-3);
  line-height: 1.6;
}

.mrow {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 10px;
  padding: 10px;
  border: 1px solid var(--border-2);
  border-radius: 12px;
  background: var(--surface-3);
}
.mrow.active {
  border-color: var(--brand);
  background: var(--selected-bg);
}
.minfo {
  flex: 1 1 150px;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.mname {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.mname-text {
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.badge {
  flex: none;
  font-size: 10px;
  line-height: 1;
  padding: 3px 6px;
  border-radius: 6px;
  background: var(--brand-soft);
  color: var(--brand);
}
.badge.embedding {
  background: rgba(34, 197, 94, 0.12);
  color: #16a34a;
}
.badge.llm {
  background: rgba(255, 125, 56, 0.12);
  color: #ea580c;
}
.badge.backend {
  background: var(--surface-2);
  color: var(--text-2);
}
.mpath {
  font-size: 11px;
  color: var(--text-2);
  font-family: ui-monospace, Consolas, 'Courier New', monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mnote {
  font-size: 11px;
  color: var(--text-3);
}
                                  
.macts {
  flex: 0 1 auto;
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}

                                       
.state-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex: none;
}
.state-dot.unloaded {
  background: var(--dash);
}
.state-dot.loading {
  background: #f59e0b;
}
.state-dot.ready {
  background: #22c55e;
}
.state-dot.failed {
  background: #e5484d;
}
.state-text {
  font-size: 11px;
  white-space: nowrap;
}
.state-text.unloaded {
  color: var(--text-2);
}
.state-text.loading {
  color: #f59e0b;
}
.state-text.ready {
  color: #22c55e;
}
.state-text.failed {
  color: #e5484d;
}
.mm-fail-tip {
  font-size: 11px;
  color: #e5484d;
  line-height: 1.6;
  padding: 8px 10px;
  border-radius: 10px;
  background: rgba(229, 72, 77, 0.08);
}

               
.mm-form {
  flex: 1 1 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  overflow-y: auto;
  padding: 10px 12px;
  border: 1px solid var(--border-2);
  border-radius: 12px;
  background: var(--surface-3);
}
.mm-form-head {
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex: none;
}
.tpl-btns {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.fld {
  display: flex;
  flex-direction: column;
  gap: 3px;
  flex: none;
}
.fld-row {
  display: flex;
  gap: 10px;
}
.fld-row .fld {
  flex: 1;
  min-width: 0;
}
.fld-label {
  font-size: 12px;
  color: var(--text-2);
}
.fld-hint {
  font-size: 10.5px;
  color: var(--text-3);
  word-break: break-all;
}
.fld-hint.mono {
  font-family: ui-monospace, Consolas, 'Courier New', monospace;
}
.fld-toggle {
  flex-direction: row;
  align-items: center;
  gap: 10px;
}
.mm-form .ipt {
  height: 26px;
  border: 1px solid var(--border);
  background: var(--surface);
  border-radius: 8px;
  padding: 0 9px;
  font-size: 12px;
  color: var(--text);
  width: 100%;
  min-width: 0;
}
.mm-form .ipt:focus {
  outline: none;
  border-color: var(--brand);
}
.mm-form .ipt:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.mm-form .ipt.mono {
  font-family: ui-monospace, Consolas, 'Courier New', monospace;
  font-size: 11.5px;
}
.mm-form-foot {
  display: flex;
  gap: 8px;
  margin-top: auto;
  padding-top: 6px;
}

.mm-guide {
  flex: 1 1 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px 14px;
  border: 1px dashed var(--dash);
  border-radius: 12px;
  background: var(--surface-3);
}
.mm-guide-title {
  font-size: 13px;
  font-weight: 700;
  color: var(--text);
}
.mm-guide-text {
  font-size: 11.5px;
  color: var(--text-2);
  line-height: 1.7;
}

.mm-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 20px 14px;
  flex: none;
  border-top: 1px solid var(--border-2);
}
.mm-foot .mm-foot-text {
  font-size: 11px;
  color: var(--text-3);
}
.mini-btn.danger {
  color: #e5484d;
}
.mini-btn.danger:hover {
  border-color: #e5484d;
  color: #e5484d;
}
.mini-btn:disabled {
  opacity: 0.58;
  cursor: not-allowed;
}
.download-btn {
  min-width: 58px;
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
</style>
