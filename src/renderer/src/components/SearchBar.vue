<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import { useGroupsStore } from '../stores/groups'
import { api } from '../api/bridge'

const props = defineProps<{ modelValue: string; activeGroup: string }>()
const emit = defineEmits<{
  (e: 'update:modelValue', v: string): void
  (e: 'search', v: string): void
  (e: 'groupChange', id: string): void
}>()

const groups = useGroupsStore()

const text = ref(props.modelValue)
let timer = 0

watch(
  () => props.modelValue,
  (v) => {
    if (v !== text.value) text.value = v
  },
)

function onInput(e: Event): void {
  text.value = (e.target as HTMLInputElement).value
  emit('update:modelValue', text.value)
  window.clearTimeout(timer)
  timer = window.setTimeout(() => emit('search', text.value.trim()), 200)
}

function clear(): void {
  window.clearTimeout(timer)
  text.value = ''
  emit('update:modelValue', '')
  emit('search', '')
}

                                                                        
const groupOpen = ref(false)
const moreOpen = ref(false)
const creating = ref(false)
const draft = ref('')
const draftEl = ref<HTMLInputElement | null>(null)
const renamingId = ref<string | null>(null)
const renameText = ref('')
const renameEl = ref<HTMLInputElement | null>(null)

const activeName = computed(() => {
  const c = groups.chips.find((x) => x.id === props.activeGroup)
  return c ? c.name : '全部'
})

function toggleGroups(): void {
  groupOpen.value = !groupOpen.value
  moreOpen.value = false
  if (groupOpen.value) {
    creating.value = false
    renamingId.value = null
  }
}

function toggleMore(): void {
  moreOpen.value = !moreOpen.value
  groupOpen.value = false
}

function pickGroup(id: string): void {
  emit('groupChange', id)
  groupOpen.value = false
}

function startCreate(): void {
  creating.value = true
  draft.value = ''
  renamingId.value = null
  void nextTick(() => draftEl.value?.focus())
}

async function commitCreate(): Promise<void> {
  const name = draft.value.trim()
  creating.value = false
  if (!name) return
  const g = await groups.create(name)
  if (g) emit('groupChange', g.id)
}

function onDraftKey(e: KeyboardEvent): void {
  if (e.key === 'Enter') {
    e.preventDefault()
    void commitCreate()
  } else if (e.key === 'Escape') {
    creating.value = false
  }
}

function startRename(id: string, current: string): void {
  renamingId.value = id
  renameText.value = current
  creating.value = false
  void nextTick(() => renameEl.value?.focus())
}

async function commitRename(): Promise<void> {
  const id = renamingId.value
  const name = renameText.value.trim()
  renamingId.value = null
  if (!id || !name) return
  await groups.rename(id, name)
}

function onRenameKey(e: KeyboardEvent): void {
  if (e.key === 'Enter') {
    e.preventDefault()
    void commitRename()
  } else if (e.key === 'Escape') {
    renamingId.value = null
  }
}

function removeGroup(id: string): void {
  if (!window.confirm('删除该分组？组内记录会变为未分组。')) return
  void groups.remove(id).then((ok) => {
    if (ok && props.activeGroup === id) emit('groupChange', 'all')
  })
}

                                                                        
function openSettings(): void {
  moreOpen.value = false
  api.window.openSettings()
}

function quit(): void {
  moreOpen.value = false
  api.common.quit()
}

              
function onDocMouseDown(e: MouseEvent): void {
  const t = e.target as HTMLElement | null
  if (t && t.closest('.topbar')) return
  groupOpen.value = false
  moreOpen.value = false
}
watch(
  () => groupOpen.value || moreOpen.value,
  (open) => {
    if (open) document.addEventListener('mousedown', onDocMouseDown)
    else document.removeEventListener('mousedown', onDocMouseDown)
  },
)

onUnmounted(() => {
  window.clearTimeout(timer)
  document.removeEventListener('mousedown', onDocMouseDown)
})
</script>

<template>
  <div class="topbar">
    <div class="search">
      <svg class="s-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="11" cy="11" r="7" />
        <path d="M21 21l-4.3-4.3" />
      </svg>
      <input
        :value="text"
        type="text"
        placeholder="搜索剪贴板"
        spellcheck="false"
        @input="onInput"
      />
      <button v-if="text" class="search-clear" title="清空" @click="clear">✕</button>
    </div>

    <button class="tb-btn" type="button" @click="toggleGroups">
      <span>{{ activeName }}</span>
      <svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M6 9l6 6 6-6" />
      </svg>
    </button>
    <button class="tb-btn icon-only" type="button" title="更多" @click="toggleMore">
      <svg class="chev" viewBox="0 0 24 24" fill="currentColor">
        <circle cx="5" cy="12" r="1.7" />
        <circle cx="12" cy="12" r="1.7" />
        <circle cx="19" cy="12" r="1.7" />
      </svg>
    </button>

                 
    <div v-if="groupOpen" class="pop group-pop">
      <button
        v-for="c in groups.chips"
        :key="c.id"
        class="gitem"
        :class="{ active: c.id === activeGroup }"
        type="button"
        @click="pickGroup(c.id)"
      >
        <svg v-if="c.id === activeGroup" class="gcheck" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
          <path d="M20 6L9 17l-5-5" />
        </svg>
        <span v-else class="gcheck"></span>
        <span v-if="renamingId !== c.id" class="gname" @dblclick.stop="c.virtual ? undefined : startRename(c.id, c.name)">{{ c.name }}</span>
        <input
          v-else
          ref="renameEl"
          v-model="renameText"
          class="grename"
          @keydown="onRenameKey"
          @blur="commitRename"
          @click.stop
        />
        <span v-if="!c.virtual && renamingId !== c.id" class="gact" title="删除分组" @click.stop="removeGroup(c.id)">✕</span>
      </button>
      <div class="gsep"></div>
      <input
        v-if="creating"
        ref="draftEl"
        v-model="draft"
        class="grename"
        style="width: calc(100% - 20px); margin: 4px 10px"
        placeholder="分组名 · 回车创建"
        spellcheck="false"
        @keydown="onDraftKey"
        @blur="commitCreate"
        @click.stop
      />
      <button v-else class="gnew" type="button" @click="startCreate">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <path d="M12 5v14M5 12h14" />
        </svg>
        新建分组
      </button>
    </div>

                 
    <div v-if="moreOpen" class="pop more-pop">
      <button class="mitem" type="button" @click="openSettings">
        <svg class="m-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.56V21a2 2 0 0 1-4 0v-.09a1.7 1.7 0 0 0-1.11-1.56 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.56-1H3a2 2 0 0 1 0-4h.09a1.7 1.7 0 0 0 1.56-1.11 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34H9a1.7 1.7 0 0 0 1-1.56V3a2 2 0 0 1 4 0v.09a1.7 1.7 0 0 0 1 1.56 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87V9a1.7 1.7 0 0 0 1.56 1H21a2 2 0 0 1 0 4h-.09a1.7 1.7 0 0 0-1.56 1z" />
        </svg>
        偏好设置
      </button>
      <button class="mitem danger" type="button" @click="quit">
        <svg class="m-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
          <path d="M16 17l5-5-5-5M21 12H9" />
        </svg>
        退出剪巢
      </button>
    </div>
  </div>
</template>
