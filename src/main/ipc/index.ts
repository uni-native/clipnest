import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DEFAULT_SETTINGS, IPC } from '@shared/types'
import type {
  BrowserStatus,
  ClipStore,
  DeepPartial,
  Group,
  IntelligenceStatus,
  ModelStatusInfo,
  ModelState,
  Post,
  PostQuery,
  Settings,
} from '@shared/types'
import { createPasteEngine, type PasteEngine } from '@main/paste'
import {
  bindBridgeDeps,
  getBrowserStatus,
  pingClient,
  regenerateToken,
  setBridgeConfig,
} from '@main/bridge/server'
import { createJevPipeline } from '@main/intelligence/jev'
import { createHub, type IntelligenceHub } from '@main/intelligence/hub'
import { bindModelsRoot, getDecisionBackend } from '@main/intelligence/onnx'
import { createModelDownloader } from '@main/intelligence/model-download'
import { openSettingsWindow, minimizeSettingsWindow, closeSettingsWindow } from '@main/windows/settings'
import { applyRetention } from '@main/core/retention'
import { applyLaunchAtLogin } from '@main/core/launch'
import { checkForUpdate } from '@main/core/updater'
import { imagesDir, modelsDir, userDataDir } from '@main/core/paths'
import {
  setGroupShortcut,
  setQuickPaste,
  setShowOrHideHotkey,
} from '@main/core/shortcuts'
import { hidePanel, panelSize, setLayout, setTheme } from '@main/windows/panel'
import { configureWebManager, openWebManager } from '@main/web/manager'

export interface IpcDeps {
  store: ClipStore
  panel: BrowserWindow
  paste: PasteEngine
  hub: IntelligenceHub
}

export function registerIpcHandlers(deps: IpcDeps): void {
  const { store, panel, paste, hub } = deps

                                                  
  bindModelsRoot(modelsDir)
  const modelMgr = getDecisionBackend()
  const downloader = createModelDownloader(modelsDir, info => {
    for (const w of BrowserWindow.getAllWindows()) {
      if (w.isDestroyed()) continue
      try {
        w.webContents.send(IPC.evtModelDownload, info)
      } catch (e) {
        console.error('[ipc] broadcast model download failed', e)
      }
    }
  })

                                          
  function ensureDownloadableDefaults(): Settings {
    const settings = store.getSettings()
    const legacyRepos = new Set([
      'com-kotobalabs/open-jev-deberta-v3-large',
      'convaiinnovations/laya',
    ])
    const kept = settings.intelligence.models.filter(model => !legacyRepos.has(model.repo))
    const additions = DEFAULT_SETTINGS.intelligence.models.filter(
      model => !kept.some(existing => existing.id === model.id),
    )
    if (kept.length === settings.intelligence.models.length && additions.length === 0) return settings
    const activeModelId = kept.some(model => model.id === settings.intelligence.activeModelId)
      ? settings.intelligence.activeModelId
      : ''
    return store.saveSettings({
      intelligence: { models: [...kept, ...additions], activeModelId },
    })
  }

  ensureDownloadableDefaults()

                                                        
  bindBridgeDeps({ store, panel, jev: createJevPipeline(store, hub, modelMgr) })

                                                  
  function modelStatus(settings: Settings): ModelStatusInfo {
    const activeId = settings.intelligence.activeModelId
    const activeState: ModelState =
      activeId && settings.intelligence.models.some(m => m.id === activeId && m.enabled)
        ? modelMgr.status()
        : 'unloaded'
    return {
      activeId,
      models: settings.intelligence.models.map(m => ({
        id: m.id,
        name: m.name,
        state: m.id === activeId ? activeState : 'unloaded',
        download: downloader.info(m.downloadId ?? m.id),
      })),
    }
  }

                                                         
  function broadcastModelStatus(settings: Settings): void {
    const payload: IntelligenceStatus = {
      ...hub.status(),
      activeModelId: settings.intelligence.activeModelId,
      models: modelStatus(settings).models,
    }
    for (const w of BrowserWindow.getAllWindows()) {
      if (w.isDestroyed()) continue
      try {
        w.webContents.send(IPC.evtIntelligenceStatus, payload)
      } catch (e) {
        console.error('[ipc] broadcast model status failed', e)
      }
    }
  }

                                                      
  async function applyActiveModel(settings: Settings): Promise<void> {
    const active = settings.intelligence.models.find(
      m => m.id === settings.intelligence.activeModelId,
    )
    try {
      if (active && active.enabled) await modelMgr.load(active)
      else if (modelMgr.status() !== 'unloaded') await modelMgr.unload()
    } catch (e) {
      console.error('[ipc] applyActiveModel failed', e)
    }
    broadcastModelStatus(settings)
  }

                                                                           
  ipcMain.handle(IPC.queryPosts, (_e, q: PostQuery) => store.queryPosts(q ?? {}))
  ipcMain.handle(IPC.removePost, (_e, id: string) => {
    store.removePost(id)
    return true
  })
  ipcMain.handle(IPC.updatePost, (_e, id: string, patch: Partial<Post>) => {
    store.updatePost(id, patch)
    return true
  })
  ipcMain.handle(IPC.movePost, (_e, id: string, groupId: string | null) => {
    store.movePostsToGroup([id], groupId)
    return true
  })
  ipcMain.handle(IPC.pinPost, (_e, id: string, pinned: number) => {
    store.updatePost(id, { pinned: pinned ? 1 : 0 })
    return true
  })
  ipcMain.handle(IPC.pastePost, async (_e, id: string) => {
    const post = store.getPost(id)
    if (!post) return false
    await paste.pastePost(post)
    return true
  })
  ipcMain.handle(IPC.clearHistory, () => {
    store.clearHistory()
    return true
  })

                                                                            
  ipcMain.handle(IPC.queryGroups, () => store.listGroups())
  ipcMain.handle(IPC.createGroup, (_e, name?: string) => store.createGroup(name))
  ipcMain.handle(IPC.updateGroup, (_e, id: string, patch: Partial<Group>) => {
    store.updateGroup(id, patch)
    return true
  })
  ipcMain.handle(IPC.removeGroup, (_e, id: string) => {
    store.removeGroup(id)
    return true
  })
  ipcMain.handle(IPC.clearGroup, (_e, id: string) => {
    store.clearGroup(id)
    return true
  })

                                                                              
  ipcMain.handle(IPC.querySettings, () => store.getSettings())
  ipcMain.handle(IPC.updateSettings, (_e, patch: Record<string, unknown>) => {
    const prevSettings = store.getSettings()
    const next = store.saveSettings(patch)
    if ('webManager' in patch && next.webManager) {
      configureWebManager(store, next.webManager.enabled, next.webManager.port)
    }
    panel.webContents.send(IPC.evtSettingsChanged, next)
                             
    const general = (patch as { general?: Record<string, unknown> }).general
    if (general && 'historyCache' in general) {
      applyRetention(store, next.general.historyCache)
    }
    if (general && 'launchAtLogin' in general) {
      applyLaunchAtLogin(next.general.launchAtLogin)
    }
                                           
    hub.refresh()
    if (next.intelligence.tier !== prevSettings.intelligence.tier) {
      const st = hub.status()
      panel.webContents.send(IPC.evtIntelligenceStatus, st)
      if (next.intelligence.tier === 'embedding' && st.indexed === 0) {
        setTimeout(() => {
          const n = hub.reindex()
          console.log('[hub] 开启 L1 自动建索引:', n, '条')
          panel.webContents.send(IPC.evtIntelligenceStatus, hub.status())
        }, 200)
      }
    }
                                                    
    const prevActive = prevSettings.intelligence.models.find(
      m => m.id === prevSettings.intelligence.activeModelId,
    )
    const nextActive = next.intelligence.models.find(
      m => m.id === next.intelligence.activeModelId,
    )
    const activeChanged =
      prevSettings.intelligence.activeModelId !== next.intelligence.activeModelId ||
      JSON.stringify(prevActive ?? null) !== JSON.stringify(nextActive ?? null)
    if (activeChanged) void applyActiveModel(next)
    return next
  })
  ipcMain.handle(IPC.updateShowHideHotkey, (_e, key: string) =>
    setShowOrHideHotkey(panel, key),
  )
  ipcMain.handle(IPC.toggleQuickPaste, (_e, enable: boolean) => setQuickPaste(panel, enable))
  ipcMain.handle(IPC.toggleGroupShortcut, (_e, which: 'previous' | 'next', key: string) =>
    setGroupShortcut(panel, which, key),
  )

                                                                            
  ipcMain.handle(IPC.hidePanel, () => hidePanel(panel))
  ipcMain.handle(IPC.getPanelSize, () => panelSize(panel))
  ipcMain.handle(IPC.updateLayout, (_e, layout: 'vertical' | 'horizontal') =>
    setLayout(panel, layout),
  )
  ipcMain.handle(IPC.updateTheme, (_e, theme: string) => setTheme(panel, theme))
  ipcMain.handle(IPC.openSettings, () => { openSettingsWindow(); return true })
  ipcMain.on(IPC.settingsMinimize, () => minimizeSettingsWindow())
  ipcMain.on(IPC.settingsClose, () => closeSettingsWindow())

                                                                                 
  ipcMain.handle(IPC.enqueueCopy, () => paste.enqueueCopy())
  ipcMain.handle(IPC.flushQueue, () => paste.flushQueue())

                                                                                  
  ipcMain.handle(IPC.intelligenceStatus, (): IntelligenceStatus => hub.status())
  ipcMain.handle(IPC.intelligenceQuery, (_e, q: { keyword: string; limit?: number }) => {
    const settings = store.getSettings()
                                              
    if (settings.intelligence.tier === 'embedding' && settings.intelligence.semanticSearch) {
      const ids = hub.semanticSearch(q.keyword, q.limit ?? 20)
      if (ids && ids.length > 0) return ids
    }
    const page = store.queryPosts({ keyword: q.keyword, limit: q.limit ?? 20 })
    return page.items.map(p => p.id)
  })
  ipcMain.handle(IPC.intelligenceReindex, () => hub.reindex())
  ipcMain.handle(IPC.intelligenceModelStatus, (): ModelStatusInfo =>
    modelStatus(store.getSettings()),
  )
  ipcMain.handle(IPC.intelligenceModelDownload, async (_e, modelId: string) => {
    const settings = store.getSettings()
    const model = settings.intelligence.models.find(item => item.id === modelId)
    if (!model?.downloadId || model.downloadId !== modelId) {
      console.error('[ipc] model download rejected', modelId)
      return downloader.download('')
    }
    const result = await downloader.download(model.downloadId)
    if (result.ok && settings.intelligence.activeModelId === model.id) {
      await applyActiveModel(store.getSettings())
    } else {
      broadcastModelStatus(store.getSettings())
    }
    return result
  })

                                      
  void applyActiveModel(store.getSettings())

                                                                            
  ipcMain.handle(IPC.openExternal, async (_e, url: string) => {
    if (/^https?:\/\//i.test(url)) await shell.openExternal(url)
  })
  ipcMain.handle(IPC.checkUpdate, () => {
    checkForUpdate()
    return true
  })
  ipcMain.handle(IPC.getDataDir, () => userDataDir)
  ipcMain.handle(IPC.getVersion, () => app.getVersion())
  ipcMain.handle(IPC.openWebManager, async () => openWebManager())
  ipcMain.handle(IPC.readImageDataUrl, (_e, path: string) => {
                                     
    try {
      const resolved = resolve(path)
      const root = resolve(imagesDir)
      if (!resolved.startsWith(root)) return null
      const buf = readFileSync(resolved)
      return `data:image/png;base64,${buf.toString('base64')}`
    } catch {
      return null
    }
  })
  ipcMain.on(IPC.quitApp, () => app.quit())

                                                                                    
  const FALLBACK_STATUS: BrowserStatus = {
    connected: false,
    port: 9377,
    token: '',
    autoFill: true,
    enabled: false,
    client: null,
  }
  ipcMain.handle(IPC.browserStatus, (): BrowserStatus => {
    try {
      return getBrowserStatus()
    } catch (e) {
      console.error('[ipc] browserStatus failed', e)
      return FALLBACK_STATUS
    }
  })
  ipcMain.handle(
    IPC.browserSetConfig,
    (_e, patch: DeepPartial<Settings['browser']>): BrowserStatus => {
      try {
        return setBridgeConfig(patch ?? {})
      } catch (e) {
        console.error('[ipc] browserSetConfig failed', e)
        return FALLBACK_STATUS
      }
    },
  )
  ipcMain.handle(IPC.browserRegenerateToken, (): string => {
    try {
      return regenerateToken()
    } catch (e) {
      console.error('[ipc] browserRegenerateToken failed', e)
      return ''
    }
  })
  ipcMain.handle(IPC.browserPing, (): Promise<boolean> => {
    try {
      return pingClient()
    } catch (e) {
      console.error('[ipc] browserPing failed', e)
      return Promise.resolve(false)
    }
  })
}
