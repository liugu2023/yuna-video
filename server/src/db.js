import { DatabaseSync } from 'node:sqlite'
import bcrypt from 'bcryptjs'
import fs from 'node:fs'
import path from 'node:path'
import config from './config.js'

fs.mkdirSync(config.dataDir, { recursive: true })
fs.mkdirSync(path.join(config.uploadDir, 'videos'), { recursive: true })
fs.mkdirSync(path.join(config.uploadDir, 'covers'), { recursive: true })

const db = new DatabaseSync(path.join(config.dataDir, 'yuna-video.db'))
db.exec('PRAGMA journal_mode = WAL;')

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  nickname      TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'member',   -- member | reviewer | admin
  status        TEXT NOT NULL DEFAULT 'active',   -- active | disabled
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS videos (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL,
  title         TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  tags          TEXT NOT NULL DEFAULT '[]',       -- JSON 数组字符串
  category      TEXT NOT NULL DEFAULT '',
  cover_path    TEXT NOT NULL DEFAULT '',
  video_path    TEXT NOT NULL DEFAULT '',
  video_name    TEXT NOT NULL DEFAULT '',
  video_size    INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'draft',    -- draft|pending|approved|rejected|published
  reject_reason TEXT NOT NULL DEFAULT '',
  bilibili_bvid TEXT NOT NULL DEFAULT '',
  reviewer_id   INTEGER,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  submitted_at  TEXT,
  reviewed_at   TEXT,
  published_at  TEXT
);

CREATE TABLE IF NOT EXISTS review_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  video_id    INTEGER NOT NULL,
  operator_id INTEGER NOT NULL,
  action      TEXT NOT NULL,                      -- submit|withdraw|approve|reject|publish
  comment     TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS dynamics (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL,                   -- 平台内发布人
  text        TEXT NOT NULL,
  image_count INTEGER NOT NULL DEFAULT 0,
  dyn_id      TEXT NOT NULL,                      -- B站动态id（t.bilibili.com/{dyn_id}）
  created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_videos_user ON videos(user_id);
CREATE INDEX IF NOT EXISTS idx_videos_status ON videos(status);
CREATE INDEX IF NOT EXISTS idx_logs_video ON review_logs(video_id);
`)

// 存量库迁移：按需补列（新库由上面的 CREATE TABLE 默认值覆盖不到，users 表结构较早）
function addColumnIfMissing(table, name, colDef) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name)
  if (!cols.includes(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${colDef}`)
}
addColumnIfMissing('users', 'email', "email TEXT NOT NULL DEFAULT ''")
addColumnIfMissing('users', 'department', "department TEXT NOT NULL DEFAULT ''")
addColumnIfMissing('videos', 'preview_path', "preview_path TEXT NOT NULL DEFAULT ''")
// preview_status: '' 未探测 | none 无需转码 | processing 转码中 | ready 预览可用 | failed 失败 | skipped 无ffmpeg
addColumnIfMissing('videos', 'preview_status', "preview_status TEXT NOT NULL DEFAULT ''")

export function transaction(fn) {
  db.exec('BEGIN')
  try {
    const result = fn()
    db.exec('COMMIT')
    return result
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}

// 首次启动时创建默认管理员
const hasUser = db.prepare('SELECT id FROM users LIMIT 1').get()
if (!hasUser) {
  db.prepare(
    'INSERT INTO users (username, password_hash, nickname, role) VALUES (?, ?, ?, ?)'
  ).run('admin', bcrypt.hashSync('admin123456', 10), '管理员', 'admin')
  console.log('[init] 已创建默认管理员账号：admin / admin123456 （请登录后尽快修改密码）')
}

export default db
