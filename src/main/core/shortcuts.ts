import { globalShortcut, Notification } from 'electron'
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
      console.error('[pasteman] 快捷键注册失败:', accel)
      return false
    }
    return true
  } catch (err) {
    console.error('[pasteman] 快捷键注册异常:', accel, err)
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

function notifyShortcutFailure(key: string): void {
  try {
    if (!Notification.isSupported()) return
    const notification = new Notification({
      title: '剪贴板快捷键未能启用',
      body: `${key} 注册失败，请在偏好设置中修改快捷键，或关闭占用此组合键的应用。`,
    })
    notification.on('failed', (_event, error) => {
      console.error('[pasteman] 快捷键通知发送失败:', error)
    })
    notification.show()
  } catch (err) {
    console.error('[pasteman] 快捷键通知发送异常:', err)
  }
}

export function initShortcuts(win: BrowserWindow, store: ClipStore): void {
  storeRef = store
  globalShortcut.unregisterAll()

  const keys = store.getSettings().shortcutKeys
  if (!register(keys.showOrHide, () => togglePanel(win))) {
    notifyShortcutFailure(keys.showOrHide)
  } else {
    console.info('[pasteman] 唤起快捷键已启用:', keys.showOrHide)
  }
  registerQuickPaste(win, keys.quickPaste, keys.quickPasteEnable)
  registerGroup(win, keys.previousGroup, -1)
  registerGroup(win, keys.nextGroup, 1)
}

export function setShowOrHideHotkey(win: BrowserWindow, key: string): boolean {
  const store = storeRef
  if (!store) return false
  const old = store.getSettings().shortcutKeys.showOrHide
  if (old === key && globalShortcut.isRegistered(key)) return true

  globalShortcut.unregister(old)
  if (!register(key, () => togglePanel(win))) {
                                      
    register(old, () => togglePanel(win))
    return false
  }
  try {
    store.saveSettings({ shortcutKeys: { showOrHide: key } })
    console.info('[pasteman] 唤起快捷键已更新:', key)
    return true
  } catch (err) {
    console.error('[pasteman] 唤起快捷键保存失败:', err)
    globalShortcut.unregister(key)
    register(old, () => togglePanel(win))
    return false
  }
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
