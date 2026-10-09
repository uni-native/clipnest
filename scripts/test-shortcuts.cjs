const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const { createRequire } = require('node:module')
const root = require('node:path').resolve(__dirname, '..')
const repoRequire = createRequire(root + '/package.json')
const source = fs.readFileSync(root + '/src/main/core/shortcuts.ts', 'utf8')
const compiled = repoRequire('esbuild').transformSync(source, { loader: 'ts', format: 'cjs' }).code
const passed = []

function fixture(key = 'alt+v', blocked = []) {
  const settings = { shortcutKeys: { showOrHide: key, quickPaste: 'ctrl', quickPasteEnable: false, previousGroup: 'ctrl+[', nextGroup: 'ctrl+]' } }
  const registered = new Map()
  const attempts = [], saves = [], notifications = [], errors = []
  let failSave = false
  const store = {
    getSettings: () => settings,
    saveSettings: patch => {
      if (failSave) throw new Error('QA 写入失败')
      saves.push(patch)
      Object.assign(settings.shortcutKeys, patch.shortcutKeys)
      return settings
    },
  }
  const win = { isDestroyed: () => false, webContents: { send() {} } }
  const globalShortcut = {
    unregisterAll: () => registered.clear(),
    unregister: key => registered.delete(key),
    isRegistered: key => registered.has(key),
    register: (key, callback) => {
      attempts.push(key)
      if (blocked.includes(key) || registered.has(key)) return false
      registered.set(key, callback)
      return true
    },
  }
  class Notification {
    static isSupported() { return true }
    constructor(options) { this.options = options }
    on() { return this }
    show() { notifications.push(this.options) }
  }
  const module = { exports: {} }
  vm.runInNewContext(compiled, {
    module, exports: module.exports,
    require: name => {
      if (name === 'electron') return { globalShortcut, Notification }
      if (name === '@shared/types') return { IPC: { evtHotKey: 'hotkey', evtMoveGroup: 'group' } }
      if (name === '@main/windows/panel') return { togglePanel() {} }
      throw new Error(`Unexpected import ${name}`)
    },
    console: { error: (...args) => errors.push(args), info() {} },
  })
  return { api: module.exports, settings, store, win, registered, attempts, saves, notifications, errors, failSave: () => { failSave = true } }
}

const blocked = fixture('alt+v', ['alt+v'])
blocked.api.initShortcuts(blocked.win, blocked.store)
assert.equal(blocked.settings.shortcutKeys.showOrHide, 'alt+v')
assert.equal(blocked.saves.length, 0)
assert.deepEqual(blocked.attempts, ['alt+v', 'ctrl+[', 'ctrl+]'])
assert.equal(blocked.notifications.length, 1)
assert.match(blocked.notifications[0].body, /alt\+v/)
passed.push('启动时唤起键被占用，保留原设置并提示，不自动换键')

const missing = fixture()
missing.api.initShortcuts(missing.win, missing.store)
missing.registered.delete('alt+v')
assert.equal(missing.api.setShowOrHideHotkey(missing.win, 'alt+v'), true)
assert.equal(missing.registered.has('alt+v'), true)
passed.push('设置未变但快捷键未注册时，重新启用同一组合键')

const failed = fixture('ctrl+shift+v', ['alt+v'])
failed.api.initShortcuts(failed.win, failed.store)
assert.equal(failed.api.setShowOrHideHotkey(failed.win, 'alt+v'), false)
assert.equal(failed.settings.shortcutKeys.showOrHide, 'ctrl+shift+v')
assert.equal(failed.registered.has('ctrl+shift+v'), true)
passed.push('修改为已被占用的组合键时，原组合键继续有效')

const success = fixture('ctrl+shift+v')
success.api.initShortcuts(success.win, success.store)
assert.equal(success.api.setShowOrHideHotkey(success.win, 'alt+v'), true)
assert.equal(success.settings.shortcutKeys.showOrHide, 'alt+v')
assert.equal(success.registered.has('alt+v'), true)
assert.equal(success.registered.has('ctrl+shift+v'), false)
const count = success.attempts.length
assert.equal(success.api.setShowOrHideHotkey(success.win, 'alt+v'), true)
assert.equal(success.attempts.length, count)
passed.push('恢复 Alt+V 后解除旧键，相同且有效的设置不重复注册')

const persistence = fixture('ctrl+shift+v')
persistence.api.initShortcuts(persistence.win, persistence.store)
persistence.failSave()
assert.equal(persistence.api.setShowOrHideHotkey(persistence.win, 'alt+v'), false)
assert.equal(persistence.registered.has('ctrl+shift+v'), true)
assert.equal(persistence.registered.has('alt+v'), false)
assert.equal(persistence.errors.length, 1)
passed.push('保存失败时保持原组合键，返回失败并记录原因')

console.log(JSON.stringify({ passed: passed.length, checks: passed }, null, 2))
