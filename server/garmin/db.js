// Garmin history import: dedicated database (server/data/garmin.db) — raw vault + staging. Never touches lumpad/intel/memory DBs.
// Blueprint: docs/garmin-ingestion-blueprint.md (section 3.1). Everything here is idempotent and resumable.
import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

// a test process without DATA_DIR gets a throwaway directory, never the real garmin database
const DIR = process.env.DATA_DIR || (process.env.NODE_TEST_CONTEXT ? fs.mkdtempSync(path.join(os.tmpdir(), 'lumpad-test-')) : path.resolve('server/data'))
export const GARMIN_DB = process.env.GARMIN_DB || path.join(DIR, 'garmin.db')
export const GARMIN_FIT_DIR = process.env.GARMIN_FIT_DIR || path.join(DIR, 'fit', 'garmin')

export function openDb(file = GARMIN_DB) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true })
  const db = new DatabaseSync(file)
  try { if (file !== ':memory:') fs.chmodSync(file, 0o600) } catch {}
  db.exec(`PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;
CREATE TABLE IF NOT EXISTS import_manifest (
  entry TEXT PRIMARY KEY, bytes INTEGER, sha256 TEXT, kind TEXT NOT NULL, decision TEXT NOT NULL, note TEXT,
  archive_sha256 TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', updated_at TEXT);
CREATE TABLE IF NOT EXISTS raw_record (
  dataset TEXT NOT NULL, rec_key TEXT NOT NULL, day TEXT, body BLOB NOT NULL, sha256 TEXT NOT NULL, entry TEXT NOT NULL,
  PRIMARY KEY (dataset, rec_key));
CREATE TABLE IF NOT EXISTS raw_conflict (
  id INTEGER PRIMARY KEY AUTOINCREMENT, dataset TEXT NOT NULL, rec_key TEXT NOT NULL, kept_sha TEXT, new_sha TEXT, entry TEXT, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS raw_fit (
  fit_id TEXT PRIMARY KEY, upload_entry TEXT, path TEXT, bytes INTEGER, sha256 TEXT, fit_type INTEGER, manufacturer INTEGER, product INTEGER,
  time_created_ms INTEGER, activity_id INTEGER);
CREATE TABLE IF NOT EXISTS ingest_task (
  key TEXT PRIMARY KEY, stage TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
  error TEXT, input_hash TEXT, output_stats TEXT, updated_at TEXT);
CREATE INDEX IF NOT EXISTS ix_manifest_status ON import_manifest(status, decision);
`)
  return db
}
