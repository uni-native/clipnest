import type {
  BrowserStatus,
  ClipNestBridge,
  DeepPartial,
  Group,
  IntelligenceStatus,
  Layout,
  ModelDownloadResult,
  ModelStatusInfo,
  Post,
  PostPage,
  PostQuery,
  Settings,
  ThemeType,
} from '@shared/types'

   
                                      
                                   
   
const raw = (): ClipNestBridge => window.clipnest

export const bridge = raw()

export const api = {
  posts: {
    query: (q: PostQuery) => bridge.queryPosts(q),
    remove: (id: string) => bridge.removePost(id),
    update: (id: string, patch: Partial<Post>) => bridge.updatePost(id, patch),
    move: (id: string, groupId: string | null) => bridge.movePost(id, groupId),
    pin: (id: string, pinned: number) => bridge.pinPost(id, pinned),
    paste: (id: string) => bridge.pastePost(id),
    clearHistory: () => bridge.clearHistory(),
  },
  groups: {
    list: () => bridge.queryGroups(),
    create: (name?: string) => bridge.createGroup(name),
    update: (id: string, patch: Partial<Group>) => bridge.updateGroup(id, patch),
    remove: (id: string) => bridge.removeGroup(id),
    clear: (id: string) => bridge.clearGroup(id),
  },
  settings: {
    get: () => bridge.querySettings(),
    update: (patch: DeepPartial<Settings>) => bridge.updateSettings(patch),
    setShowHideHotkey: (key: string) => bridge.updateShowHideHotkey(key),
    setQuickPaste: (enable: boolean) => bridge.toggleQuickPaste(enable),
    setGroupShortcut: (which: 'previous' | 'next', key: string) =>
      bridge.toggleGroupShortcut(which, key),
  },
  window: {
    hide: () => bridge.hidePanel(),
    size: () => bridge.getPanelSize(),
    layout: (l: Layout) => bridge.updateLayout(l),
    theme: (t: ThemeType) => bridge.updateTheme(t),
    openSettings: () => bridge.openSettings(),
    minimizeSettings: () => bridge.minimizeSettings(),
    closeSettings: () => bridge.closeSettings(),
  },
  queue: {
    enqueue: () => bridge.enqueueCopy(),
    flush: () => bridge.flushQueue(),
  },
  intelligence: {
    status: (): Promise<IntelligenceStatus> => bridge.intelligenceStatus(),
    query: (keyword: string, limit?: number) => bridge.intelligenceQuery({ keyword, limit }),
    reindex: () => bridge.intelligenceReindex(),
    modelStatus: (): Promise<ModelStatusInfo> => bridge.intelligenceModelStatus(),
    downloadModel: (modelId: string): Promise<ModelDownloadResult> =>
      bridge.intelligenceModelDownload(modelId),
  },
  browser: {
    status: (): Promise<BrowserStatus> => bridge.browserStatus(),
    setConfig: (patch: DeepPartial<Settings['browser']>) => bridge.browserSetConfig(patch),
    regenerateToken: () => bridge.browserRegenerateToken(),
    ping: () => bridge.browserPing(),
  },
  common: {
    openExternal: (url: string) => bridge.openExternal(url),
    checkUpdate: () => bridge.checkUpdate(),
    dataDir: () => bridge.getDataDir(),
    quit: () => bridge.quitApp(),
    version: () => bridge.getVersion(),
    openWebManager: () => bridge.openWebManager(),
    readImage: (path: string) => bridge.readImageDataUrl(path),
  },
}
