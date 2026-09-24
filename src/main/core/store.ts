import { randomUUID } from 'node:crypto'
import type { Database, RunResult, Statement } from 'better-sqlite3'
import {
  DEFAULT_SETTINGS,
  type ClipboardActivity,
  type ClipboardActivityKind,
  type ClipStore,
  type ContentType,
  type DeepPartial,
  type Group,
  type NewPost,
  type Post,
  type PostPage,
  type PostQuery,
  type Rule,
  type Settings
} from '@shared/types'
import { dbPath } from './paths'
import { openDb } from './db'
import { SCHEMA_VERSION } from './schema'

                                                                               

interface PostRow {
  id: string
  hash: string
  type: string
  title: string
  preview: string
  content_path: string | null
  size: number
  source_app: string
  group_id: string | null
  tags: string
  pinned: number
  created_at: number
  last_used_at: number
  use_count: number
}

interface GroupRow {
  id: string
  name: string
  kind: string
  parent_id: string | null
  sorted: number
  created_at: number
}

interface RuleRow {
  id: string
  priority: number
  enabled: number
  matcher: string
  action: string
}

interface ActivityRow extends PostRow {
  event_id: number
  event_kind: ClipboardActivityKind
  event_at: number
  event_source_app: string
  event_precise: number
}

const CONTENT_TYPES: ContentType[] = ['text', 'image', 'link', 'file', 'folder']
const DEFAULT_LIMIT = 20
const MAX_LIMIT = 200
const SETTINGS_ROW_ID = 1

const POST_INSERT_HEAD = `INSERT INTO posts (id, hash, type, title, preview, content_path, size, source_app, group_id, tags, pinned, created_at, last_used_at, use_count)
  VALUES (@id, @hash, @type, @title, @preview, @contentPath, @size, @sourceApp, @groupId, @tags, 0, @createdAt, @lastUsedAt, 1)`
const SQL_INSERT_POST = `${POST_INSERT_HEAD}
  ON CONFLICT(hash) DO UPDATE SET last_used_at = excluded.last_used_at, use_count = use_count + 1`
const SQL_IMPORT_POST = `${POST_INSERT_HEAD} ON CONFLICT(hash) DO NOTHING`

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function parseTags(raw: string | null): string[] {
  if (!raw) return []
  try {
    const v: unknown = JSON.parse(raw)
    if (!Array.isArray(v)) return []
    return v.filter((x): x is string => typeof x === 'string')
  } catch {
    return []
  }
}

function normalizeTags(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v.filter((x): x is string => typeof x === 'string')
}

function parseJsonObject<T>(raw: string, fallback: T): T {
  try {
    const v: unknown = JSON.parse(raw)
    return isPlainObject(v) ? (v as T) : fallback
  } catch {
    return fallback
  }
}

function toPost(r: PostRow): Post {
  return {
    id: r.id,
    hash: r.hash,
    type: r.type as ContentType,
    title: r.title,
    preview: r.preview,
    contentPath: r.content_path,
    size: r.size,
    sourceApp: r.source_app,
    groupId: r.group_id,
    tags: parseTags(r.tags),
    pinned: r.pinned,
    createdAt: r.created_at,
    lastUsedAt: r.last_used_at,
    useCount: r.use_count
  }
}

function toGroup(r: GroupRow): Group {
  return {
    id: r.id,
    name: r.name,
    kind: r.kind as Group['kind'],
    parentId: r.parent_id,
    sorted: r.sorted,
    createdAt: r.created_at
  }
}

function toRule(r: RuleRow): Rule {
  return {
    id: r.id,
    priority: r.priority,
    enabled: r.enabled,
    matcher: parseJsonObject(r.matcher, {}),
    action: parseJsonObject(r.action, { groupId: '' })
  }
}

                                                  
function safeType(v: unknown): ContentType {
  if (typeof v === 'string' && (CONTENT_TYPES as string[]).includes(v)) return v as ContentType
  console.warn('[store] unknown post type, fallback to text:', v)
  return 'text'
}

                                                                                

function deepMergeObjects(
  base: Record<string, unknown>,
  patch: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base }
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue
    const cur = out[k]
    out[k] = isPlainObject(v) && isPlainObject(cur) ? deepMergeObjects(cur, v) : v
  }
  return out
}

function toRecord(v: unknown): Record<string, unknown> {
  return v as unknown as Record<string, unknown>
}

function cloneSettings(): Settings {
  return JSON.parse(JSON.stringify(DEFAULT_SETTINGS)) as Settings
}

                                                
function toFtsQuery(keyword: string): string {
  return `"${keyword.replace(/"/g, '""')}"*`
}

function normalizeLimit(limit: number | undefined): number {
  if (typeof limit !== 'number' || !Number.isFinite(limit) || limit <= 0) return DEFAULT_LIMIT
  return Math.min(Math.floor(limit), MAX_LIMIT)
}

function logErr(tag: string, e: unknown): void {
  console.error(`[store] ${tag} failed`, e)
}

                                                                                

function buildPostsSql(q: PostQuery, fetchLimit: number): { sql: string; params: unknown[] } {
  const conds: string[] = []
  const params: unknown[] = []

  const keyword = typeof q.keyword === 'string' ? q.keyword.trim() : ''
  if (keyword) {
    conds.push('p.rowid IN (SELECT rowid FROM post_fts WHERE post_fts MATCH ?)')
    params.push(toFtsQuery(keyword))
  }
  if (q.type && q.type !== 'all') {
    conds.push('p.type = ?')
    params.push(q.type)
  }
  if (q.groupId === 'none') conds.push('p.group_id IS NULL')
  else if (typeof q.groupId === 'string' && q.groupId !== 'all') {
    conds.push('p.group_id = ?')
    params.push(q.groupId)
  }
  if (q.pinned === 0 || q.pinned === 1) {
    conds.push('p.pinned = ?')
    params.push(q.pinned)
  }
  const c = q.cursor
  if (c && Number.isFinite(c.lastUsedAt) && typeof c.id === 'string') {
    conds.push('(p.last_used_at < ? OR (p.last_used_at = ? AND p.id < ?))')
    params.push(c.lastUsedAt, c.lastUsedAt, c.id)
  }

  const where = conds.length > 0 ? ` WHERE ${conds.join(' AND ')}` : ''
  return {
    sql: `SELECT p.* FROM posts p${where} ORDER BY p.last_used_at DESC, p.id DESC LIMIT ?`,
    params: [...params, fetchLimit]
  }
}

                                                                                 

interface Stmts {
  selectById: Statement<[string], PostRow>
  selectByHash: Statement<[string], PostRow>
  selectIdByHash: Statement<[string], { id: string }>
  insertPost: Statement<Record<string, unknown>, RunResult>
  importPost: Statement<Record<string, unknown>, RunResult>
  touch: Statement<[number, string], RunResult>
  delPost: Statement<[string], RunResult>
  delNoGroup: Statement<[], RunResult>
  delAll: Statement<[], RunResult>
  delBefore: Statement<[number], RunResult>
  delGroupPosts: Statement<[string], RunResult>
  ungroupPosts: Statement<[string], RunResult>
  countByType: Statement<[], { type: string; n: number }>
  insertEvent: Statement<Record<string, unknown>, RunResult>
  insertGroup: Statement<Record<string, unknown>, RunResult>
  listGroups: Statement<[], GroupRow>
  maxSorted: Statement<[], { s: number | null }>
  delGroup: Statement<[string], RunResult>
  groupExists: Statement<[string], { id: string }>
  listRules: Statement<[], RuleRow>
  upsertRule: Statement<Record<string, unknown>, RunResult>
  delRule: Statement<[string], RunResult>
  readSettings: Statement<[number], { data: string }>
  writeSettings: Statement<Record<string, unknown>, RunResult>
  upsertVector: Statement<Record<string, unknown>, RunResult>
  queryVectors: Statement<[string], { post_id: string; vec: Buffer }>
  delVectorsByPost: Statement<[string], RunResult>
  delVectorsNoGroup: Statement<[], RunResult>
  delVectorsAll: Statement<[], RunResult>
  delVectorsBefore: Statement<[number], RunResult>
  delVectorsInGroup: Statement<[string], RunResult>
}

function prepareAll(db: Database): Stmts {
  return {
    selectById: db.prepare<[string], PostRow>('SELECT * FROM posts WHERE id = ?'),
    selectByHash: db.prepare<[string], PostRow>('SELECT * FROM posts WHERE hash = ?'),
    selectIdByHash: db.prepare<[string], { id: string }>('SELECT id FROM posts WHERE hash = ?'),
    insertPost: db.prepare<Record<string, unknown>, RunResult>(SQL_INSERT_POST),
    importPost: db.prepare<Record<string, unknown>, RunResult>(SQL_IMPORT_POST),
    touch: db.prepare<[number, string], RunResult>(
      'UPDATE posts SET last_used_at = ?, use_count = use_count + 1 WHERE id = ?'
    ),
    delPost: db.prepare<[string], RunResult>('DELETE FROM posts WHERE id = ?'),
    delNoGroup: db.prepare<[], RunResult>('DELETE FROM posts WHERE group_id IS NULL'),
    delAll: db.prepare<[], RunResult>('DELETE FROM posts'),
    delBefore: db.prepare<[number], RunResult>('DELETE FROM posts WHERE last_used_at < ?'),
    delGroupPosts: db.prepare<[string], RunResult>('DELETE FROM posts WHERE group_id = ?'),
    ungroupPosts: db.prepare<[string], RunResult>(
      'UPDATE posts SET group_id = NULL WHERE group_id = ?'
    ),
    countByType: db.prepare<[], { type: string; n: number }>(
      'SELECT type, COUNT(*) AS n FROM posts GROUP BY type'
    ),
    insertEvent: db.prepare<Record<string, unknown>, RunResult>(
      `INSERT INTO clipboard_events(post_id, kind, occurred_at, source_app, precise)
       VALUES (@postId, @kind, @occurredAt, @sourceApp, @precise)`
    ),
    insertGroup: db.prepare<Record<string, unknown>, RunResult>(
      'INSERT INTO groups (id, name, kind, parent_id, sorted, created_at) VALUES (@id, @name, @kind, @parentId, @sorted, @createdAt)'
    ),
    listGroups: db.prepare<[], GroupRow>('SELECT * FROM groups ORDER BY sorted ASC, created_at ASC'),
    maxSorted: db.prepare<[], { s: number | null }>('SELECT MAX(sorted) AS s FROM groups'),
    delGroup: db.prepare<[string], RunResult>('DELETE FROM groups WHERE id = ?'),
    groupExists: db.prepare<[string], { id: string }>('SELECT id FROM groups WHERE id = ?'),
    listRules: db.prepare<[], RuleRow>('SELECT * FROM rules ORDER BY priority DESC, id ASC'),
    upsertRule: db.prepare<Record<string, unknown>, RunResult>(
      `INSERT INTO rules (id, priority, enabled, matcher, action) VALUES (@id, @priority, @enabled, @matcher, @action)
       ON CONFLICT(id) DO UPDATE SET priority = excluded.priority, enabled = excluded.enabled, matcher = excluded.matcher, action = excluded.action`
    ),
    delRule: db.prepare<[string], RunResult>('DELETE FROM rules WHERE id = ?'),
    readSettings: db.prepare<[number], { data: string }>('SELECT data FROM settings WHERE id = ?'),
    writeSettings: db.prepare<Record<string, unknown>, RunResult>(
      `INSERT INTO settings (id, data, schema_version) VALUES (@id, @data, @schemaVersion)
       ON CONFLICT(id) DO UPDATE SET data = excluded.data, schema_version = excluded.schema_version`
    ),
    upsertVector: db.prepare<Record<string, unknown>, RunResult>(
      `INSERT INTO post_vectors (post_id, model, dim, vec, updated_at) VALUES (@postId, @model, @dim, @vec, @updatedAt)
       ON CONFLICT(post_id, model) DO UPDATE SET dim = excluded.dim, vec = excluded.vec, updated_at = excluded.updated_at`
    ),
    queryVectors: db.prepare<[string], { post_id: string; vec: Buffer }>(
      'SELECT post_id, vec FROM post_vectors WHERE model = ?'
    ),
    delVectorsByPost: db.prepare<[string], RunResult>(
      'DELETE FROM post_vectors WHERE post_id = ?'
    ),
    delVectorsNoGroup: db.prepare<[], RunResult>(
      'DELETE FROM post_vectors WHERE post_id IN (SELECT id FROM posts WHERE group_id IS NULL)'
    ),
    delVectorsAll: db.prepare<[], RunResult>('DELETE FROM post_vectors'),
    delVectorsBefore: db.prepare<[number], RunResult>(
      'DELETE FROM post_vectors WHERE post_id IN (SELECT id FROM posts WHERE last_used_at < ?)'
    ),
    delVectorsInGroup: db.prepare<[string], RunResult>(
      'DELETE FROM post_vectors WHERE post_id IN (SELECT id FROM posts WHERE group_id = ?)'
    )
  }
}

                                                                              

interface Txs {
  insertPost(input: NewPost): { post: Post; created: boolean }
  importPosts(list: NewPost[]): number
  removeGroup(id: string): void
}

                                                          
function resolveGroupId(S: Stmts, groupId: string | null | undefined): string | null {
  if (!groupId) return null
  const row = S.groupExists.get(groupId)
  if (!row) console.warn('[store] group not found, post will be ungrouped:', groupId)
  return row ? groupId : null
}

function syntheticPost(input: NewPost): Post {
  const now = Date.now()
  return {
    id: randomUUID(),
    hash: input.hash,
    type: safeType(input.type),
    title: typeof input.title === 'string' ? input.title : '',
    preview: typeof input.preview === 'string' ? input.preview : '',
    contentPath: input.contentPath ?? null,
    size: typeof input.size === 'number' ? input.size : 0,
    sourceApp: typeof input.sourceApp === 'string' ? input.sourceApp : '',
    groupId: null,
    tags: normalizeTags(input.tags),
    pinned: 0,
    createdAt: now,
    lastUsedAt: now,
    useCount: 0
  }
}

   
                                                          
                                            
   
function createTxs(db: Database, S: Stmts): Txs {
  const postParams = (input: NewPost, id: string, now: number): Record<string, unknown> => ({
    id,
    hash: input.hash,
    type: safeType(input.type),
    title: typeof input.title === 'string' ? input.title : '',
    preview: typeof input.preview === 'string' ? input.preview : '',
    contentPath: input.contentPath ?? null,
    size: typeof input.size === 'number' && Number.isFinite(input.size) ? input.size : 0,
    sourceApp: typeof input.sourceApp === 'string' ? input.sourceApp : '',
    groupId: resolveGroupId(S, input.groupId),
    tags: JSON.stringify(normalizeTags(input.tags)),
    createdAt: now,
    lastUsedAt: now
  })

  return {
    insertPost: db.transaction((input: NewPost): { post: Post; created: boolean } => {
      const now = Date.now()
      const existing = S.selectIdByHash.get(input.hash)
      S.insertPost.run(postParams(input, existing?.id ?? randomUUID(), now))
      const row = S.selectByHash.get(input.hash)
      if (!row) return { post: syntheticPost(input), created: false }
      S.insertEvent.run({
        postId: row.id,
        kind: 'copy',
        occurredAt: now,
        sourceApp: input.sourceApp,
        precise: 1
      })
      return { post: toPost(row), created: !existing }
    }),
    importPosts: db.transaction((list: NewPost[]): number => {
      let inserted = 0
      for (const input of list) {
        inserted += S.importPost.run(postParams(input, randomUUID(), Date.now())).changes
      }
      return inserted
    }),
    removeGroup: db.transaction((id: string): void => {
      S.ungroupPosts.run(id)
      S.delVectorsInGroup.run(id)
      S.delGroupPosts.run(id)
      S.delGroup.run(id)
    })
  }
}

                                                                                 

   
                                     
                             
   
function createStore(db: Database | null): ClipStore {
  const S = db ? prepareAll(db) : null
  const T = db && S ? createTxs(db, S) : null

  function readSettings(): Settings {
    const row = S?.readSettings.get(SETTINGS_ROW_ID)
    if (!row) return cloneSettings()
    const parsed = parseJsonObject<Settings>(row.data, cloneSettings())
    return deepMergeObjects(toRecord(cloneSettings()), toRecord(parsed)) as unknown as Settings
  }

  return {
    dbPath,

                                                 

    insertPost(input: NewPost): { post: Post; created: boolean } {
      try {
        if (!T) return { post: syntheticPost(input), created: false }
        return T.insertPost(input)
      } catch (e) {
        logErr('insertPost', e)
        return { post: syntheticPost(input), created: false }
      }
    },

    touchPost(id: string): void {
      try {
        if (!S) return
        const now = Date.now()
        S.touch.run(now, id)
        const row = S.selectById.get(id)
        if (row) {
          S.insertEvent.run({
            postId: row.id,
            kind: 'paste',
            occurredAt: now,
            sourceApp: row.source_app,
            precise: 1
          })
        }
      } catch (e) {
        logErr('touchPost', e)
      }
    },

    queryPosts(q: PostQuery): PostPage {
      const empty: PostPage = { items: [], nextCursor: null }
      try {
        if (!db || !S) return empty
        const limit = normalizeLimit(q.limit)
        const { sql, params } = buildPostsSql(q, limit + 1)
        const rows = db.prepare<unknown[], PostRow>(sql).all(...params)
        const items = rows.slice(0, limit).map(toPost)
        if (rows.length <= limit || items.length === 0) return { items, nextCursor: null }
        const last = items[items.length - 1]
        return { items, nextCursor: { lastUsedAt: last.lastUsedAt, id: last.id } }
      } catch (e) {
        logErr('queryPosts', e)
        return empty
      }
    },

    getPost(id: string): Post | null {
      try {
        const row = S?.selectById.get(id)
        return row ? toPost(row) : null
      } catch (e) {
        logErr('getPost', e)
        return null
      }
    },

    updatePost(id: string, patch: Partial<Post>): void {
      try {
        if (!db || !S || !isPlainObject(patch)) return
        const sets: string[] = []
        const params: unknown[] = []
        const put = (col: string, v: unknown): void => {
          sets.push(`${col} = ?`)
          params.push(v)
        }
        if (patch.title !== undefined) put('title', patch.title)
        if (patch.preview !== undefined) put('preview', patch.preview)
        if (patch.contentPath !== undefined) put('content_path', patch.contentPath)
        if (patch.size !== undefined) put('size', patch.size)
        if (patch.sourceApp !== undefined) put('source_app', patch.sourceApp)
        if (patch.type !== undefined) put('type', safeType(patch.type))
        if (patch.hash !== undefined) put('hash', patch.hash)
        if (patch.tags !== undefined) put('tags', JSON.stringify(normalizeTags(patch.tags)))
        if (patch.groupId !== undefined) put('group_id', resolveGroupId(S, patch.groupId))
        if (patch.pinned !== undefined) {
          put('pinned', patch.pinned ? 1 : 0)
                                                               
          if (patch.pinned) put('last_used_at', Date.now())
        }
        if (sets.length === 0) return
        params.push(id)
        db.prepare(`UPDATE posts SET ${sets.join(', ')} WHERE id = ?`).run(...params)
      } catch (e) {
        logErr('updatePost', e)
      }
    },

    removePost(id: string): void {
      try {
        S?.delVectorsByPost.run(id)
        S?.delPost.run(id)
      } catch (e) {
        logErr('removePost', e)
      }
    },

    removePostsNoGroup(): void {
      try {
        S?.delVectorsNoGroup.run()
        S?.delNoGroup.run()
      } catch (e) {
        logErr('removePostsNoGroup', e)
      }
    },

    clearHistory(): void {
      try {
        S?.delVectorsAll.run()
        S?.delAll.run()
      } catch (e) {
        logErr('clearHistory', e)
      }
    },

    clearHistoryBefore(ms: number): number {
      try {
        if (!S || !Number.isFinite(ms)) return 0
        S.delVectorsBefore.run(ms)
        return S.delBefore.run(ms).changes
      } catch (e) {
        logErr('clearHistoryBefore', e)
        return 0
      }
    },

    countByType(): Record<ContentType, number> {
      const out = {} as Record<ContentType, number>
      for (const t of CONTENT_TYPES) out[t] = 0
      try {
        for (const row of S?.countByType.all() ?? []) {
          if ((CONTENT_TYPES as string[]).includes(row.type)) out[row.type as ContentType] = row.n
        }
      } catch (e) {
        logErr('countByType', e)
      }
      return out
    },

    queryActivity(from: number, to: number): ClipboardActivity[] {
      try {
        if (!db || !Number.isFinite(from) || !Number.isFinite(to) || from >= to) return []
        const rows = db.prepare<[number, number], ActivityRow>(
          `SELECT p.*, e.id AS event_id, e.kind AS event_kind, e.occurred_at AS event_at,
                  e.source_app AS event_source_app, e.precise AS event_precise
           FROM clipboard_events e JOIN posts p ON p.id = e.post_id
           WHERE e.occurred_at >= ? AND e.occurred_at < ?
           ORDER BY e.occurred_at ASC, e.id ASC`
        ).all(from, to)
        return rows.map(row => ({
          id: row.event_id,
          post: toPost(row),
          kind: row.event_kind,
          occurredAt: row.event_at,
          sourceApp: row.event_source_app,
          precise: row.event_precise === 1
        }))
      } catch (e) {
        logErr('queryActivity', e)
        return []
      }
    },

    importPosts(posts: NewPost[]): number {
      try {
        if (!T || !Array.isArray(posts)) return 0
        return T.importPosts(posts)
      } catch (e) {
        logErr('importPosts', e)
        return 0
      }
    },

                                                  

    createGroup(name?: string, kind?: Group['kind']): Group {
      try {
        if (!S) throw new Error('store unavailable')
        const g: Group = {
          id: randomUUID(),
          name: typeof name === 'string' && name.trim() ? name : '新分组',
          kind: kind ?? 'manual',
          parentId: null,
          sorted: (S.maxSorted.get()?.s ?? -1) + 1,
          createdAt: Date.now()
        }
        S.insertGroup.run({
          id: g.id,
          name: g.name,
          kind: g.kind,
          parentId: g.parentId,
          sorted: g.sorted,
          createdAt: g.createdAt
        })
        return g
      } catch (e) {
        logErr('createGroup', e)
        return {
          id: randomUUID(),
          name: typeof name === 'string' && name.trim() ? name : '新分组',
          kind: kind ?? 'manual',
          parentId: null,
          sorted: 0,
          createdAt: Date.now()
        }
      }
    },

    listGroups(): Group[] {
      try {
        return (S?.listGroups.all() ?? []).map(toGroup)
      } catch (e) {
        logErr('listGroups', e)
        return []
      }
    },

    updateGroup(id: string, patch: Partial<Group>): void {
      try {
        if (!db || !S || !isPlainObject(patch)) return
        const sets: string[] = []
        const params: unknown[] = []
        const put = (col: string, v: unknown): void => {
          sets.push(`${col} = ?`)
          params.push(v)
        }
        if (patch.name !== undefined) put('name', patch.name)
        if (patch.kind !== undefined) put('kind', patch.kind)
        if (patch.parentId !== undefined) put('parent_id', patch.parentId)
        if (patch.sorted !== undefined) put('sorted', patch.sorted)
        if (sets.length === 0) return
        params.push(id)
        db.prepare(`UPDATE groups SET ${sets.join(', ')} WHERE id = ?`).run(...params)
      } catch (e) {
        logErr('updateGroup', e)
      }
    },

    removeGroup(id: string): void {
      try {
        T?.removeGroup(id)
      } catch (e) {
        logErr('removeGroup', e)
      }
    },

    clearGroup(id: string): void {
      try {
        S?.delVectorsInGroup.run(id)
        S?.delGroupPosts.run(id)
      } catch (e) {
        logErr('clearGroup', e)
      }
    },

    movePostsToGroup(ids: string[], groupId: string | null): void {
      try {
        if (!db || !S || !Array.isArray(ids) || ids.length === 0) return
        const gid = resolveGroupId(S, groupId)
        const placeholders = ids.map(() => '?').join(', ')
        db.prepare(`UPDATE posts SET group_id = ? WHERE id IN (${placeholders})`).run(gid, ...ids)
      } catch (e) {
        logErr('movePostsToGroup', e)
      }
    },

                                                 

    listRules(): Rule[] {
      try {
        return (S?.listRules.all() ?? []).map(toRule)
      } catch (e) {
        logErr('listRules', e)
        return []
      }
    },

    upsertRule(rule: Rule): void {
      try {
        S?.upsertRule.run({
          id: rule.id,
          priority: rule.priority,
          enabled: rule.enabled ? 1 : 0,
          matcher: JSON.stringify(rule.matcher ?? {}),
          action: JSON.stringify(rule.action ?? { groupId: '' })
        })
      } catch (e) {
        logErr('upsertRule', e)
      }
    },

    removeRule(id: string): void {
      try {
        S?.delRule.run(id)
      } catch (e) {
        logErr('removeRule', e)
      }
    },

                                                    

    getSettings(): Settings {
      try {
        return readSettings()
      } catch (e) {
        logErr('getSettings', e)
        return cloneSettings()
      }
    },

    saveSettings(patch: DeepPartial<Settings>): Settings {
      try {
        const next = deepMergeObjects(
          toRecord(readSettings()),
          toRecord(patch)
        ) as unknown as Settings
        S?.writeSettings.run({
          id: SETTINGS_ROW_ID,
          data: JSON.stringify(next),
          schemaVersion: SCHEMA_VERSION
        })
        return next
      } catch (e) {
        logErr('saveSettings', e)
        return cloneSettings()
      }
    },

                                                                       

    upsertVector(postId: string, model: string, vec: Float32Array): void {
      try {
        if (!vec || vec.length === 0) return
        S?.upsertVector.run({
          postId,
          model,
          dim: vec.length,
          vec: Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength),
          updatedAt: Date.now()
        })
      } catch (e) {
        logErr('upsertVector', e)
      }
    },

    queryVectors(model: string): Array<{ postId: string; vec: Float32Array }> {
      try {
        const rows = S?.queryVectors.all(model) ?? []
        return rows.map((r) => ({
          postId: r.post_id,
                                                        
          vec: new Float32Array(new Uint8Array(r.vec).buffer)
        }))
      } catch (e) {
        logErr('queryVectors', e)
        return []
      }
    },

                                                       

    vacuum(): void {
      try {
        db?.pragma('auto_vacuum = INCREMENTAL')
        db?.pragma('incremental_vacuum')
      } catch (e) {
        logErr('vacuum', e)
      }
    },

    close(): void {
      try {
        db?.close()
      } catch (e) {
        logErr('close', e)
      }
    }
  }
}

                                                                              

let singleton: ClipStore | null = null

                                                        
export function initStore(): ClipStore {
  if (singleton) return singleton
  const db = openDb()
  singleton = createStore(db)
  return singleton
}
