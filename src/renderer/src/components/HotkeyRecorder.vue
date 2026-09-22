<script setup lang="ts">
import { onUnmounted, ref, watch } from 'vue'
import { toAccelerator } from '../utils/hotkey'

const props = defineProps<{ modelValue: string }>()
const emit = defineEmits<{
  (e: 'update:modelValue', v: string): void
  (e: 'record', v: string): void
}>()

const recording = ref(false)
const error = ref('')

function start(): void {
  error.value = ''
  recording.value = true
}

function stop(): void {
  recording.value = false
}

function onKey(e: KeyboardEvent): void {
  if (!recording.value) return
  e.preventDefault()
  e.stopPropagation()
  const acc = toAccelerator(e)
  if (!acc) {
    error.value = '需搭配 Ctrl / Alt / Shift 之一'
    return
  }
  recording.value = false
  error.value = ''
  emit('update:modelValue', acc)
  emit('record', acc)
}

watch(recording, (on) => {
  if (on) window.addEventListener('keydown', onKey, true)
  else window.removeEventListener('keydown', onKey, true)
})

onUnmounted(() => {
  if (recording.value) window.removeEventListener('keydown', onKey, true)
})

watch(
  () => props.modelValue,
  () => {
    error.value = ''
  },
)
</script>

<template>
  <span class="recorder">
    <button class="rec-btn" :class="{ recording }" :title="recording ? '按下组合键…' : '录制快捷键'" type="button" @click="recording ? stop() : start()">
      <svg v-if="!recording" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />
      </svg>
      <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
        <circle cx="12" cy="12" r="9" opacity="0.35" />
        <path d="M8 12h8" />
      </svg>
    </button>
    <span v-if="error" class="rec-error">{{ error }}</span>
  </span>
</template>

<style scoped>
.recorder {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.rec-btn {
  width: 30px;
  height: 30px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text-2);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: border-color 0.15s, color 0.15s, background 0.15s;
}
.rec-btn svg {
  width: 15px;
  height: 15px;
}
.rec-btn:hover {
  border-color: var(--brand);
  color: var(--brand);
}
.rec-btn.recording {
  background: var(--brand);
  border-color: var(--brand);
  color: #fff;
}
</style>
