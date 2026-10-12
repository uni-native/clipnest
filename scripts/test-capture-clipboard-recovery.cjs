const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

function createWatcher() {
  let sequence = 10
  let tick
  let formats = []
  let imageReady = false
  const delivered = []
  const diagnostics = []
  const clipboard = {
    availableFormats: () => formats,
    readText: () => '', readHTML: () => '', readBuffer: () => Buffer.alloc(0),
    readImage: () => ({ isEmpty: () => !imageReady, toDataURL: () => 'data:image/png;base64,test-image' }),
  }
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/main/capture/watcher.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const module = { exports: {} }
  vm.runInNewContext(code, {
    module, exports: module.exports, Buffer, process: { platform: 'win32' },
    console: { warn: (...args) => diagnostics.push(args), error: (...args) => diagnostics.push(args) },
    setInterval: callback => { tick = callback; return 1 }, clearInterval: () => {},
    require: name => {
      if (name === 'electron') return { clipboard }
      if (name === 'koffi') return { load: () => ({ func: () => () => sequence }) }
      if (name === '@main/platform/win32') return { clipboardFormatNames: () => [] }
      throw new Error(`Unexpected dependency: ${name}`)
    },
  })
  const listener = module.exports.startListening(snapshot => delivered.push(snapshot))
  return {
    delivered, diagnostics,
    change: (nextFormats, ready) => { sequence++; formats = nextFormats; imageReady = ready },
    ready: () => { imageReady = true },
    formats: value => { formats = value },
    poll: async () => { tick(); await new Promise(resolve => setImmediate(resolve)) },
    stop: () => listener.stop(),
  }
}

async function main() {
  let watcher = createWatcher()
  watcher.change([], false)
  await watcher.poll()
  watcher.formats(['image/png']); watcher.ready()
  await watcher.poll()
  assert.equal(watcher.delivered.length, 1, 'a temporarily occupied clipboard must be read again without another copy')
  assert.ok(watcher.delivered[0].imageDataUrl)
  await watcher.poll()
  assert.equal(watcher.delivered.length, 1, 'a recovered image must be captured only once')
  watcher.stop()

  watcher = createWatcher()
  watcher.change(['image/png'], false)
  await watcher.poll()
  assert.equal(watcher.delivered.length, 0, 'an advertised image with unavailable bytes must not be marked captured')
  watcher.ready(); await watcher.poll()
  assert.equal(watcher.delivered.length, 1, 'the same image change must be captured once its bytes become available')
  watcher.stop()

  watcher = createWatcher()
  watcher.change([], false)
  for (let i = 0; i < 20; i++) await watcher.poll()
  assert.equal(watcher.diagnostics.length, 1, 'a pending clipboard must not flood the log')
  watcher.stop()
  console.log('PASS: temporary lock recovery, delayed image recovery, no duplicate capture, bounded diagnostics')
}
main().catch(error => { console.error('Clipboard recovery regression failed:', error); process.exitCode = 1 })
