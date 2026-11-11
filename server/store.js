// SQLite store (node:sqlite, built into Node ≥22.5 — no native build). WAL mode. Schema versioned via PRAGMA user_version.
import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'

const dir = process.env.DATA_DIR || path.resolve('server/data')
fs.mkdirSync(dir, { recursive: true })
export const DB_PATH = process.env.LUMPAD_DB || path.join(dir, 'lumpad.db')
export const db = new DatabaseSync(DB_PATH)
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
);`]

const v = db.prepare('PRAGMA user_version').get().user_version
for (let i = v; i < MIGRATIONS.length; i++) {
  db.exec('BEGIN'); try { db.exec(MIGRATIONS[i]); db.exec(`PRAGMA user_version = ${i + 1}`); db.exec('COMMIT') } catch (e) { db.exec('ROLLBACK'); throw e }
}
export const tx = (fn) => { db.exec('BEGIN'); try { const r = fn(); db.exec('COMMIT'); return r } catch (e) { db.exec('ROLLBACK'); throw e } }
