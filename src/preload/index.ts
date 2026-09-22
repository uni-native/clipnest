import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '@shared/types'
import type {
  BrowserStatus,
  ClipNestBridge,
  DeepPartial,
  Group,
  IntelligenceStatus,
  Layout,
  ModelDownloadInfo,
  ModelDownloadResult,
  ModelStatusInfo,
  Post,
  PostPage,
  PostQuery,
  Settings,
  ThemeType,
} from '@shared/types'

function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  return ipcRenderer.invoke(channel, ...args) as Promise<T>
}

function subscribe(channel: string, cb: (...args: any[]) => void): () => void {
  const listener = (_e: unknown, ...args: unknown[]) => cb(...args)
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.off(channel, listener)
  }
}

const bridge: ClipNestBridge = {
             
  queryPosts: (q: PostQuery) => invoke<PostPage>(IPC.queryPosts, q),
  removePost: (id: string) => invoke<boolean>(IPC.removePost, id),
  updatePost: (id: string, patch: Partial<Post>) => invoke<boolean>(IPC.updatePost, id, patch),
  movePost: (id: string, groupId: string | null) => invoke<boolean>(IPC.movePost, id, groupId),
  pinPost: (id: string, pinned: number) => invoke<boolean>(IPC.pinPost, id, pinned),
  pastePost: (id: string) => invoke<boolean>(IPC.pastePost, id),
  clearHistory: () => invoke<boolean>(IPC.clearHistory),

              
  queryGroups: () => invoke<Group[]>(IPC.queryGroups),
  createGroup: (name?: string) => invoke<Group>(IPC.createGroup, name),
  updateGroup: (id: string, patch: Partial<Group>) => invoke<boolean>(IPC.updateGroup, id, patch),
  removeGroup: (id: string) => invoke<boolean>(IPC.removeGroup, id),
  clearGroup: (id: string) => invoke<boolean>(IPC.clearGroup, id),

                
  querySettings: () => invoke<Settings>(IPC.querySettings),
  updateSettings: (patch: DeepPartial<Settings>) => invoke<Settings>(IPC.updateSettings, patch),
  updateShowHideHotkey: (key: string) => invoke<boolean>(IPC.updateShowHideHotkey, key),
  toggleQuickPaste: (enable: boolean) => invoke<boolean>(IPC.toggleQuickPaste, enable),
  toggleGroupShortcut: (which: 'previous' | 'next', key: string) =>
    invoke<boolean>(IPC.toggleGroupShortcut, which, key),

              
  hidePanel: () => ipcRenderer.invoke(IPC.hidePanel),
  getPanelSize: () => invoke<{ width: number; height: number; layout: Layout }>(IPC.getPanelSize),
  updateLayout: (layout: Layout) => invoke<{ layout: Layout }>(IPC.updateLayout, layout),
  updateTheme: (theme: ThemeType) => invoke<string>(IPC.updateTheme, theme),
                                 
  openSettings: () => invoke<void>(IPC.openSettings),
  minimizeSettings: () => ipcRenderer.send(IPC.settingsMinimize),
  closeSettings: () => ipcRenderer.send(IPC.settingsClose),

                   
  enqueueCopy: () => invoke<number>(IPC.enqueueCopy),
  flushQueue: () => invoke<boolean>(IPC.flushQueue),

                    
  intelligenceStatus: () => invoke<IntelligenceStatus>(IPC.intelligenceStatus),
  intelligenceQuery: (q: { keyword: string; limit?: number }) =>
    invoke<string[]>(IPC.intelligenceQuery, q),
  intelligenceReindex: () => invoke<number>(IPC.intelligenceReindex),
  intelligenceModelStatus: () => invoke<ModelStatusInfo>(IPC.intelligenceModelStatus),
  intelligenceModelDownload: (modelId: string) =>
    invoke<ModelDownloadResult>(IPC.intelligenceModelDownload, modelId),

              
  openExternal: (url: string) => invoke<void>(IPC.openExternal, url),
  checkUpdate: () => invoke<boolean>(IPC.checkUpdate),
  getDataDir: () => invoke<string>(IPC.getDataDir),
  quitApp: () => ipcRenderer.send(IPC.quitApp),
  getVersion: () => invoke<string>(IPC.getVersion),
  openWebManager: () => invoke<boolean>(IPC.openWebManager),
  readImageDataUrl: (path: string) => invoke<string | null>(IPC.readImageDataUrl, path),

                      
  browserStatus: () => invoke<BrowserStatus>(IPC.browserStatus),
  browserSetConfig: (patch: DeepPartial<Settings['browser']>) =>
    invoke<BrowserStatus>(IPC.browserSetConfig, patch),
  browserRegenerateToken: () => invoke<string>(IPC.browserRegenerateToken),
  browserPing: () => invoke<boolean>(IPC.browserPing),

              
  onPostCaptured: cb =>
    subscribe(IPC.evtPostCaptured, (e: Parameters<typeof cb>[0]) => cb(e)),
  onPostTouched: cb => subscribe(IPC.evtPostTouched, (id: string) => cb(id)),
  onPostsRemoved: cb => subscribe(IPC.evtPostsRemoved, (ids: string[]) => cb(ids)),
  onSettingsChanged: cb => subscribe(IPC.evtSettingsChanged, (s: Settings) => cb(s)),
  onShow: cb => subscribe(IPC.evtShow, (layout: Layout) => cb(layout)),
  onHide: cb => subscribe(IPC.evtHide, () => cb()),
  onHotKey: cb => subscribe(IPC.evtHotKey, (n: number) => cb(n)),
  onMoveGroup: cb => subscribe(IPC.evtMoveGroup, (dir: -1 | 1) => cb(dir)),
  onIntelligenceStatus: cb =>
    subscribe(IPC.evtIntelligenceStatus, (s: IntelligenceStatus) => cb(s)),
  onModelDownload: cb =>
    subscribe(IPC.evtModelDownload, (s: ModelDownloadInfo) => cb(s)),
  onBrowserStatus: cb => subscribe(IPC.evtBrowserStatus, (s: BrowserStatus) => cb(s)),
}

contextBridge.exposeInMainWorld('clipnest', bridge)
