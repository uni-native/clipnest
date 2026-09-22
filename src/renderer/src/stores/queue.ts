import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { api } from '../api/bridge'
import { playClipboardSound } from '../utils/sound'
import { useSettingsStore } from './settings'

   
                                   
                                        
   
export const useQueueStore = defineStore('queue', () => {
  const length = ref(0)
  const active = computed(() => length.value > 0)

  async function enqueue(): Promise<void> {
    try {
      length.value = await api.queue.enqueue()
    } catch (e) {
      console.error('[queue] enqueue failed', e)
      length.value = 0
    }
  }

  async function flush(): Promise<void> {
    try {
      const ok = await api.queue.flush()
      if (ok) void playClipboardSound('paste', useSettingsStore().settings.clipboard.sounds)
    } catch (e) {
      console.error('[queue] flush failed', e)
    } finally {
      length.value = 0
    }
  }

  function reset(): void {
    length.value = 0
  }

  return { length, active, enqueue, flush, reset }
})
