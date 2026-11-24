// Staging database for the old-Lumpad context absorption (server/data/oldlumpad.db, mode 600, gitignored). Rebuildable from old_lumpad.zip; holds NO credentials and NO third-party names.
// Blueprint: docs/old-lumpad-context-absorption-blueprint.md section 6.1.
import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

export const OLD_SOURCE = 'old_lumpad', OLD_ERA = 'old_lumpad', OLD_HORIZON = '2026-08-12'
const DIR = process.env.DATA_DIR || (process.env.NODE_TEST_CONTEXT ? fs.mkdtempSync(path.join(os.tmpdir(), 'lumpad-test-')) : path.resolve('server/data'))
export const OLD_DB = process.env.OLDLUMPAD_DB || path.join(DIR, 'oldlumpad.db')
export const DATA_DIR = DIR

export function openDb(file = OLD_DB) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true })
  const db = new DatabaseSync(file)
  try { if (file !== ':memory:') fs.chmodSync(file, 0o600) } catch {}
  db.exec(`PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;
CREATE TABLE IF NOT EXISTS ol_manifest (entry TEXT PRIMARY KEY, bytes INTEGER, sha256 TEXT, decision TEXT, rule_id TEXT, sensitivity TEXT, archive_sha256 TEXT);
CREATE TABLE IF NOT EXISTS ol_doc (doc_id TEXT PRIMARY KEY, entry TEXT NOT NULL, rule_id TEXT, sensitivity TEXT, doc_date TEXT, lang TEXT, body TEXT NOT NULL, sha256 TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS ol_chunk (chunk_id TEXT PRIMARY KEY, doc_id TEXT NOT NULL, idx INTEGER NOT NULL, text TEXT NOT NULL, sha256 TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS ol_claim (
  claim_id TEXT PRIMARY KEY, doc_id TEXT NOT NULL, chunk_id TEXT, pass TEXT, quote TEXT NOT NULL, text TEXT NOT NULL, title TEXT, kind TEXT,
  event_date TEXT, valid_from TEXT, valid_to TEXT, subject_key TEXT, sensitivity TEXT, models TEXT, confidence REAL,
  novelty TEXT NOT NULL DEFAULT 'unjudged', matched_memory_id INTEGER, judge_note TEXT, qa_status TEXT NOT NULL DEFAULT 'pending', qa_note TEXT,
  target TEXT, promoted_memory_id INTEGER, batch_id TEXT, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS ol_claim_doc ON ol_claim(doc_id);
CREATE TABLE IF NOT EXISTS ol_event (event_id TEXT PRIMARY KEY, kind TEXT NOT NULL, event_date TEXT, label_id TEXT, payload TEXT NOT NULL, doc_id TEXT, batch_id TEXT);
CREATE TABLE IF NOT EXISTS ol_field_stat (event TEXT, scope TEXT, band TEXT, metric TEXT, value REAL, n INTEGER, PRIMARY KEY (event, scope, band, metric));
CREATE TABLE IF NOT EXISTS ol_run (id INTEGER PRIMARY KEY AUTOINCREMENT, batch_id TEXT, phase TEXT, started_at TEXT, finished_at TEXT, calls INTEGER DEFAULT 0, tokens INTEGER DEFAULT 0, notes TEXT);
CREATE TABLE IF NOT EXISTS ol_write (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT, batch_id TEXT, store TEXT, tbl TEXT, row_id TEXT, action TEXT);
CREATE TABLE IF NOT EXISTS ol_fence (phase TEXT, db TEXT, tbl TEXT, n INTEGER, sha TEXT, at TEXT, PRIMARY KEY (phase, db, tbl));
CREATE TABLE IF NOT EXISTS ol_kv (k TEXT PRIMARY KEY, v TEXT);`)
  return db
}
export const nowIso = () => new Date().toISOString()
export const kvGet = (db, k, d = null) => { const r = db.prepare('SELECT v FROM ol_kv WHERE k=?').get(k); return r ? JSON.parse(r.v) : d }
export const kvSet = (db, k, v) => db.prepare('INSERT OR REPLACE INTO ol_kv VALUES (?,?)').run(k, JSON.stringify(v))
