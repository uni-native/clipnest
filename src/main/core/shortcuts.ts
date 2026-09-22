import { globalShortcut } from 'electron'
import { IPC } from '@shared/types'
import type { BrowserWindow } from 'electron'
import type { ClipStore } from '@shared/types'
import { togglePanel } from '@main/windows/panel'

                                                     
let storeRef: ClipStore | null = null

function send(win: BrowserWindow, channel: string, payload?: unknown): void {
  if (win.isDestroyed()) return
  win.webContents.send(channel, payload)
}

                                      
function register(accel: string, fn: () => void): boolean {
  if (!accel) return false
  try {
    if (!globalShortcut.register(accel, fn)) {
      console.error('[clipnest] 快捷键注册失败（可能被占用）:', accel)
      return false
    }
    return true
  } catch (err) {
    console.error('[clipnest] 快捷键注册异常:', accel, err)
    return false
  }
}

                              
function registerQuickPaste(win: BrowserWindow, mod: string, enable: boolean): void {
  for (let n = 1; n <= 9; n++) {
    const accel = `${mod}+${n}`
    if (!enable) {
      globalShortcut.unregister(accel)
      continue
    }
    register(accel, () => send(win, IPC.evtHotKey, n))
  }
}

function registerGroup(win: BrowserWindow, accel: string, dir: -1 | 1): boolean {
  return register(accel, () => send(win, IPC.evtMoveGroup, dir))
}

                                         
const SHOW_HIDE_FALLBACKS = ['alt+v', 'ctrl+shift+v', 'alt+shift+v', 'ctrl+alt+v']

export function initShortcuts(win: BrowserWindow, store: ClipStore): void {
  storeRef = store
  globalShortcut.unregisterAll()

  const keys = store.getSettings().shortcutKeys
  if (!register(keys.showOrHide, () => togglePanel(win))) {
                                             
    const ok = SHOW_HIDE_FALLBACKS.find(accel => accel !== keys.showOrHide && register(accel, () => togglePanel(win)))
    if (ok) {
      console.warn('[clipnest] 默认唤起键被占用，已降级为:', ok)
      store.saveSettings({ shortcutKeys: { showOrHide: ok } })
    } else {
      console.error('[clipnest] 所有唤起快捷键均被占用，请手动在设置中指定')
    }
  }
  registerQuickPaste(win, keys.quickPaste, keys.quickPasteEnable)
  registerGroup(win, keys.previousGroup, -1)
  registerGroup(win, keys.nextGroup, 1)
}

export function setShowOrHideHotkey(win: BrowserWindow, key: string): boolean {
  const store = storeRef
  if (!store) return false
  const old = store.getSettings().shortcutKeys.showOrHide
  if (old === key) return true

  globalShortcut.unregister(old)
  if (!register(key, () => togglePanel(win))) {
                                      
    register(old, () => togglePanel(win))
    return false
  }
  store.saveSettings({ shortcutKeys: { showOrHide: key } })
  return true
}

export function setQuickPaste(win: BrowserWindow, enable: boolean): boolean {
  const store = storeRef
  if (!store) return false
  const mod = store.getSettings().shortcutKeys.quickPaste
  store.saveSettings({ shortcutKeys: { quickPasteEnable: enable } })
  registerQuickPaste(win, mod, enable)
  return true
}

export function setGroupShortcut(
  win: BrowserWindow,
  which: 'previous' | 'next',
  key: string,
): boolean {
  const store = storeRef
  if (!store) return false
  const dir: -1 | 1 = which === 'previous' ? -1 : 1
  const old = store.getSettings().shortcutKeys[which === 'previous' ? 'previousGroup' : 'nextGroup']
  if (old === key) return true

  globalShortcut.unregister(old)
  if (!registerGroup(win, key, dir)) {
    registerGroup(win, old, dir)
    return false
  }
  if (which === 'previous') store.saveSettings({ shortcutKeys: { previousGroup: key } })
  else store.saveSettings({ shortcutKeys: { nextGroup: key } })
  return true
}
