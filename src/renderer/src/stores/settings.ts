import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type {
  BrowserStatus,
  DeepPartial,
  Layout,
  Settings,
  ThemeType,
} from '@shared/types'
import { api, bridge } from '../api/bridge'

   
                                                       
                                                   
                                 
   
function fallbackSettings(): Settings {
  return {
    clipboard: {
      theme: 'system',
      layout: 'horizontal',
      sounds: { open: true, type: 1, copy: '', paste: '' },
    },
    shortcutKeys: {
      showOrHide: 'alt+v',
      quickPaste: 'ctrl',
      quickPasteEnable: true,
      previousGroup: 'ctrl+[',
      nextGroup: 'ctrl+]',
    },
    general: {
      autoOpen: true,
      minTray: true,
      menuIcon: true,
      historyCache: 'infinity',
      launchAtLogin: true,
    },
    intelligence: {
      tier: 'rule',
      model: 'bge-small-zh-v1.5',
      autoGroup: true,
      semanticSearch: false,
      smartPasteMatch: false,
      models: [],
      activeModelId: '',
    },
    browser: {
      enabled: true,
      port: 9377,
      token: '',
      autoFill: true,
    },
    webManager: {
      enabled: true,
      port: 9378,
    },
    jev: {
      enabled: true,
      mode: 'rule',
      threshold: 0.6,
      modelPath: '',
    },
    qwen: {
      enabled: false,
      modelPath: '',
    },
    width: 0,
    height: 0,
  }
}

export const useSettingsStore = defineStore('settings', () => {
  const settings = ref<Settings>(fallbackSettings())
  const ready = ref(false)
  const browserStatus = ref<BrowserStatus | null>(null)

  const theme = computed<ThemeType>(() => settings.value.clipboard.theme)
  const resolvedTheme = computed<'light' | 'dark'>(() => {
    if (theme.value !== 'system') return theme.value
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  })
  const layout = computed<Layout>(() => settings.value.clipboard.layout)
  const layoutClass = computed(() => `layout-${layout.value}`)
  const themeAttr = computed(() => resolvedTheme.value)

  let media: MediaQueryList | null = null
  let offSettings: (() => void) | null = null
  let offBrowser: (() => void) | null = null

  function applyDom(): void {
    document.documentElement.dataset.theme = resolvedTheme.value
  }

  async function init(): Promise<void> {
    applyDom()
    try {
      settings.value = await api.settings.get()
      ready.value = true
    } catch (e) {
      console.error('[settings] querySettings failed', e)
    }
    applyDom()
    if (!media) {
      media = window.matchMedia('(prefers-color-scheme: dark)')
      media.addEventListener('change', applyDom)
    }
  }

                             
  function watchBridge(): void {
    offSettings?.()
    offSettings = bridge.onSettingsChanged((s: Settings) => {
      settings.value = s
      applyDom()
    })
  }

                                            
  async function initBrowser(): Promise<void> {
    try {
      browserStatus.value = await api.browser.status()
    } catch (e) {
      console.error('[settings] browser status failed', e)
    }
    offBrowser?.()
    offBrowser = bridge.onBrowserStatus((s: BrowserStatus) => {
      browserStatus.value = s
    })
  }

                                          
  function applyLayoutFromMain(l: Layout): void {
    if (settings.value.clipboard.layout !== l) settings.value.clipboard.layout = l
  }

  async function update(patch: DeepPartial<Settings>): Promise<Settings | null> {
    try {
      const next = await api.settings.update(patch)
      settings.value = next
      applyDom()
      return next
    } catch (e) {
      console.error('[settings] update failed', e)
      return null
    }
  }

  function dispose(): void {
    offSettings?.()
    offSettings = null
    offBrowser?.()
    offBrowser = null
    media?.removeEventListener('change', applyDom)
    media = null
  }

  return {
    settings,
    ready,
    browserStatus,
    theme,
    resolvedTheme,
    layout,
    layoutClass,
    themeAttr,
    init,
    update,
    watchBridge,
    initBrowser,
    applyLayoutFromMain,
    dispose,
  }
})
