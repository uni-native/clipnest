import type { Database } from 'better-sqlite3'
   
                                                 
                                      
   
export const SCHEMA_VERSION = 3

   
                                    
                                
   
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS groups (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  kind       TEXT NOT NULL DEFAULT 'manual',
  parent_id  TEXT,
  sorted     INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS posts (
  id           TEXT PRIMARY KEY,
  hash         TEXT NOT NULL UNIQUE,
  type         TEXT NOT NULL,
  title        TEXT NOT NULL DEFAULT '',
  preview      TEXT NOT NULL DEFAULT '',
  content_path TEXT,
  size         INTEGER NOT NULL DEFAULT 0,
  source_app   TEXT NOT NULL DEFAULT '',
  group_id     TEXT REFERENCES groups(id) ON DELETE SET NULL,
  tags         TEXT NOT NULL DEFAULT '[]',
  pinned       INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL,
  use_count    INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_posts_last_used ON posts(last_used_at DESC, id);
CREATE INDEX IF NOT EXISTS idx_posts_group_id   ON posts(group_id);
CREATE INDEX IF NOT EXISTS idx_posts_type       ON posts(type);
CREATE INDEX IF NOT EXISTS idx_posts_pinned     ON posts(pinned);
CREATE INDEX IF NOT EXISTS idx_posts_group_used ON posts(group_id, last_used_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_posts_type_used  ON posts(type, last_used_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_posts_pin_used   ON posts(pinned, last_used_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS rules (
  id       TEXT PRIMARY KEY,
  priority INTEGER NOT NULL DEFAULT 0,
  enabled  INTEGER NOT NULL DEFAULT 1,
  matcher  TEXT NOT NULL DEFAULT '{}',
  action   TEXT NOT NULL DEFAULT '{}'
);

/* 单行设置：data 为完整 Settings JSON */
CREATE TABLE IF NOT EXISTS settings (
  id             INTEGER PRIMARY KEY CHECK (id = 1),
  data           TEXT NOT NULL,
  schema_version INTEGER NOT NULL DEFAULT 1
);

/* IntelligenceHub 向量预留：post_id + model 为主键，vec 为 float32 小端 BLOB */
CREATE TABLE IF NOT EXISTS post_vectors (
  post_id    TEXT NOT NULL,
  model      TEXT NOT NULL,
  dim        INTEGER NOT NULL DEFAULT 0,
  vec        BLOB NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (post_id, model)
);

/* 逐次活动用于每日分析；旧库回填事件 precise=0，表示只按最后使用时间估算 */
CREATE TABLE IF NOT EXISTS clipboard_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id     TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('copy', 'paste')),
  occurred_at INTEGER NOT NULL,
  source_app  TEXT NOT NULL DEFAULT '',
  precise     INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_events_time ON clipboard_events(occurred_at DESC, id);
CREATE INDEX IF NOT EXISTS idx_events_post ON clipboard_events(post_id, occurred_at DESC);

/* FTS5 空 content 模式：不冗余存 title/preview 原文，靠下面的触发器同步 */
CREATE VIRTUAL TABLE IF NOT EXISTS post_fts USING fts5(title, preview, content='');

CREATE TRIGGER IF NOT EXISTS posts_fts_ai AFTER INSERT ON posts BEGIN
  INSERT INTO post_fts(rowid, title, preview) VALUES (new.rowid, new.title, new.preview);
END;

CREATE TRIGGER IF NOT EXISTS posts_fts_ad AFTER DELETE ON posts BEGIN
  INSERT INTO post_fts(post_fts, rowid, title, preview)
  VALUES ('delete', old.rowid, old.title, old.preview);
END;

CREATE TRIGGER IF NOT EXISTS posts_fts_au AFTER UPDATE OF title, preview ON posts BEGIN
  INSERT INTO post_fts(post_fts, rowid, title, preview)
  VALUES ('delete', old.rowid, old.title, old.preview);
  INSERT INTO post_fts(rowid, title, preview) VALUES (new.rowid, new.title, new.preview);
END;
`

interface Migration {
  version: number
  up(db: Database): void
}

const MIGRATIONS: Migration[] = [
  { version: 1, up: (db) => db.exec(SCHEMA_SQL) },
  {
    version: 2,
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS clipboard_events (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          post_id     TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
          kind        TEXT NOT NULL CHECK (kind IN ('copy', 'paste')),
          occurred_at INTEGER NOT NULL,
          source_app  TEXT NOT NULL DEFAULT '',
          precise     INTEGER NOT NULL DEFAULT 1
        );
        CREATE INDEX IF NOT EXISTS idx_events_time ON clipboard_events(occurred_at DESC, id);
        CREATE INDEX IF NOT EXISTS idx_events_post ON clipboard_events(post_id, occurred_at DESC);
        INSERT INTO clipboard_events(post_id, kind, occurred_at, source_app, precise)
        SELECT id, 'copy', last_used_at, source_app, 0 FROM posts
        WHERE NOT EXISTS (SELECT 1 FROM clipboard_events);
      `)
    },
  },
  {
    version: 3,
    up: (db) => {
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_posts_group_used ON posts(group_id, last_used_at DESC, id DESC);
        CREATE INDEX IF NOT EXISTS idx_posts_type_used ON posts(type, last_used_at DESC, id DESC);
        CREATE INDEX IF NOT EXISTS idx_posts_pin_used ON posts(pinned, last_used_at DESC, id DESC);
        DROP TRIGGER IF EXISTS posts_fts_au;
        CREATE TRIGGER posts_fts_au AFTER UPDATE OF title, preview ON posts BEGIN
          INSERT INTO post_fts(post_fts, rowid, title, preview)
          VALUES ('delete', old.rowid, old.title, old.preview);
          INSERT INTO post_fts(rowid, title, preview) VALUES (new.rowid, new.title, new.preview);
        END;
      `)
    },
  },
]

                                           
export function readSchemaVersion(db: Database): number {
  const row = db
    .prepare("SELECT value FROM _meta WHERE key = 'schema_version'")
    .get() as { value: string } | undefined
  const v = row ? Number.parseInt(row.value, 10) : 0
  return Number.isFinite(v) && v > 0 ? v : 0
}

function writeSchemaVersion(db: Database, version: number): void {
  db.prepare(
    `INSERT INTO _meta (key, value) VALUES ('schema_version', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(String(version))
}

   
                                                 
                         
   
export function migrate(db: Database): void {
  db.exec('CREATE TABLE IF NOT EXISTS _meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
  let current = readSchemaVersion(db)
  if (current >= SCHEMA_VERSION) return
  for (const m of MIGRATIONS) {
    if (m.version <= current) continue
    m.up(db)
    writeSchemaVersion(db, m.version)
    current = m.version
  }
}
