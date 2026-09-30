import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { config } from '../config/index.js';

mkdirSync(config.data, { recursive: true });
export const db = new DatabaseSync(path.join(config.data, 'selfcloud.sqlite'));
db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
db.exec(`
CREATE TABLE IF NOT EXISTS migrations (version INTEGER PRIMARY KEY);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS users (
 id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL COLLATE NOCASE,
 password TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','user')),
 quota INTEGER NOT NULL, disabled INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS sessions (
 token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 expires INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS folders (
 id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id),
 parent_id TEXT REFERENCES folders(id), name TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS files (
 id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id),
 folder_id TEXT REFERENCES folders(id), name TEXT NOT NULL, mime TEXT NOT NULL,
 size INTEGER NOT NULL, hash TEXT NOT NULL, uploaded_at TEXT NOT NULL,
 trashed_at TEXT, state TEXT NOT NULL DEFAULT 'pending',
 metadata TEXT NOT NULL DEFAULT '{}', preview_size INTEGER NOT NULL DEFAULT 0,
 captured_at TEXT, width INTEGER, height INTEGER, is_photo INTEGER NOT NULL DEFAULT 0,
 processing_error TEXT
);
CREATE INDEX IF NOT EXISTS files_owner ON files(owner_id, folder_id, trashed_at);
CREATE INDEX IF NOT EXISTS files_jobs ON files(state);
CREATE TABLE IF NOT EXISTS groups (
 id TEXT PRIMARY KEY, name TEXT UNIQUE NOT NULL
);
CREATE TABLE IF NOT EXISTS members (
 group_id TEXT REFERENCES groups(id) ON DELETE CASCADE,
 user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
 PRIMARY KEY(group_id,user_id)
);
CREATE TABLE IF NOT EXISTS shares (
 group_id TEXT REFERENCES groups(id) ON DELETE CASCADE,
 file_id TEXT REFERENCES files(id) ON DELETE CASCADE,
 PRIMARY KEY(group_id,file_id)
);
INSERT OR IGNORE INTO migrations(version) VALUES(1);
`);

export const get = (sql, ...args) => db.prepare(sql).get(...args);
export const all = (sql, ...args) => db.prepare(sql).all(...args);
export const run = (sql, ...args) => db.prepare(sql).run(...args);
export function transaction(fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const result = fn(); db.exec('COMMIT'); return result; }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}
export function setting(key, fallback) {
  const row = get('SELECT value FROM settings WHERE key=?', key);
  return row ? JSON.parse(row.value) : fallback;
}
export function setSetting(key, value) {
  run('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', key, JSON.stringify(value));
}
