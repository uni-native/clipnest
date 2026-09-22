<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { Post } from '@shared/types'
import type { CSSProperties } from 'vue'
import { useSettingsStore } from '../stores/settings'
import PostItem from './PostItem.vue'

const props = defineProps<{ items: Post[]; selectedId: string | null }>()
const emit = defineEmits<{
  (e: 'paste', id: string): void
  (e: 'loadMore'): void
}>()

const settings = useSettingsStore()
const isHorizontal = computed(() => settings.layout === 'horizontal')

                                  
const PAD = 12
const COL_W = 232                      
const ROW_H = 116                      
const H_TOP = 24              
const OVERSCAN = 4
const WINDOW_SIZE = 24

const scroller = ref<HTMLDivElement | null>(null)
const scrollLeft = ref(0)
const scrollTop = ref(0)
const dragging = ref(false)

interface DragState {
  pointerId: number
  startX: number
  startLeft: number
  moved: boolean
}

let dragState: DragState | null = null
let suppressClickUntil = 0

const start = computed(() => {
  const off = isHorizontal.value ? scrollLeft.value : scrollTop.value
  const stride = isHorizontal.value ? COL_W : ROW_H
  return Math.max(0, Math.floor((off - PAD) / stride) - OVERSCAN)
})
const end = computed(() => Math.min(props.items.length, start.value + WINDOW_SIZE))

const visible = computed<Array<{ post: Post; index: number; posStyle: CSSProperties }>>(() => {
  const out: Array<{ post: Post; index: number; posStyle: CSSProperties }> = []
  for (let i = start.value; i < end.value; i++) {
    const p = props.items[i]
    if (!p) continue
    const posStyle: CSSProperties = isHorizontal.value
      ? { left: `${PAD + i * COL_W}px`, top: `${H_TOP}px` }
      : { top: `${PAD + i * ROW_H}px` }
    out.push({ post: p, index: i, posStyle })
  }
  return out
})

const spacerStyle = computed<CSSProperties>(() =>
  isHorizontal.value
    ? { width: `${PAD * 2 + props.items.length * COL_W}px` }
    : { height: `${PAD * 2 + props.items.length * ROW_H}px` },
)

function onScroll(e: Event): void {
  const el = e.target as HTMLDivElement
  if (isHorizontal.value) {
    scrollLeft.value = el.scrollLeft
    if (el.scrollLeft + el.clientWidth >= el.scrollWidth - 240) emit('loadMore')
  } else {
    scrollTop.value = el.scrollTop
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 48) emit('loadMore')
  }
}

function onWheel(e: WheelEvent): void {
  if (!isHorizontal.value) return
  const el = scroller.value
  if (!el) return
  const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY
  if (delta === 0) return
  const next = Math.max(0, Math.min(el.scrollWidth - el.clientWidth, el.scrollLeft + delta))
  if (next === el.scrollLeft) return
  e.preventDefault()
  el.scrollLeft = next
}

function onPointerDown(e: PointerEvent): void {
  if (!isHorizontal.value || e.pointerType === 'touch' || e.button !== 0) return
  const el = scroller.value
  if (!el) return
  dragState = { pointerId: e.pointerId, startX: e.clientX, startLeft: el.scrollLeft, moved: false }
  el.setPointerCapture(e.pointerId)
}

function onPointerMove(e: PointerEvent): void {
  const drag = dragState
  const el = scroller.value
  if (!drag || !el || drag.pointerId !== e.pointerId) return
  const delta = e.clientX - drag.startX
  if (!drag.moved && Math.abs(delta) < 5) return
  drag.moved = true
  dragging.value = true
  el.scrollLeft = drag.startLeft - delta
  e.preventDefault()
}

function finishDrag(e: PointerEvent): void {
  const drag = dragState
  const el = scroller.value
  if (!drag || !el || drag.pointerId !== e.pointerId) return
  if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
  if (drag.moved) suppressClickUntil = performance.now() + 250
  dragState = null
  dragging.value = false
}

function onClickCapture(e: MouseEvent): void {
  if (performance.now() >= suppressClickUntil) return
  e.preventDefault()
  e.stopPropagation()
}

function resetScroll(): void {
  scrollLeft.value = 0
  scrollTop.value = 0
  if (scroller.value) {
    scroller.value.scrollLeft = 0
    scroller.value.scrollTop = 0
  }
}

                      
watch(
  () => props.selectedId,
  (id) => {
    if (!id) return
    const idx = props.items.findIndex((p) => p.id === id)
    if (idx < 0) return
    const el = scroller.value
    if (!el) return
    if (isHorizontal.value) {
      const x = PAD + idx * COL_W
      if (x < el.scrollLeft || x + COL_W > el.scrollLeft + el.clientWidth) {
        el.scrollLeft = Math.max(0, x - (el.clientWidth - COL_W) / 2)
        scrollLeft.value = el.scrollLeft
      }
    } else {
      const y = PAD + idx * ROW_H
      if (y < el.scrollTop || y + ROW_H > el.scrollTop + el.clientHeight) {
        el.scrollTop = Math.max(0, y - (el.clientHeight - ROW_H) / 2)
        scrollTop.value = el.scrollTop
      }
    }
  },
)

defineExpose({ resetScroll })
</script>

<template>
  <div v-if="items.length === 0" class="post-empty">复制点什么试试吧</div>
  <div
    v-else
    ref="scroller"
    class="post-scroll"
    :class="[isHorizontal ? 'h-scroll' : 'v-scroll', { dragging }]"
    tabindex="0"
    :aria-label="isHorizontal ? '剪贴板卡片列表，可横向滚动' : '剪贴板卡片列表，可纵向滚动'"
    @scroll="onScroll"
    @wheel="onWheel"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="finishDrag"
    @pointercancel="finishDrag"
    @click.capture="onClickCapture"
  >
    <div class="post-spacer" :class="isHorizontal ? 'h-spacer' : 'v-spacer'" :style="spacerStyle">
      <PostItem
        v-for="v in visible"
        :key="v.post.id"
        :post="v.post"
        :layout="settings.layout"
        :pos-style="v.posStyle"
        :selected="v.post.id === selectedId"
        @paste="emit('paste', $event)"
      />
    </div>
  </div>
</template>
