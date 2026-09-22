const fs = require('node:fs')
const path = require('node:path')

const playwrightRoot = process.argv[2]
const outputDir = process.argv[3]
if (!playwrightRoot || !outputDir) throw new Error('缺少 Playwright 路径或输出目录')

const { chromium } = require(playwrightRoot)

async function pause(page, ms) {
  await page.waitForTimeout(ms)
}

async function moveAndClick(page, locator) {
  const box = await locator.boundingBox()
  if (!box) throw new Error('目标控件不可见')
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 28 })
  await pause(page, 280)
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
}

async function run() {
  fs.mkdirSync(outputDir, { recursive: true })
  const videoDir = path.join(outputDir, 'raw')
  fs.mkdirSync(videoDir, { recursive: true })
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.argv[4] || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  })
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    recordVideo: { dir: videoDir, size: { width: 1920, height: 1080 } },
    deviceScaleFactor: 1,
    bypassCSP: true,
  })
  const page = await context.newPage()
  const recordedVideo = page.video()
  await page.goto('http://127.0.0.1:9378/', { waitUntil: 'networkidle' })
  await page.addStyleTag({ content: 'html{scroll-behavior:smooth} body{cursor:none!important}' })
  await page.evaluate(() => {
    const cursor = document.createElement('div')
    cursor.id = 'demo-cursor'
    cursor.style.cssText = 'position:fixed;left:960px;top:540px;width:26px;height:26px;border:3px solid #5b51ed;border-radius:50%;background:rgba(255,255,255,.9);box-shadow:0 8px 24px rgba(52,46,105,.25);z-index:99999;pointer-events:none;transform:translate(-50%,-50%);transition:width .16s,height .16s,background .16s'
    document.body.appendChild(cursor)
    document.addEventListener('mousemove', event => {
      cursor.style.left = `${event.clientX}px`
      cursor.style.top = `${event.clientY}px`
    })
    document.addEventListener('mousedown', () => {
      cursor.style.width = '42px'
      cursor.style.height = '42px'
      cursor.style.background = 'rgba(111,102,246,.18)'
    })
    document.addEventListener('mouseup', () => {
      cursor.style.width = '26px'
      cursor.style.height = '26px'
      cursor.style.background = 'rgba(255,255,255,.9)'
    })
  })

  await pause(page, 1800)
  await page.mouse.move(1120, 355, { steps: 36 })
  await pause(page, 900)

  await moveAndClick(page, page.getByRole('button', { name: '内容管理' }))
  await pause(page, 1300)

  const search = page.locator('#search')
  await moveAndClick(page, search)
  await search.fill('clipnest')
  await pause(page, 1500)

  const type = page.locator('#type')
  const typeBox = await type.boundingBox()
  if (typeBox) await page.mouse.move(typeBox.x + typeBox.width / 2, typeBox.y + typeBox.height / 2, { steps: 24 })
  await type.selectOption('link')
  await pause(page, 1500)

  const firstPick = page.locator('.item .pick').first()
  await moveAndClick(page, firstPick)
  await pause(page, 700)
  const deleteSelected = page.locator('#delete-selected')
  const deleteBox = await deleteSelected.boundingBox()
  if (deleteBox) await page.mouse.move(deleteBox.x + deleteBox.width / 2, deleteBox.y + deleteBox.height / 2, { steps: 30 })
  await pause(page, 1200)

  await context.close()
  await browser.close()
  if (!recordedVideo) throw new Error('没有生成网页录制文件')
  const source = await recordedVideo.path()
  const target = path.join(outputDir, 'web-tour.webm')
  fs.copyFileSync(source, target)
  process.stdout.write(target)
}

run().catch(error => {
  console.error(error)
  process.exitCode = 1
})
