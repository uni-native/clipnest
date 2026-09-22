import { BrowserWindow, nativeTheme, screen } from 'electron'
import { resolve } from 'node:path'
import { IPC, DEFAULT_SETTINGS } from '@shared/types'
import type { ClipStore, Layout, Settings, ThemeType } from '@shared/types'
import { initStore } from '@main/core/store'
import { loadAppIcon } from '@main/windows/icon'

                
const PANEL_WIDTH = 290
               
const PANEL_HEIGHT = 340

let boundStore: ClipStore | null = null
let fallbackStore: ClipStore | null = null
let storeProbed = false

   
                                                  
   
export function bindShellStore(store: ClipStore): void {
  boundStore = store
  fallbackStore = store
  storeProbed = true
}

function resolveStore(): ClipStore | null {
  if (boundStore) return boundStore
  if (fallbackStore) return fallbackStore
  if (storeProbed) return null
  storeProbed = true
  try {
    fallbackStore = initStore()
  } catch (err) {
    console.error('[clipnest] panel 读取设置时 store 不可用', err)
    fallbackStore = null
  }
  return fallbackStore
}

                                       
export function getSettings(): Settings {
  const store = resolveStore()
  if (!store) return DEFAULT_SETTINGS
  try {
    return store.getSettings()
  } catch (err) {
    console.error('[clipnest] 读取设置失败', err)
    return DEFAULT_SETTINGS
  }
}

function currentLayout(): Layout {
  return getSettings().clipboard.layout
}

                                       
const RENDERER_HTML = resolve(__dirname, '../renderer/index.html')
const PRELOAD_ENTRY = resolve(__dirname, '../preload/index.js')

export function createPanelWindow(store?: ClipStore): BrowserWindow {
  if (store) bindShellStore(store)

  const win = new BrowserWindow({
    width: PANEL_WIDTH,
    height: 700,
    icon: loadAppIcon(),
    show: false,
    transparent: true,
    frame: false,
    hasShadow: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    resizable: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      preload: PRELOAD_ENTRY,
      backgroundThrottling: false,
    },
  })

                                
  win.setAlwaysOnTop(true, 'normal', 20)
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

                               
  win.on('blur', () => hidePanel(win))

  win.loadFile(RENDERER_HTML).catch(err => {
    console.error('[clipnest] 面板加载渲染产物失败', err)
  })
  return win
}

                                   
export function applyLayout(win: BrowserWindow, layout: Layout): void {
  if (win.isDestroyed()) return
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea
  if (layout === 'horizontal') {
    win.setSize(area.width, PANEL_HEIGHT)
    win.setPosition(area.x, area.y + area.height - PANEL_HEIGHT)
  } else {
    win.setSize(PANEL_WIDTH, area.height)
    win.setPosition(area.x + area.width - PANEL_WIDTH, area.y)
  }
}

export function showPanel(win: BrowserWindow): void {
  if (win.isDestroyed()) return
  const layout = currentLayout()
  applyLayout(win, layout)
  win.show()
  win.focus()
  try {
    win.webContents.send(IPC.evtShow, layout)
  } catch (err) {
    console.error('[clipnest] evtShow 发送失败', err)
  }
}

export function hidePanel(win: BrowserWindow): void {
  if (win.isDestroyed()) return
  try {
    win.webContents.send(IPC.evtHide)
  } catch (err) {
    console.error('[clipnest] evtHide 发送失败', err)
  }
  setTimeout(() => {
    if (!win.isDestroyed()) win.hide()
  }, 120)
}

export function togglePanel(win: BrowserWindow): void {
  if (win.isDestroyed()) return
  if (win.isVisible()) hidePanel(win)
  else showPanel(win)
}

export function panelSize(
  win: BrowserWindow,
): { width: number; height: number; layout: Layout } {
  const [width, height] = win.isDestroyed() ? [PANEL_WIDTH, 0] : win.getSize()
  return { width, height, layout: currentLayout() }
}

export function setLayout(win: BrowserWindow, layout: Layout): { layout: Layout } {
  const store = resolveStore()
  try {
    store?.saveSettings({ clipboard: { layout } })
  } catch (err) {
    console.error('[clipnest] 保存布局失败', err)
  }
  applyLayout(win, layout)
  return { layout }
}

export function setTheme(win: BrowserWindow, theme: string): string {
  const resolved: ThemeType =
    theme === 'system' ? (nativeTheme.shouldUseDarkColors ? 'dark' : 'light') : (theme as ThemeType)
  const store = resolveStore()
  try {
    store?.saveSettings({ clipboard: { theme: resolved } })
  } catch (err) {
    console.error('[clipnest] 保存主题失败', err)
  }
  return resolved
}
