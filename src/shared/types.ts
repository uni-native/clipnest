   
                                    
                        
   

                                                                                

export type ContentType = 'text' | 'image' | 'link' | 'file' | 'folder'
export type Layout = 'vertical' | 'horizontal'
export type ThemeType = 'dark' | 'light' | 'system'
export type IntelligenceTier = 'rule' | 'embedding' | 'jev'

                                                                                

                   
export type ModelState = 'unloaded' | 'loading' | 'ready' | 'failed'
export type ModelDownloadState = 'not-downloaded' | 'downloading' | 'downloaded' | 'failed'

               
export interface ModelConfig {
                      
  id: string
            
  name: string
  kind: 'decision' | 'embedding' | 'llm'
  backend: 'builtin' | 'onnx'
                                
  task?: 'text-classification' | 'feature-extraction'
                    
  dtype?: 'q8'
                                  
  downloadId?: string
                       
  sizeBytes?: number
                 
  repo: string
                                   
  path: string
  enabled: boolean
                 
  note: string
}

                               
export interface ModelStatusInfo {
  activeId: string
  models: Array<{
    id: string
    name: string
    state: ModelState
    download: ModelDownloadInfo
  }>
}

export interface ModelDownloadInfo {
  modelId: string
  state: ModelDownloadState
  receivedBytes: number
  totalBytes: number
  error?: string
}

export interface ModelDownloadResult {
  ok: boolean
  info: ModelDownloadInfo
}

                                                                                

export interface Post {
  id: string
                                  
  hash: string
  type: ContentType
  title: string
                             
  preview: string
                                    
  contentPath: string | null
  size: number
                  
  sourceApp: string
  groupId: string | null
  tags: string[]
  pinned: number
                 
  createdAt: number
                          
  lastUsedAt: number
  useCount: number
}

                        
export interface NewPost {
  hash: string
  type: ContentType
  title: string
  preview: string
  contentPath: string | null
  size: number
  sourceApp: string
  groupId: string | null
  tags?: string[]
}

export interface Group {
  id: string
  name: string
  kind: 'auto' | 'manual' | 'rule'
  parentId: string | null
  sorted: number
  createdAt: number
}

export interface RuleMatcher {
  app?: string
  domain?: string
  ext?: string[]
  regex?: string
  maxSize?: number
  timeWindow?: [string, string]
}

export interface RuleAction {
  groupId: string
                                 
  ttl?: number
}

export interface Rule {
  id: string
  priority: number
  enabled: number
  matcher: RuleMatcher
  action: RuleAction
}

export interface PostQuery {
  keyword?: string
  type?: ContentType | 'all'
                                  
  groupId?: string | 'all' | 'none'
  pinned?: 0 | 1
                                            
  cursor?: { lastUsedAt: number; id: string } | null
  limit?: number
}

export interface PostPage {
  items: Post[]
  nextCursor: { lastUsedAt: number; id: string } | null
}

export interface CaptureEvent {
  post: Post
  reason: 'created' | 'touched'
}

export type ClipboardActivityKind = 'copy' | 'paste'

export interface ClipboardActivity {
  id: number
  post: Post
  kind: ClipboardActivityKind
  occurredAt: number
  sourceApp: string
                              
  precise: boolean
}

                                                                              

export interface Settings {
  clipboard: {
    theme: ThemeType
    layout: Layout
    sounds: { open: boolean; type: number; copy: string; paste: string }
  }
  shortcutKeys: {
    showOrHide: string
    quickPaste: string
    quickPasteEnable: boolean
    previousGroup: string
    nextGroup: string
  }
  general: {
    autoOpen: boolean
    minTray: boolean
    menuIcon: boolean
    historyCache: string
    launchAtLogin: boolean
  }
  intelligence: {
    tier: IntelligenceTier
    model: string
    autoGroup: boolean
    semanticSearch: boolean
    smartPasteMatch: boolean
                  
    models: ModelConfig[]
                                             
    activeModelId: string
  }
                                          
  browser: {
    enabled: boolean
    port: number
    token: string
    autoFill: boolean
  }
                               
  webManager: {
    enabled: boolean
    port: number
  }
                        
  jev: {
    enabled: boolean
    mode: 'rule' | 'model'
    threshold: number
    modelPath: string
  }
                               
  qwen: {
    enabled: boolean
    modelPath: string
  }
  width: number
  height: number
}

export const DEFAULT_SETTINGS: Settings = {
  clipboard: {
    theme: 'light',
    layout: 'horizontal',
    sounds: { open: true, type: 0, copy: '', paste: '' },
  },
  shortcutKeys: {
    showOrHide: process.platform === 'darwin' ? 'command+`' : 'alt+v',
    quickPaste: process.platform === 'darwin' ? 'command' : 'ctrl',
    quickPasteEnable: true,
    previousGroup: 'ctrl+[',
    nextGroup: 'ctrl+]',
  },
  general: {
    autoOpen: true,
    minTray: false,
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
                           
    models: [
      {
        id: 'bge-small-zh-q8',
        name: 'BGE Small 中文轻量版',
        kind: 'decision',
        backend: 'onnx',
        task: 'feature-extraction',
        dtype: 'q8',
        downloadId: 'bge-small-zh-q8',
        sizeBytes: 25000000,
        repo: 'Xenova/bge-small-zh-v1.5',
        path: 'bge-small-zh-q8',
        enabled: false,
        note: '中文优先 · INT8 · 约 25 MB · 推荐',
      },
      {
        id: 'minilm-multilingual-q8',
        name: 'MiniLM 多语言轻量版',
        kind: 'decision',
        backend: 'onnx',
        task: 'feature-extraction',
        dtype: 'q8',
        downloadId: 'minilm-multilingual-q8',
        sizeBytes: 136000000,
        repo: 'Xenova/paraphrase-multilingual-MiniLM-L12-v2',
        path: 'minilm-multilingual-q8',
        enabled: false,
        note: '多语言 · INT8 · 约 136 MB',
      },
    ],
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

                                                                                 

export interface ClipboardSnapshot {
  formats: string[]
  text: string
  html: string
                                           
  filePath: string | null
                                      
  imageDataUrl: string | null
}

                                                                                   

export interface ForegroundWindow {
  title: string
  handle: number
}

export interface PlatformAdapter {
  readonly platform: 'win32' | 'darwin'
                                                     
  clipboardSequenceNumber(): number
                    
  readClipboard(): ClipboardSnapshot
  foregroundWindow(): ForegroundWindow | null
                                        
  saveForeground(): number | null
  restoreForeground(handle: number): void
  writeText(text: string): void
  writeHtml(html: string, plain: string): void
                                   
  writeImageFile(path: string): void
                                  
  writeFilePaths(paths: string[]): void
                                    
  sendPasteKeys(): void
}

                                                                                        

export interface ClipStore {
  readonly dbPath: string

             
  insertPost(input: NewPost): { post: Post; created: boolean }
  touchPost(id: string): void
  queryPosts(q: PostQuery): PostPage
  getPost(id: string): Post | null
  updatePost(id: string, patch: Partial<Post>): void
  removePost(id: string): void
  removePostsNoGroup(): void
  clearHistory(): void
                                     
  clearHistoryBefore(ms: number): number
  countByType(): Record<ContentType, number>
  queryActivity(from: number, to: number): ClipboardActivity[]
                                   
  importPosts(posts: NewPost[]): number

              
  createGroup(name?: string, kind?: Group['kind']): Group
  listGroups(): Group[]
  updateGroup(id: string, patch: Partial<Group>): void
  removeGroup(id: string): void
  clearGroup(id: string): void
  movePostsToGroup(ids: string[], groupId: string | null): void

             
  listRules(): Rule[]
  upsertRule(rule: Rule): void
  removeRule(id: string): void

                                     
  getSettings(): Settings
  saveSettings(patch: DeepPartial<Settings>): Settings

                                                 
  upsertVector(postId: string, model: string, vec: Float32Array): void
  queryVectors(model: string): Array<{ postId: string; vec: Float32Array }>

                   
  vacuum(): void
  close(): void
}

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K]
}

                                                                                     

                   
export interface FieldCtx {
                              
  id: string
  tag: 'input' | 'textarea' | 'div'
                                                
  type: string
  name: string
                                                    
  label: string
  value: string
  maxLength: number
}

export interface PageCtx {
  url: string
  title: string
  host: string
}

              
export type ExtToAppMessage =
  | { t: 'hello'; token: string; ua: string; extVersion: string }
  | { t: 'ping' }
  | { t: 'pong' }
  | { t: 'field-focus'; field: FieldCtx; page: PageCtx }
  | { t: 'field-blur' }
  | { t: 'fill-result'; reqId: string; ok: boolean; err?: string }

              
export type AppToExtMessage =
  | { t: 'welcome'; app: string; version: string }
  | { t: 'pong' }
  | { t: 'ping' }
  | { t: 'auth-fail'; reason: string }
  | { t: 'fill'; reqId: string; value: string; mode: 'replace' | 'append' }
  | {
      t: 'suggest'
      reqId: string
      items: Array<{
        id: string
        title: string
        preview: string
        value: string
        scope: 'field' | 'global'
      }>
    }

export interface BrowserStatus {
  connected: boolean
  port: number
  token: string
  autoFill: boolean
  enabled: boolean
  client: { ua: string; extVersion: string; connectedAt: number } | null
}

                                                                                  

export const IPC = {
                  
  queryPosts: 'posts:query',
  removePost: 'posts:remove',
  updatePost: 'posts:update',
  movePost: 'posts:move',
  pinPost: 'posts:pin',
  pastePost: 'posts:paste',
  clearHistory: 'posts:clear-history',
                   
  queryGroups: 'groups:query',
  createGroup: 'groups:create',
  updateGroup: 'groups:update',
  removeGroup: 'groups:remove',
  clearGroup: 'groups:clear',
                     
  querySettings: 'settings:query',
  updateSettings: 'settings:update',
  updateShowHideHotkey: 'settings:show-hide-hotkey',
  toggleQuickPaste: 'settings:quick-paste',
  toggleGroupShortcut: 'settings:group-shortcut',
                   
  hidePanel: 'window:hide-panel',
  getPanelSize: 'window:panel-size',
  updateLayout: 'window:layout',
  updateTheme: 'window:theme',
  openSettings: 'window:open-settings',
  settingsMinimize: 'settings:minimization',
  settingsClose: 'settings:off',
                        
  enqueueCopy: 'paste:enqueue',
  flushQueue: 'paste:flush-queue',
                         
  intelligenceStatus: 'intelligence:status',
  intelligenceQuery: 'intelligence:query',
  intelligenceReindex: 'intelligence:reindex',
  intelligenceModelStatus: 'intelligence:model-status',
  intelligenceModelDownload: 'intelligence:model-download',
                   
  openExternal: 'common:open-external',
  checkUpdate: 'common:check-update',
  getDataDir: 'common:data-dir',
  quitApp: 'common:quit',
  getVersion: 'common:version',
  openWebManager: 'common:open-web-manager',
                           
  browserStatus: 'browser:status',
  browserSetConfig: 'browser:set-config',
  browserRegenerateToken: 'browser:regenerate-token',
  browserPing: 'browser:ping',
  readImageDataUrl: 'content:read-image',
                                  
  evtPostCaptured: 'event:post-captured',
  evtPostTouched: 'event:post-touched',
  evtPostsRemoved: 'event:posts-removed',
  evtSettingsChanged: 'event:settings-changed',
  evtShow: 'event:show',
  evtHide: 'event:hide',
  evtHotKey: 'event:hot-key',
  evtMoveGroup: 'event:move-group',
  evtIntelligenceStatus: 'event:intelligence-status',
  evtModelDownload: 'event:model-download',
  evtBrowserStatus: 'event:browser-status',
} as const

                                                                                             

export interface IntelligenceStatus {
  tier: IntelligenceTier
  state: 'unloaded' | 'loading' | 'ready' | 'failed'
  model: string
  detail?: string
                
  indexed: number
  total: number
  backend: 'builtin' | 'onnx'
                                                 
  activeModelId?: string
                                   
  models?: ModelStatusInfo['models']
}

export interface ClipNestBridge {
             
  queryPosts(q: PostQuery): Promise<PostPage>
  removePost(id: string): Promise<boolean>
  updatePost(id: string, patch: Partial<Post>): Promise<boolean>
  movePost(id: string, groupId: string | null): Promise<boolean>
  pinPost(id: string, pinned: number): Promise<boolean>
  pastePost(id: string): Promise<boolean>
  clearHistory(): Promise<boolean>
              
  queryGroups(): Promise<Group[]>
  createGroup(name?: string): Promise<Group>
  updateGroup(id: string, patch: Partial<Group>): Promise<boolean>
  removeGroup(id: string): Promise<boolean>
  clearGroup(id: string): Promise<boolean>
                
  querySettings(): Promise<Settings>
  updateSettings(patch: DeepPartial<Settings>): Promise<Settings>
  updateShowHideHotkey(key: string): Promise<boolean>
  toggleQuickPaste(enable: boolean): Promise<boolean>
  toggleGroupShortcut(which: 'previous' | 'next', key: string): Promise<boolean>
              
  hidePanel(): void
  getPanelSize(): Promise<{ width: number; height: number; layout: Layout }>
  updateLayout(layout: Layout): Promise<{ layout: Layout }>
  updateTheme(theme: ThemeType): Promise<string>
  openSettings(): void
                             
  minimizeSettings(): void
  closeSettings(): void
                   
  enqueueCopy(): Promise<number>
  flushQueue(): Promise<boolean>
                    
  intelligenceStatus(): Promise<IntelligenceStatus>
  intelligenceQuery(q: { keyword: string; limit?: number }): Promise<string[]>
  intelligenceReindex(): Promise<number>
  intelligenceModelStatus(): Promise<ModelStatusInfo>
  intelligenceModelDownload(modelId: string): Promise<ModelDownloadResult>
              
  openExternal(url: string): Promise<void>
  checkUpdate(): Promise<boolean>
  getDataDir(): Promise<string>
  quitApp(): void
  getVersion(): Promise<string>
  openWebManager(): Promise<boolean>
                      
  browserStatus(): Promise<BrowserStatus>
  browserSetConfig(patch: DeepPartial<Settings['browser']>): Promise<BrowserStatus>
  browserRegenerateToken(): Promise<string>
  browserPing(): Promise<boolean>
                                                        
  readImageDataUrl(path: string): Promise<string | null>
                       
  onPostCaptured(cb: (e: CaptureEvent) => void): () => void
  onPostTouched(cb: (id: string) => void): () => void
  onPostsRemoved(cb: (ids: string[]) => void): () => void
  onSettingsChanged(cb: (s: Settings) => void): () => void
  onShow(cb: (layout: Layout) => void): () => void
  onHide(cb: () => void): () => void
  onHotKey(cb: (n: number) => void): () => void
  onMoveGroup(cb: (dir: -1 | 1) => void): () => void
  onIntelligenceStatus(cb: (s: IntelligenceStatus) => void): () => void
  onModelDownload(cb: (s: ModelDownloadInfo) => void): () => void
  onBrowserStatus(cb: (s: BrowserStatus) => void): () => void
}

declare global {
  interface Window {
    clipnest: ClipNestBridge
  }
}
