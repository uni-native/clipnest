const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const root = path.resolve(__dirname, '..')
const output = path.join(root, 'output')
fs.mkdirSync(output, { recursive: true })
const directory = fs.mkdtempSync(path.join(output, 'diagnostics-test-'))

function load(file, dependencies, testConsole = console) {
  const context = { exports: {}, Buffer, Date, process, console: testConsole, require: name =>
    Object.prototype.hasOwnProperty.call(dependencies, name) ? dependencies[name] : require(name) }
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText, context)
  return context.exports
}

async function testLogging() {
  const messages = []
  const sink = { log: line => messages.push(line), warn: line => messages.push(line), error: line => messages.push(line) }
  const logger = load('src/main/core/logger.ts', { './paths': { logsDir: directory } }, sink)
  logger.initFileLogging()
  for (let index = 0; index < 850; index++) sink.log(index, 'x'.repeat(7800))
  const secret = 'ghp_' + 'a'.repeat(35)
  sink.warn('privacy', secret, 'person@example.com', 'C:\\private\\video.mp4')
  sink.error(new Error('diagnostic stack marker'))
  const currentPath = path.join(directory, 'pasteman.log')
  const oldPath = path.join(directory, 'pasteman.previous.log')
  for (let attempt = 0; attempt < 100; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 20))
    if (fs.existsSync(oldPath) && fs.readFileSync(currentPath, 'utf8').includes('diagnostic stack marker')) break
  }
  assert.ok(fs.existsSync(oldPath), '日志运行期间应轮换')
  for (const file of [currentPath, oldPath]) assert.ok(fs.statSync(file).size <= 5 * 1024 * 1024)
  const log = fs.readFileSync(currentPath, 'utf8')
  assert.ok(log.includes('ERROR Error: diagnostic stack marker'))
  assert.ok(log.includes('<secret>') && log.includes('<email>') && log.includes('<path>'))
  assert.ok(!log.includes(secret) && !log.includes('person@example.com') && !log.includes('video.mp4'))
  assert.ok(messages.length > 0)
  console.log('PASS: 运行期间轮换、大小限制、敏感信息隐藏、错误详情')
}

async function testCapture() {
  const messages = []
  let handle
  const sink = { log: (...args) => messages.push(args), warn: (...args) => messages.push(args), error: (...args) => messages.push(args) }
  const capture = load('src/main/capture/index.ts', {
    '@main/platform/win32': { clipboardFormatNames: () => ['fixture-native-format'] },
    './classify': { classifySnapshot: () => 'file' },
    './normalize': { normalizeSnapshot: snapshot => snapshot.filePath ? {
      hash: 'fixture-hash', type: 'file', title: 'private.mp4', preview: 'private content', contentPath: snapshot.filePath, size: 100
    } : null },
    './sourceApp': { getSourceApp: () => 'fixture' },
    './watcher': { startListening: callback => { handle = callback; return { stop() {} } } }
  }, sink)
  capture.startCapture({ insertPost: input => ({ post: { ...input, id: 'fixture-post' }, created: true }) }, () => {})
  const snapshot = { sequence: 123, formats: ['fixture-video-format'], text: '', html: '', filePath: null, imageDataUrl: null }
  await handle(snapshot)
  assert.equal(messages[0][1].reason, '未识别到可保存内容')
  assert.equal(messages[0][1].nativeFormats[0], 'fixture-native-format')
  await handle({ ...snapshot, filePath: 'C:\\private\\video.mp4' })
  assert.equal(messages[1][1].result, '新增')
  assert.equal(messages[1][1].sequence, 123)
  assert.ok(!JSON.stringify(messages).includes('video.mp4'))
  capture.markSelfWrite('fixture-hash')
  await handle({ ...snapshot, filePath: 'C:\\private\\video.mp4' })
  assert.match(messages[2][0], /忽略应用自身复制/)
  console.log('PASS: 未识别原因、收录结果、序号关联、自身复制忽略、隐私保护')
}

Promise.resolve().then(testLogging).then(testCapture).catch(error => { console.error(error); process.exitCode = 1 })
