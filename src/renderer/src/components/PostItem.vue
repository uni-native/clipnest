<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import type { CSSProperties } from 'vue'
import type { ContentType, Layout, Post } from '@shared/types'
import { usePostsStore } from '../stores/posts'
import { useGroupsStore } from '../stores/groups'
import { api } from '../api/bridge'
import { formatRelative, formatSize } from '../utils/format'

const props = defineProps<{
  post: Post
  layout: Layout
  posStyle: CSSProperties
  selected: boolean
}>()
const emit = defineEmits<{ (e: 'paste', id: string): void }>()

const posts = usePostsStore()
const groups = useGroupsStore()

const TYPE_LABEL: Record<ContentType, string> = {
  text: '文本',
  link: '链接',
  image: '图片',
  file: '文件',
  folder: '文件夹',
}

const isImage = computed(() => props.post.type === 'image')
const typeLabel = computed(() => TYPE_LABEL[props.post.type])

                                 
const sizeText = computed(() => {
  if (props.post.type === 'text' || props.post.type === 'link') {
    return `${Math.max(1, props.post.preview.length)}个字符`
  }
  return formatSize(props.post.size)
})

const previewText = computed(() => props.post.preview || props.post.title || '（无内容）')
const relTime = computed(() => formatRelative(props.post.lastUsedAt))
const sourceName = computed(() => props.post.sourceApp || '未知来源')

                        
const imgSrc = ref('')
let imgToken = 0
watch(
  () => [props.post.id, props.post.contentPath, props.post.type] as const,
  async () => {
    const token = ++imgToken
    if (props.post.type !== 'image' || !props.post.contentPath) {
      imgSrc.value = ''
      return
    }
    try {
      const url = await api.common.readImage(props.post.contentPath)
      if (token === imgToken) imgSrc.value = url || ''
    } catch {
      if (token === imgToken) imgSrc.value = ''
    }
  },
  { immediate: true },
)

                                                                        
const menuOpen = ref(false)
const moveOpen = ref(false)
const menuPos = ref({ x: 0, y: 0 })

const moveTargets = computed(() => [
  { id: 'none', label: '未分组', target: null as string | null },
  ...groups.groups.map((g) => ({ id: g.id, label: g.name, target: g.id as string | null })),
])

function onContextmenu(e: MouseEvent): void {
  e.preventDefault()
  menuPos.value = { x: e.clientX, y: e.clientY }
  moveOpen.value = false
  menuOpen.value = true
}

function onDocMouseDown(e: MouseEvent): void {
  if (!menuOpen.value) return
  const t = e.target as HTMLElement | null
  if (t && t.closest('.ctx-menu')) return
  menuOpen.value = false
}

watch(menuOpen, (open) => {
  if (open) document.addEventListener('mousedown', onDocMouseDown)
  else document.removeEventListener('mousedown', onDocMouseDown)
})

onUnmounted(() => document.removeEventListener('mousedown', onDocMouseDown))

async function moveTo(target: string | null): Promise<void> {
  menuOpen.value = false
  await posts.move(props.post.id, target)
}

async function removePost(): Promise<void> {
  menuOpen.value = false
  await posts.remove(props.post.id)
}

async function togglePin(): Promise<void> {
  menuOpen.value = false
  await posts.togglePin(props.post)
}
</script>

<template>
  <div
    class="pcard"
    :class="{ selected, 'is-image': isImage }"
    :style="posStyle"
    @click="emit('paste', post.id)"
    @contextmenu="onContextmenu"
  >
                                        
    <template v-if="layout === 'horizontal'">
      <div class="pc-head">
        <span class="pc-type">{{ typeLabel }}</span>
        <span class="pc-size">{{ sizeText }}</span>
      </div>
      <img v-if="isImage && imgSrc" class="pc-thumb" :src="imgSrc" alt="" draggable="false" />
      <div v-else class="pc-preview">{{ previewText }}</div>
      <div class="pc-foot">
        <span class="app-ico">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="5" y="4" width="14" height="17" rx="2.5" />
            <path d="M9 10h6M9 14h4" />
          </svg>
        </span>
        <span class="pc-src">{{ sourceName }}</span>
        <span class="pc-time">{{ relTime }}</span>
      </div>
    </template>

                              
    <template v-else>
      <img v-if="isImage && imgSrc" class="pc-thumb" :src="imgSrc" alt="" draggable="false" />
      <div class="pc-main">
        <div class="pc-head">
          <span class="pc-type">{{ typeLabel }}</span>
          <span class="pc-size">{{ sizeText }}</span>
        </div>
        <div v-if="!isImage" class="pc-preview">{{ previewText }}</div>
        <div class="pc-foot">
          <span class="app-ico">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="5" y="4" width="14" height="17" rx="2.5" />
              <path d="M9 10h6M9 14h4" />
            </svg>
          </span>
          <span class="pc-src">{{ sourceName }}</span>
          <span class="pc-time">{{ relTime }}</span>
        </div>
      </div>
    </template>

    <div v-if="menuOpen" class="ctx-menu" :style="{ left: `${menuPos.x}px`, top: `${menuPos.y}px` }">
      <button class="ctx-item" @click.stop="togglePin">{{ post.pinned === 1 ? '取消收藏' : '收藏' }}</button>
      <button class="ctx-item" @click.stop="moveOpen = !moveOpen">
        移动到分组{{ moveOpen ? ' ▴' : ' ▸' }}
      </button>
      <div v-if="moveOpen" class="ctx-sub">
        <button v-for="t in moveTargets" :key="t.id" class="ctx-item" @click.stop="moveTo(t.target)">
          {{ t.label }}
        </button>
      </div>
      <button class="ctx-item danger" @click.stop="removePost">删除</button>
    </div>
  </div>
</template>
