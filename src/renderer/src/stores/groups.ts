import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { Group } from '@shared/types'
import { api } from '../api/bridge'

                              
export interface GroupChip {
  id: string
  name: string
  virtual: boolean
}

export const useGroupsStore = defineStore('groups', () => {
  const groups = ref<Group[]>([])
  const loaded = ref(false)

  const chips = computed<GroupChip[]>(() => [
    { id: 'all', name: '全部', virtual: true },
    { id: 'none', name: '未分组', virtual: true },
    ...groups.value.map((g) => ({ id: g.id, name: g.name, virtual: false })),
  ])

  async function load(): Promise<void> {
    try {
      groups.value = await api.groups.list()
      loaded.value = true
    } catch (e) {
      console.error('[groups] list failed', e)
    }
  }

  async function create(name?: string): Promise<Group | null> {
    try {
      const g = await api.groups.create(name)
      groups.value.push(g)
      return g
    } catch (e) {
      console.error('[groups] create failed', e)
      return null
    }
  }

  async function rename(id: string, name: string): Promise<boolean> {
    try {
      const ok = await api.groups.update(id, { name })
      if (!ok) return false
      const g = groups.value.find((x) => x.id === id)
      if (g) g.name = name
      return true
    } catch (e) {
      console.error('[groups] rename failed', e)
      return false
    }
  }

  async function remove(id: string): Promise<boolean> {
    try {
      const ok = await api.groups.remove(id)
      if (!ok) return false
      groups.value = groups.value.filter((g) => g.id !== id)
      return true
    } catch (e) {
      console.error('[groups] remove failed', e)
      return false
    }
  }

  async function clear(id: string): Promise<boolean> {
    try {
      return await api.groups.clear(id)
    } catch (e) {
      console.error('[groups] clear failed', e)
      return false
    }
  }

  return { groups, loaded, chips, load, create, rename, remove, clear }
})
