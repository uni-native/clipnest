import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { CaptureEvent, ContentType, Post, PostQuery } from '@shared/types'
import { api, bridge } from '../api/bridge'
import { playClipboardSound } from '../utils/sound'
import { useGroupsStore } from './groups'
import { useSettingsStore } from './settings'

const PAGE_SIZE = 20

export const usePostsStore = defineStore('posts', () => {
  const items = ref<Post[]>([])
  const cursor = ref<{ lastUsedAt: number; id: string } | null>(null)
  const hasMore = ref(false)
  const loading = ref(false)
  const keyword = ref('')
  const typeFilter = ref<ContentType | 'all'>('all')
  const groupId = ref<string | 'all' | 'none'>('all')
  const selectedId = ref<string | null>(null)

  const selectedIndex = computed(() => items.value.findIndex((p) => p.id === selectedId.value))
  const count = computed(() => items.value.length)

  function buildQuery(reset: boolean): PostQuery {
    const q: PostQuery = { limit: PAGE_SIZE }
    const kw = keyword.value.trim()
    if (kw) q.keyword = kw
    if (typeFilter.value !== 'all') q.type = typeFilter.value
    if (groupId.value !== 'all') q.groupId = groupId.value
    if (!reset && cursor.value) q.cursor = cursor.value
    return q
  }

                                      
  function matchesFilters(p: Post): boolean {
    if (typeFilter.value !== 'all' && p.type !== typeFilter.value) return false
    if (groupId.value === 'none' && p.groupId !== null) return false
    if (groupId.value !== 'all' && groupId.value !== 'none' && p.groupId !== groupId.value) return false
    const kw = keyword.value.trim().toLowerCase()
    if (kw && !`${p.title}\n${p.preview}`.toLowerCase().includes(kw)) return false
    return true
  }

  async function load(reset = true): Promise<void> {
    if (loading.value) return
    loading.value = true
    try {
      const page = await api.posts.query(buildQuery(reset))
      items.value = reset ? page.items : [...items.value, ...page.items]
      cursor.value = page.nextCursor
      hasMore.value = page.nextCursor !== null
      if (reset) selectedId.value = page.items.length > 0 ? page.items[0].id : null
    } catch (e) {
      console.error('[posts] query failed', e)
    } finally {
      loading.value = false
    }
  }

                       
  async function refresh(): Promise<void> {
    const keep = selectedId.value
    await load(true)
    if (keep !== null && items.value.some((p) => p.id === keep)) selectedId.value = keep
  }

  async function loadMore(): Promise<void> {
    if (!hasMore.value || loading.value) return
    await load(false)
  }

  function setKeyword(v: string): void {
    keyword.value = v
  }

  function setTypeFilter(v: ContentType | 'all'): void {
    typeFilter.value = v
  }

  function setGroupId(v: string | 'all' | 'none'): void {
    groupId.value = v
  }

  function selectByIndex(i: number): void {
    if (items.value.length === 0) {
      selectedId.value = null
      return
    }
    const n = items.value.length
    selectedId.value = items.value[((i % n) + n) % n].id
  }

  function selectNext(): void {
    selectByIndex(selectedIndex.value + 1)
  }

  function selectPrev(): void {
    selectByIndex(selectedIndex.value - 1)
  }

  async function paste(id: string): Promise<void> {
    try {
      const ok = await api.posts.paste(id)
      if (!ok) return
      void playClipboardSound('paste', useSettingsStore().settings.clipboard.sounds)
      api.window.hide()
    } catch (e) {
      console.error('[posts] paste failed', e)
    }
  }

  async function pasteSelected(): Promise<void> {
    if (selectedId.value !== null) await paste(selectedId.value)
  }

                                            
  async function pasteNth(n: number): Promise<void> {
    const p = items.value[n - 1]
    if (p) await paste(p.id)
  }

  async function remove(id: string): Promise<void> {
    try {
      const ok = await api.posts.remove(id)
      if (!ok) return
    } catch (e) {
      console.error('[posts] remove failed', e)
      return
    }
    const idx = items.value.findIndex((p) => p.id === id)
    items.value = items.value.filter((p) => p.id !== id)
    if (selectedId.value === id) {
      const next = items.value[Math.min(Math.max(idx, 0), items.value.length - 1)]
      selectedId.value = next ? next.id : null
    }
  }

  async function move(id: string, target: string | null): Promise<void> {
    try {
      const ok = await api.posts.move(id, target)
      if (!ok) return
    } catch (e) {
      console.error('[posts] move failed', e)
      return
    }
    const p = items.value.find((x) => x.id === id)
    if (!p) return
    p.groupId = target
    if (!matchesFilters(p)) items.value = items.value.filter((x) => x.id !== id)
  }

  async function togglePin(post: Post): Promise<void> {
    const next = post.pinned === 1 ? 0 : 1
    try {
      const ok = await api.posts.pin(post.id, next)
      if (!ok) return
    } catch (e) {
      console.error('[posts] pin failed', e)
      return
    }
    post.pinned = next
  }

                                    
  function moveGroupFilter(dir: -1 | 1): void {
    const ids = useGroupsStore().chips.map((c) => c.id)
    if (ids.length === 0) return
    const cur = ids.indexOf(groupId.value)
    const base = cur < 0 ? 0 : cur
    groupId.value = ids[(((base + dir) % ids.length) + ids.length) % ids.length]
  }

  function onCaptured(e: CaptureEvent): void {
    void playClipboardSound('copy', useSettingsStore().settings.clipboard.sounds)
    const incoming = e.post
    const idx = items.value.findIndex((p) => p.id === incoming.id || p.hash === incoming.hash)
    if (idx >= 0) items.value.splice(idx, 1)
    if (matchesFilters(incoming)) items.value.unshift(incoming)
    if (selectedId.value === null && items.value.length > 0) selectedId.value = items.value[0].id
  }

  function onTouched(id: string): void {
    void playClipboardSound('copy', useSettingsStore().settings.clipboard.sounds)
    const idx = items.value.findIndex((p) => p.id === id)
    if (idx <= 0) return
    const moved = items.value.splice(idx, 1)[0]
    items.value.unshift(moved)
  }

  function onRemoved(ids: string[]): void {
    const dead = new Set(ids)
    items.value = items.value.filter((p) => !dead.has(p.id))
    if (selectedId.value !== null && dead.has(selectedId.value)) {
      selectedId.value = items.value.length > 0 ? items.value[0].id : null
    }
  }

  let offs: Array<() => void> = []
  function subscribeEvents(): void {
    unsubscribeEvents()
    offs = [
      bridge.onPostCaptured(onCaptured),
      bridge.onPostTouched(onTouched),
      bridge.onPostsRemoved(onRemoved),
    ]
  }

  function unsubscribeEvents(): void {
    offs.forEach((f) => f())
    offs = []
  }

  return {
    items,
    cursor,
    hasMore,
    loading,
    keyword,
    typeFilter,
    groupId,
    selectedId,
    selectedIndex,
    count,
    load,
    refresh,
    loadMore,
    setKeyword,
    setTypeFilter,
    setGroupId,
    selectNext,
    selectPrev,
    paste,
    pasteSelected,
    pasteNth,
    remove,
    move,
    togglePin,
    moveGroupFilter,
    subscribeEvents,
    unsubscribeEvents,
  }
})
