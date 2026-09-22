<script setup lang="ts">
import type { ContentType } from '@shared/types'

defineProps<{ type: ContentType }>()

const MAP: Record<ContentType, { icon: string; cls: string; label: string }> = {
  text: { icon: '📝', cls: 't-text', label: '文本' },
  link: { icon: '🔗', cls: 't-link', label: '链接' },
  image: { icon: '🖼️', cls: 't-image', label: '图片' },
  file: { icon: '📄', cls: 't-file', label: '文件' },
  folder: { icon: '📁', cls: 't-folder', label: '文件夹' },
}
</script>

<template>
  <span class="type-icon" :class="MAP[type].cls" :title="MAP[type].label">{{ MAP[type].icon }}</span>
</template>
