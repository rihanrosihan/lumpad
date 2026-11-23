// SQLite store (node:sqlite, built into Node ≥22.5 — no native build). WAL mode. Schema versioned via PRAGMA user_version.
import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

// a test process without DATA_DIR gets a throwaway directory (and so a throwaway lumpad.db): tests must never open the real activities database
const dir = process.env.DATA_DIR || (process.env.NODE_TEST_CONTEXT ? fs.mkdtempSync(path.join(os.tmpdir(), 'lumpad-test-')) : path.resolve('server/data'))
fs.mkdirSync(dir, { recursive: true })
export const DB_PATH = process.env.LUMPAD_DB || path.join(dir, 'lumpad.db')
export const db = new DatabaseSync(DB_PATH)
try { fs.chmodSync(DB_PATH, 0o600) } catch {}
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;')

const MIGRATIONS = [`
CREATE TABLE health_daily (
  date TEXT PRIMARY KEY,
  sleep_hr_avg REAL, sleep_hr_min REAL, sleep_hr_max REAL,
  hrv_avg REAL, hrv_status TEXT, hrv_range_lo REAL, hrv_range_hi REAL, hrv_baseline REAL,
  resting_hr REAL, stress_avg REAL, steps REAL,
  sleep_total_min REAL, sleep_deep_min REAL, sleep_light_min REAL, sleep_rem_min REAL, sleep_awake_min REAL,
  recovery_pct REAL, load_short REAL, load_long REAL,
  source TEXT NOT NULL DEFAULT 'coros', pulled_at TEXT NOT NULL
);
CREATE TABLE activities (
  id TEXT PRIMARY KEY, source TEXT NOT NULL, source_id TEXT NOT NULL, date TEXT NOT NULL, start_ts INTEGER,
  sport TEXT, name TEXT, distance_m REAL, duration_s REAL, avg_hr REAL, avg_pace_s_km REAL, cadence REAL, power REAL,
  elevation_m REAL, calories REAL, temp_c REAL, humidity REAL, gear_id TEXT, location TEXT, pulled_at TEXT NOT NULL
);
CREATE INDEX activities_date ON activities(date);
CREATE TABLE laps (
  activity_id TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE, idx INTEGER NOT NULL,
  distance_m REAL, duration_s REAL, avg_pace_s_km REAL, avg_hr REAL, cadence REAL, power REAL, gct_ms REAL,
  PRIMARY KEY (activity_id, idx)
);
CREATE TABLE gear (id TEXT PRIMARY KEY, name TEXT, brand TEXT, model TEXT, distance_m REAL, retired INTEGER, pulled_at TEXT NOT NULL);
CREATE TABLE sync_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, received_at TEXT NOT NULL, started_at TEXT, trigger TEXT,
  ok INTEGER NOT NULL, counts TEXT, notes TEXT
);`, `
CREATE TABLE oauth_clients (provider TEXT PRIMARY KEY, client_id TEXT NOT NULL, redirect_uri TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE oauth_tokens (provider TEXT PRIMARY KEY, blob TEXT NOT NULL, expires_at INTEGER, scope TEXT, updated_at TEXT NOT NULL); -- blob = AES-256-GCM sealed JSON
CREATE TABLE sync_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, status TEXT NOT NULL, params TEXT, progress TEXT, error TEXT,
  started_at TEXT NOT NULL, finished_at TEXT, local_date TEXT
);
CREATE TABLE raw_pulls (id INTEGER PRIMARY KEY AUTOINCREMENT, source TEXT NOT NULL, tool TEXT NOT NULL, params TEXT, body BLOB, pulled_at TEXT NOT NULL);
CREATE INDEX raw_pulls_tool ON raw_pulls(tool, pulled_at);
`, `
ALTER TABLE health_daily ADD COLUMN load_ratio REAL;
ALTER TABLE health_daily ADD COLUMN load_comment TEXT;
ALTER TABLE health_daily ADD COLUMN sleep_score REAL;
ALTER TABLE health_daily ADD COLUMN sleep_awake_count REAL;
ALTER TABLE health_daily ADD COLUMN recovery_level TEXT;
ALTER TABLE activities ADD COLUMN training_load REAL;
ALTER TABLE activities ADD COLUMN aerobic_te REAL;
ALTER TABLE activities ADD COLUMN anaerobic_te REAL;
ALTER TABLE activities ADD COLUMN training_focus TEXT;
ALTER TABLE activities ADD COLUMN performance TEXT;
CREATE TABLE fitness_daily (date TEXT PRIMARY KEY, vo2max REAL, running_level REAL, threshold_pace_s_km REAL, pred_5k_s REAL, pred_10k_s REAL, pred_hm_s REAL, pred_m_s REAL, pulled_at TEXT NOT NULL);
`, `
ALTER TABLE activities ADD COLUMN adjusted_pace_s_km REAL;
ALTER TABLE activities ADD COLUMN max_hr REAL;
ALTER TABLE laps ADD COLUMN max_hr REAL;
ALTER TABLE laps ADD COLUMN stride_m REAL;
ALTER TABLE laps ADD COLUMN vo_cm REAL;
ALTER TABLE laps ADD COLUMN vratio_pct REAL;
ALTER TABLE health_daily ADD COLUMN recovery_hours REAL;
`]

const v = db.prepare('PRAGMA user_version').get().user_version
for (let i = v; i < MIGRATIONS.length; i++) {
  db.exec('BEGIN'); try { db.exec(MIGRATIONS[i]); db.exec(`PRAGMA user_version = ${i + 1}`); db.exec('COMMIT') } catch (e) { db.exec('ROLLBACK'); throw e }
}
import { mergeGearIds } from './gearkey.js'
try { mergeGearIds(db) } catch (e) { console.error('gear merge', e.message) }
export const tx = (fn) => { db.exec('BEGIN'); try { const r = fn(); db.exec('COMMIT'); return r } catch (e) { db.exec('ROLLBACK'); throw e } }
