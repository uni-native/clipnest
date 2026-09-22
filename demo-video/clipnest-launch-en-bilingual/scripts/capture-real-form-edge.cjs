const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const playwrightRoot = process.argv[2]
const outputFile = process.argv[3]
const edgePath = process.argv[4]
const repoRoot = path.resolve(__dirname, '..', '..', '..')
const extensionPath = path.join(repoRoot, 'chrom-extension')
const profilePath = fs.mkdtempSync(path.join(os.tmpdir(), 'clipnest-edge-'))

if (!playwrightRoot || !outputFile || !edgePath) {
  throw new Error('参数缺失：Playwright 路径、输出文件与 Edge 路径为必填项')
}

function readBridgeToken() {
  const script = [
    'import json, os, sqlite3',
    "p=os.path.join(os.environ['APPDATA'],'clipnest','clipnest-data','clipnest.db')",
    'db=sqlite3.connect(p)',
    "row=db.execute('select data from settings limit 1').fetchone()",
    'db.close()',
    "print(json.loads(row[0]).get('browser',{}).get('token',''), end='')",
  ].join(';')
  const token = execFileSync('python', ['-c', script], { encoding: 'utf8' }).trim()
  if (!token) throw new Error('未读取到浏览器桥接令牌')
  return token
}

async function main() {
  const { chromium } = require(playwrightRoot)
  const token = readBridgeToken()
  const context = await chromium.launchPersistentContext(profilePath, {
    executablePath: edgePath,
    headless: false,
    viewport: { width: 1920, height: 1080 },
    recordVideo: { dir: path.dirname(outputFile), size: { width: 1920, height: 1080 } },
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      '--no-first-run',
      '--disable-features=msEdgeFirstRunExperience',
    ],
  })

  try {
    let worker = context.serviceWorkers()[0]
    if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 15000 })
    await worker.evaluate(async ({ token }) => {
      await chrome.storage.local.set({ wsUrl: 'ws://127.0.0.1:9377', token, autoFill: true })
    }, { token })
    const connectedBy = Date.now() + 15000
    while (Date.now() < connectedBy) {
      if (await worker.evaluate(() => status === 'connected')) break
      await new Promise((resolve) => setTimeout(resolve, 300))
    }
    if (!(await worker.evaluate(() => status === 'connected'))) {
      throw new Error('浏览器扩展未连接到本地桥接')
    }

    await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
      origin: 'http://127.0.0.1:8899',
    })
    const page = context.pages()[0] || await context.newPage()
    await page.goto('http://127.0.0.1:8899/test-form.html', { waitUntil: 'networkidle' })
    await page.waitForTimeout(1800)

    await page.evaluate(() => navigator.clipboard.writeText('zhangsan@example.com'))
    await page.waitForTimeout(900)
    await page.locator('#email').click()
    await page.waitForFunction(() => document.querySelector('#email').value === 'zhangsan@example.com', null, { timeout: 6000 })
    await page.waitForTimeout(1500)

    await page.evaluate(() => navigator.clipboard.writeText('https://github.com/clipnest/clipnest'))
    await page.waitForTimeout(900)
    await page.locator('#website').click()
    await page.waitForFunction(() => document.querySelector('#website').value === 'https://github.com/clipnest/clipnest', null, { timeout: 6000 })
    await page.waitForTimeout(1600)

    await page.evaluate(() => navigator.clipboard.writeText('safe-demo-secret'))
    await page.waitForTimeout(900)
    await page.locator('#pwd').click()
    await page.waitForTimeout(1400)
    const passwordValue = await page.locator('#pwd').inputValue()
    if (passwordValue !== '') throw new Error('安全校验失败：密码框被填充')
    await page.locator('#email').click()
    await page.waitForTimeout(800)

    const video = page.video()
    await page.close()
    const recorded = await video.path()
    fs.copyFileSync(recorded, outputFile)
    process.stdout.write(JSON.stringify({
      ok: true,
      emailFilled: true,
      profileFilled: true,
      passwordProtected: true,
      output: outputFile,
    }))
  } finally {
    await context.close()
    fs.rmSync(profilePath, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
