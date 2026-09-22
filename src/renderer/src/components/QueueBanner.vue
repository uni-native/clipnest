<script setup lang="ts">
defineProps<{ count: number }>()
const emit = defineEmits<{
  (e: 'flush'): void
  (e: 'cancel'): void
}>()
</script>

<template>
  <div v-if="count > 0" class="queue-banner">
    <span class="queue-text">已收集 {{ count }} 条 · 回车依次粘贴 · Esc 取消</span>
    <span class="queue-acts">
      <button class="qbtn" @click="emit('flush')">粘贴</button>
      <button class="qbtn ghost" @click="emit('cancel')">取消</button>
    </span>
  </div>
</template>
