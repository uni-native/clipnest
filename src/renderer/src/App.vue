<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue'
import { storeToRefs } from 'pinia'
import { useSettingsStore } from './stores/settings'
import { currentRoute } from './router'
import ClipboardView from './views/ClipboardView.vue'
import SettingsView from './views/SettingsView.vue'

const settings = useSettingsStore()
const { layoutClass, themeAttr } = storeToRefs(settings)

const route = currentRoute
const isSettings = computed(() => route.value === '/settings')

onMounted(() => {
  void settings.init()
  void settings.initBrowser()
  settings.watchBridge()
})

onUnmounted(() => settings.dispose())
</script>

<template>
  <div class="app" :class="[layoutClass, { 'is-settings': isSettings }]" :data-theme="themeAttr">
    <ClipboardView v-if="!isSettings" />
    <SettingsView v-else />
  </div>
</template>
