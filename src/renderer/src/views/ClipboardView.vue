<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { usePostsStore } from '../stores/posts'
import { useGroupsStore } from '../stores/groups'
import { useSettingsStore } from '../stores/settings'
import { useQueueStore } from '../stores/queue'
import { api, bridge } from '../api/bridge'
import SearchBar from '../components/SearchBar.vue'
import PostList from '../components/PostList.vue'
import QueueBanner from '../components/QueueBanner.vue'

const posts = usePostsStore()
const groups = useGroupsStore()
const settings = useSettingsStore()
const queue = useQueueStore()

const { keyword, groupId, typeFilter, selectedId, items } = storeToRefs(posts)

const rootRef = ref<HTMLDivElement | null>(null)
const listRef = ref<InstanceType<typeof PostList> | null>(null)

                         
watch([keyword, groupId, typeFilter], () => {
  void posts.refresh()
  listRef.value?.resetScroll()
})

function playEnter(): void {
  const el = rootRef.value
  if (!el) return
  el.classList.remove('panel-enter')
  void el.offsetWidth
  el.classList.add('panel-enter')
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.preventDefault()
    if (queue.length > 0) {
      queue.reset()
      return
    }
    api.window.hide()
    return
  }
  const t = e.target as HTMLElement | null
  const typing =
    !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable === true)
  if (typing) return
                                    
  if (e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === 'c') {
    e.preventDefault()
    void queue.enqueue()
    return
  }
  if (e.key === 'ArrowDown' || (settings.layout === 'horizontal' && e.key === 'ArrowRight')) {
    e.preventDefault()
    posts.selectNext()
  } else if (e.key === 'ArrowUp' || (settings.layout === 'horizontal' && e.key === 'ArrowLeft')) {
    e.preventDefault()
    posts.selectPrev()
  } else if (e.key === 'Enter') {
    e.preventDefault()
    if (queue.length > 0) void queue.flush()
    else void posts.pasteSelected()
  }
}

let offs: Array<() => void> = []

onMounted(() => {
  void groups.load()
  void posts.refresh()
  posts.subscribeEvents()
  window.addEventListener('keydown', onKeydown)
  offs = [
    bridge.onShow((layout) => {
      settings.applyLayoutFromMain(layout)
      playEnter()
      void posts.refresh()
      listRef.value?.resetScroll()
    }),
    bridge.onHide(() => {
      queue.reset()
    }),
    bridge.onHotKey((n) => {
      void posts.pasteNth(n)
    }),
    bridge.onMoveGroup((dir) => {
      posts.moveGroupFilter(dir)
    }),
  ]
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
  posts.unsubscribeEvents()
  offs.forEach((f) => f())
  offs = []
})

function onPaste(id: string): void {
  void posts.paste(id)
}

function onLoadMore(): void {
  void posts.loadMore()
}

async function onQueueFlush(): Promise<void> {
  await queue.flush()
  api.window.hide()
}
</script>

<template>
  <div ref="rootRef" class="clipboard" :class="settings.layoutClass">
    <SearchBar
      :model-value="keyword"
      :active-group="groupId"
      @update:model-value="posts.setKeyword($event)"
      @search="posts.setKeyword($event)"
      @group-change="posts.setGroupId($event)"
    />
    <QueueBanner :count="queue.length" @flush="onQueueFlush" @cancel="queue.reset()" />
    <div class="list-wrap">
      <PostList
        ref="listRef"
        :items="items"
        :selected-id="selectedId"
        @paste="onPaste"
        @load-more="onLoadMore"
      />
    </div>
  </div>
</template>
