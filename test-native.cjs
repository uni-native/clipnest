const { app } = require('electron')

app.whenReady().then(() => {
  const lines = []
  try {
    const sqlite = require('better-sqlite3')
    const db = new sqlite(':memory:')
    db.exec('CREATE VIRTUAL TABLE t USING fts5(x)')
    db.prepare('INSERT INTO t VALUES (?)').run('hello 剪巢')
    const rows = db.prepare("SELECT rowid FROM t WHERE t MATCH 'hello'").all()
    lines.push('[native] better-sqlite3 OK, fts5 rows: ' + JSON.stringify(rows))
  } catch (e) {
    lines.push('[native] better-sqlite3 FAIL: ' + e.message)
  }
  try {
    const koffi = require('koffi')
    const user32 = koffi.load('user32.dll')
    const seq = user32.func('uint32 __stdcall GetClipboardSequenceNumber()')()
    const fg = user32.func('void* __stdcall GetForegroundWindow()')()
    lines.push('[native] koffi OK, seq: ' + seq + ', fg: ' + (fg !== null))
  } catch (e) {
    lines.push('[native] koffi FAIL: ' + e.message)
  }
  lines.push('[native] electron: ' + process.versions.electron + ', node: ' + process.versions.node)
  require('node:fs').writeFileSync(__dirname + '/native-test-result.txt', lines.join('\n') + '\n')
  app.exit(0)
})
