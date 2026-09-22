   
                                                                        
  
                                              
  
                                                                                
                                                                             
                                                                     
                                                               
                                    
   
const { app } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..', '..', '..')
const BUILD = path.join(__dirname, '.store-test-build')
const OUT = path.join(ROOT, 'store-test-result.txt')

app.setPath('userData', path.join(BUILD, 'userdata'))

const lines = []
let pass = 0
let fail = 0

function ok(cond, name, extra) {
  if (cond) {
    pass++
    lines.push('PASS  ' + name)
  } else {
    fail++
    lines.push('FAIL  ' + name + (extra === undefined ? '' : '  -> ' + safeJson(extra)))
  }
}

function info(s) {
  lines.push('  ..  ' + s)
}

function safeJson(v) {
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}

                                                                                  

function compileSources() {
  const ts = require('typescript')
  fs.rmSync(BUILD, { recursive: true, force: true })
  fs.mkdirSync(path.join(BUILD, 'core'), { recursive: true })
  fs.mkdirSync(path.join(BUILD, 'node_modules', '@shared'), { recursive: true })
  const files = [
    ['src/shared/types.ts', 'types.js'],
    ['src/main/core/paths.ts', 'core/paths.js'],
    ['src/main/core/schema.ts', 'core/schema.js'],
    ['src/main/core/db.ts', 'core/db.js'],
    ['src/main/core/store.ts', 'core/store.js']
  ]
  const opts = {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    esModuleInterop: true,
    newLine: ts.NewLineKind.LineFeed
  }
  for (const [src, out] of files) {
    const text = fs.readFileSync(path.join(ROOT, src), 'utf8')
    const res = ts.transpileModule(text, { compilerOptions: opts, fileName: src })
    const syntactic = (res.diagnostics || []).filter((d) => d.category === 1)
    if (syntactic.length > 0) {
      throw new Error('transpile ' + src + ': ' + ts.flattenDiagnosticMessageText(syntactic[0].messageText, ' '))
    }
    fs.writeFileSync(path.join(BUILD, out), res.outputText)
  }
                                                             
  fs.writeFileSync(
    path.join(BUILD, 'node_modules', '@shared', 'types.js'),
    "module.exports = require('../../types.js')\n"
  )
}

                                                                       

const DAY = 86400000

function newPost(hash, title, preview, type) {
  return {
    hash,
    type: type || 'text',
    title,
    preview: preview || title,
    contentPath: null,
    size: 12,
    sourceApp: 'store.test',
    groupId: null,
    tags: ['t1']
  }
}

function runTests(store, raw) {
                                           
  const objects = raw
    .prepare("SELECT name FROM sqlite_master WHERE type IN ('table','trigger','index')")
    .all()
    .map((r) => r.name)
  for (const t of ['posts', 'groups', 'rules', 'settings', 'post_vectors', 'post_fts', 'clipboard_events', '_meta']) {
    ok(objects.includes(t), 'schema: object exists -> ' + t)
  }
  for (const tr of ['posts_fts_ai', 'posts_fts_ad', 'posts_fts_au']) {
    ok(objects.includes(tr), 'schema: fts trigger -> ' + tr)
  }
  for (const ix of ['idx_posts_last_used', 'idx_posts_group_id', 'idx_posts_type', 'idx_posts_pinned', 'idx_posts_group_used', 'idx_posts_type_used', 'idx_posts_pin_used']) {
    ok(objects.includes(ix), 'schema: index -> ' + ix)
  }
  for (const ix of ['idx_events_time', 'idx_events_post']) {
    ok(objects.includes(ix), 'schema: activity index -> ' + ix)
  }
  const plans = [
    ['type', "SELECT * FROM posts WHERE type = 'text' ORDER BY last_used_at DESC, id DESC LIMIT 20", 'idx_posts_type_used'],
    ['group', "SELECT * FROM posts WHERE group_id = 'g1' ORDER BY last_used_at DESC, id DESC LIMIT 20", 'idx_posts_group_used'],
    ['pin', 'SELECT * FROM posts WHERE pinned = 1 ORDER BY last_used_at DESC, id DESC LIMIT 20', 'idx_posts_pin_used']
  ]
  for (const [name, sql, expected] of plans) {
    const detail = raw.prepare('EXPLAIN QUERY PLAN ' + sql).all().map((row) => row.detail).join(' | ')
    ok(detail.includes(expected) && !detail.includes('TEMP B-TREE'), 'query plan: ' + name + ' filter uses ordered index', detail)
  }
  const meta = raw.prepare("SELECT value FROM _meta WHERE key = 'schema_version'").get()
  ok(!!meta && meta.value === '3', 'schema: _meta.schema_version = 3', meta)
                                                                     
  const { openDb } = require(path.join(BUILD, 'core', 'db.js'))
  const pragmaDb = openDb(path.join(BUILD, 'pragma-probe.db'))
  ok(String(pragmaDb.pragma('journal_mode')[0].journal_mode).toLowerCase() === 'wal', 'pragma: journal_mode = WAL')
  ok(Number(pragmaDb.pragma('foreign_keys')[0].foreign_keys) === 1, 'pragma: foreign_keys = ON')
  ok(Number(pragmaDb.pragma('busy_timeout')[0].timeout) === 3000, 'pragma: busy_timeout = 3000')
  ok(Number(pragmaDb.pragma('synchronous')[0].synchronous) === 1, 'pragma: synchronous = NORMAL')
  ok(Number(pragmaDb.pragma('auto_vacuum')[0].auto_vacuum) === 2, 'pragma: auto_vacuum = INCREMENTAL')
  pragmaDb.close()
  ok(String(raw.pragma('journal_mode')[0].journal_mode).toLowerCase() === 'wal', 'pragma: store db file is in WAL mode')
  info('dbPath = ' + store.dbPath)

                        
  const r1 = store.insertPost(newPost('h1', '剪巢 剪贴板', 'preview-one'))
  ok(r1.created === true && r1.post.useCount === 1 && r1.post.id.length > 0, 'insertPost: first insert created', r1)
  const r2 = store.insertPost(Object.assign(newPost('h1', '另一个标题', 'preview-two'), { sourceApp: 'Second App' }))
  ok(r2.created === false, 'insertPost: duplicate hash -> created=false', r2)
  ok(r2.post.id === r1.post.id, 'insertPost: duplicate keeps same id')
  ok(r2.post.useCount === 2, 'insertPost: use_count + 1 on conflict', r2.post.useCount)
  ok(r2.post.title === '剪巢 剪贴板', 'insertPost: title not overwritten on conflict', r2.post.title)
  ok(r2.post.lastUsedAt >= r1.post.lastUsedAt, 'insertPost: last_used_at refreshed on conflict')
  ok(raw.prepare('SELECT COUNT(*) c FROM posts').get().c === 1, 'insertPost: no duplicate row in table')
  const copyEvents = store.queryActivity(Date.now() - 5000, Date.now() + 5000).filter((e) => e.post.id === r1.post.id)
  ok(copyEvents.length === 2 && copyEvents.every((e) => e.kind === 'copy' && e.precise), 'activity: every copy recorded precisely', copyEvents)
  ok(copyEvents.some((e) => e.sourceApp === 'Second App'), 'activity: duplicate copy keeps current source app', copyEvents)
  const ftsUpdateSql = raw.prepare("SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = 'posts_fts_au'").get().sql
  ok(/UPDATE OF title, preview/i.test(ftsUpdateSql), 'fts: usage-only updates do not rebuild full-text index', ftsUpdateSql)
  const rGhost = store.insertPost(Object.assign(newPost('h-ghost', 'ghost group post', 'p'), { groupId: 'no-such-group' }))
  ok(rGhost.created === true && rGhost.post.groupId === null, 'insertPost: unknown groupId falls back to null (no throw)')

                  
  store.insertPost(newPost('h2', 'hello world', 'english text'))
  store.insertPost(newPost('h3', '剪贴板管理器', 'chinese preview'))
  const f1 = store.queryPosts({ keyword: '剪' })
  ok(f1.items.length === 2, 'fts: keyword "剪" prefix matches 2', f1.items.map((p) => p.title))
  const f2 = store.queryPosts({ keyword: '剪贴板' })
  ok(f2.items.length === 2, 'fts: keyword "剪贴板" matches 2', f2.items.map((p) => p.title))
  const f3 = store.queryPosts({ keyword: 'hello' })
  ok(f3.items.length === 1 && f3.items[0].hash === 'h2', 'fts: keyword "hello" matches h2', f3.items.map((p) => p.hash))
  const f4 = store.queryPosts({ keyword: 'zzz-not-exist' })
  ok(f4.items.length === 0, 'fts: no match returns empty')
  let f5 = null
  try {
    f5 = store.queryPosts({ keyword: 'quo"te' })
  } catch (e) {
    f5 = { threw: e.message }
  }
  ok(f5 !== null && !f5.threw && Array.isArray(f5.items), 'fts: quote inside keyword does not throw', f5 && f5.threw)
  ok(store.queryPosts({ keyword: '   ' }).items.length === raw.prepare('SELECT COUNT(*) c FROM posts').get().c, 'fts: blank keyword ignored')

  store.updatePost(r1.post.id, { title: 'renamed-title-xyz' })
  ok(!store.queryPosts({ keyword: '剪巢' }).items.some((p) => p.id === r1.post.id), 'fts: old keyword gone after updatePost')
  ok(store.queryPosts({ keyword: 'renamed' }).items.some((p) => p.id === r1.post.id), 'fts: new keyword found after updatePost')

                      
  store.clearHistory()
  ok(raw.prepare('SELECT COUNT(*) c FROM posts').get().c === 0, 'clearHistory empties posts')
  const now = Date.now()
  const pageIds = []
  for (let i = 0; i < 7; i++) pageIds.push(store.insertPost(newPost('k' + i, 'page-' + i, 'pp')).post.id)
                                           
  const stamps = [now - 6000, now - 5000, now - 4000, now - 4000, now - 2000, now - 1000, now]
  const upd = raw.prepare('UPDATE posts SET last_used_at = ? WHERE id = ?')
  for (let i = 0; i < pageIds.length; i++) upd.run(stamps[i], pageIds[i])

  const seen = []
  let cursor = null
  let pages = 0
  for (;;) {
    const page = store.queryPosts({ limit: 3, cursor })
    pages++
    seen.push(...page.items.map((p) => p.id))
    if (!page.nextCursor) break
    cursor = page.nextCursor
    if (pages > 12) break
  }
  ok(seen.length === 7 && new Set(seen).size === 7, 'keyset: paging visits every post exactly once', {
    seen: seen.length,
    unique: new Set(seen).size,
    pages
  })
  const ordered = store.queryPosts({ limit: 20 }).items.map((p) => p.lastUsedAt)
  ok(ordered.every((v, i) => i === 0 || ordered[i - 1] >= v), 'keyset: default order last_used_at DESC', ordered)
  const p1 = store.queryPosts({ limit: 2 })
  const p2 = store.queryPosts({ limit: 2, cursor: p1.nextCursor })
  ok(p1.items.length === 2 && p1.nextCursor !== null, 'keyset: page1 returns nextCursor')
  ok(p2.items.length === 2 && p2.items[0].id !== p1.items[0].id, 'keyset: page2 continues after cursor')
  ok(store.queryPosts({}).items.length === 7, 'queryPosts: default limit 20')
  ok(store.queryPosts({ limit: -1 }).items.length === 7, 'queryPosts: invalid limit falls back to 20')
  ok(store.queryPosts({ limit: 9999 }).items.length === 7, 'queryPosts: oversized limit clamped, no crash')

                       
  const s0 = store.getSettings()
  ok(s0.clipboard.theme === 'light' && s0.shortcutKeys.showOrHide.length > 0, 'settings: defaults returned before any write', s0.clipboard)
  const s1 = store.saveSettings({ clipboard: { theme: 'dark' } })
  ok(s1.clipboard.theme === 'dark', 'settings: saveSettings applies patch')
  ok(s1.clipboard.sounds.open === true && s1.shortcutKeys.showOrHide === s0.shortcutKeys.showOrHide, 'settings: untouched branches preserved')
  ok(s1.general.historyCache === s0.general.historyCache && s1.width === 0, 'settings: full Settings returned (not partial)')
  const s2 = store.saveSettings({ clipboard: { sounds: { open: false } } })
  ok(s2.clipboard.theme === 'dark', 'settings: deep merge keeps previous nested value')
  ok(s2.clipboard.sounds.open === false, 'settings: deep merge writes new nested value')
  const s3 = store.saveSettings({})
  ok(s3.clipboard.theme === 'dark' && s3.clipboard.sounds.open === false, 'settings: empty patch is a no-op')
  const g1 = store.getSettings()
  ok(g1.clipboard.theme === 'dark', 'settings: getSettings reads back persisted value')
  ok(g1 !== s3 && g1.clipboard !== s3.clipboard, 'settings: returns fresh object, not shared reference')
  const sRow = raw.prepare('SELECT data, schema_version v FROM settings WHERE id = 1').get()
  ok(!!sRow && sRow.v === 3 && JSON.parse(sRow.data).clipboard.theme === 'dark', 'settings: single row persisted with schema version', sRow && sRow.v)

                             
  const old1 = store.insertPost(newPost('old-1', 'expired-post-aaa', 'x'))
  const old2 = store.insertPost(newPost('old-2', 'expired-post-bbb', 'x'))
  const fresh = store.insertPost(newPost('fresh-1', 'fresh-post-ccc', 'x'))
  const cut = Date.now() - 5 * DAY
  upd.run(Date.now() - 10 * DAY, old1.post.id)
  upd.run(Date.now() - 10 * DAY, old2.post.id)
  const removed = store.clearHistoryBefore(cut)
  ok(removed === 2, 'clearHistoryBefore: returns deleted count', removed)
  ok(store.getPost(old1.post.id) === null && store.getPost(old2.post.id) === null, 'clearHistoryBefore: old posts gone')
  ok(store.getPost(fresh.post.id) !== null, 'clearHistoryBefore: fresh post kept')
  ok(store.queryPosts({ keyword: 'expired' }).items.length === 0, 'clearHistoryBefore: fts entries removed with posts')
  ok(store.clearHistoryBefore(Number.NaN) === 0, 'clearHistoryBefore: invalid arg returns 0')

                                                         
  const gA = store.createGroup('测试分组甲')
  const gB = store.createGroup()
  ok(!!gA.id && gA.name === '测试分组甲' && gA.sorted === 0, 'createGroup: named group sorted 0')
  ok(gB.sorted === 1 && gB.name === '新分组', 'createGroup: default name and sorted increment', gB)
  store.movePostsToGroup([fresh.post.id], gA.id)
  ok(store.getPost(fresh.post.id).groupId === gA.id, 'movePostsToGroup: post moved')
  ok(store.queryPosts({ groupId: gA.id }).items.length === 1, 'queryPosts: filter by groupId')
  ok(!store.queryPosts({ groupId: 'none' }).items.some((p) => p.id === fresh.post.id), "queryPosts: groupId 'none' excludes grouped post")
  store.removeGroup(gA.id)
  ok(store.listGroups().length === 1, 'removeGroup: group deleted')
  ok(store.getPost(fresh.post.id) !== null && store.getPost(fresh.post.id).groupId === null, 'removeGroup: posts kept and ungrouped')

  store.insertPost(newPost('img-1', 'an image', 'i', 'image'))
  const byType = store.countByType()
  ok(byType.image === 1 && byType.text > 0 && byType.link === 0 && byType.file === 0 && byType.folder === 0, 'countByType: grouped counts', byType)

  const beforeImport = raw.prepare('SELECT COUNT(*) c FROM posts').get().c
  const imported = store.importPosts([newPost('imp-1', 'imported one', 'i'), newPost('imp-1', 'imported dup', 'i')])
  ok(imported === 1, 'importPosts: duplicate hash skipped, returns inserted count', imported)
  ok(raw.prepare('SELECT COUNT(*) c FROM posts').get().c === beforeImport + 1, 'importPosts: exactly one row added')

  store.upsertVector(fresh.post.id, 'bge-small-zh-v1.5', new Float32Array([1, 2, 3, 4]))
  const v1 = store.queryVectors('bge-small-zh-v1.5')
  ok(v1.length === 1 && v1[0].postId === fresh.post.id && v1[0].vec.length === 4 && v1[0].vec[3] === 4, 'vectors: upsert + query roundtrip', v1.length)
  store.upsertVector(fresh.post.id, 'bge-small-zh-v1.5', new Float32Array([9, 8]))
  const v2 = store.queryVectors('bge-small-zh-v1.5')
  ok(v2.length === 1 && v2[0].vec.length === 2 && v2[0].vec[0] === 9, 'vectors: upsert overwrites same (postId, model)', v2[0] && v2[0].vec.length)
  ok(store.queryVectors('other-model').length === 0, 'vectors: query by model filters')

  const t0 = store.getPost(fresh.post.id)
  store.touchPost(fresh.post.id)
  const t1 = store.getPost(fresh.post.id)
  ok(t1.useCount === t0.useCount + 1 && t1.lastUsedAt >= t0.lastUsedAt, 'touchPost: use_count + 1 and last_used_at refreshed')
  const pasteEvents = store.queryActivity(Date.now() - 5000, Date.now() + 5000).filter((e) => e.post.id === fresh.post.id && e.kind === 'paste')
  ok(pasteEvents.length === 1 && pasteEvents[0].precise, 'activity: paste recorded precisely', pasteEvents)

                                      
  store.clearHistory()
  const repeatInput = newPost('repeat-long-run', '长期重复内容', 'same payload')
  const repeatStarted = Date.now()
  for (let i = 0; i < 5000; i++) store.insertPost(repeatInput)
  const repeatPosts = raw.prepare('SELECT COUNT(*) c FROM posts WHERE hash = ?').get(repeatInput.hash).c
  const repeatFts = raw.prepare('SELECT COUNT(*) c FROM post_fts').get().c
  const repeatEvents = raw.prepare('SELECT COUNT(*) c FROM clipboard_events').get().c
  ok(repeatPosts === 1, 'long-run: 5000 duplicate copies keep one content row', repeatPosts)
  ok(repeatFts === 1, 'long-run: 5000 duplicate copies keep one full-text row', repeatFts)
  ok(repeatEvents === 5000, 'long-run: 5000 duplicate copies preserve activity count', repeatEvents)
  info('5000 duplicate copies elapsed = ' + (Date.now() - repeatStarted) + 'ms')

                       
  const schema = require(path.join(BUILD, 'core', 'schema.js'))
  const db2 = new (require('better-sqlite3'))(store.dbPath)
  let migrateTwice = 'ok'
  try {
    schema.migrate(db2)
    schema.migrate(db2)
  } catch (e) {
    migrateTwice = e.message
  }
  ok(migrateTwice === 'ok', 'migrate: repeated migrate() is a no-op', migrateTwice)
  ok(db2.prepare("SELECT value FROM _meta WHERE key = 'schema_version'").get().value === '3', 'migrate: version still 3')
  ok(db2.prepare('SELECT COUNT(*) c FROM posts').get().c === raw.prepare('SELECT COUNT(*) c FROM posts').get().c, 'migrate: data untouched')
  db2.close()

  ok(store.getPost('does-not-exist') === null, 'getPost: missing id returns null')
  let resilience = 'ok'
  try {
    store.updatePost('does-not-exist', { title: 'x' })
    store.removePost('does-not-exist')
    store.removePostsNoGroup()
    store.touchPost('does-not-exist')
    store.upsertRule({ id: 'r1', priority: 1, enabled: 1, matcher: { app: 'code' }, action: { groupId: 'g' } })
    store.upsertRule({ id: 'r1', priority: 2, enabled: 0, matcher: { app: 'code2' }, action: { groupId: 'g2' } })
    const rules = store.listRules()
    if (rules.length !== 1 || rules[0].priority !== 2 || rules[0].matcher.app !== 'code2') resilience = 'rule upsert broken'
    store.removeRule('r1')
    if (store.listRules().length !== 0) resilience = 'rule remove broken'
    store.vacuum()
  } catch (e) {
    resilience = e.message
  }
  ok(resilience === 'ok', 'resilience: no-op/unknown ids and rule upsert do not throw', resilience)
}

                                                                      

app.whenReady().then(() => {
  const started = Date.now()
  let store = null
  let raw = null
  try {
    compileSources()
    const mod = require(path.join(BUILD, 'core', 'store.js'))
    store = mod.initStore()
    ok(typeof store.dbPath === 'string' && store.dbPath.endsWith('clipnest.db'), 'initStore: returns store with dbPath')
    ok(store.dbPath.includes('.store-test-build'), 'initStore: uses redirected userData (real APPDATA untouched)')
    raw = new (require('better-sqlite3'))(store.dbPath)
    runTests(store, raw)
  } catch (e) {
    fail++
    lines.push('FAIL  fatal: ' + (e && e.stack ? e.stack : String(e)))
  } finally {
    try {
      raw && raw.close()
    } catch {}
    try {
      store && store.close()
    } catch {}
    try {
      fs.rmSync(BUILD, { recursive: true, force: true })
    } catch {}
    lines.push('')
    lines.push('---- summary ----')
    lines.push('electron ' + process.versions.electron + ' / node ' + process.versions.node + ' / sqlite ' + require('better-sqlite3/package.json').version)
    lines.push('pass=' + pass + ' fail=' + fail + ' elapsed=' + (Date.now() - started) + 'ms')
    fs.writeFileSync(OUT, lines.join('\n') + '\n')
    app.exit(fail === 0 ? 0 : 1)
  }
})
