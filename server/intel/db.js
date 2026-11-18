// intel.db = everything derivable from raw data (rebuildable). memory.db = memories, coach runs, audit (NOT rebuildable → backed up).
import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'

const dir = process.env.DATA_DIR || path.resolve('server/data')
fs.mkdirSync(dir, { recursive: true })
const open = (name, env, migrations) => {
  const p = process.env[env] || path.join(dir, name)
  const d = new DatabaseSync(p)
  if (p !== ':memory:') try { fs.chmodSync(p, 0o600) } catch {}
  d.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;')
  const v = d.prepare('PRAGMA user_version').get().user_version
  for (let i = v; i < migrations.length; i++) { d.exec('BEGIN'); try { d.exec(migrations[i]); d.exec(`PRAGMA user_version = ${i + 1}`); d.exec('COMMIT') } catch (e) { d.exec('ROLLBACK'); throw e } }
  return d
}
export const tx = (d, fn) => { d.exec('BEGIN'); try { const r = fn(); d.exec('COMMIT'); return r } catch (e) { d.exec('ROLLBACK'); throw e } }

export const idb = open('intel.db', 'INTEL_DB', [`
CREATE TABLE fit_session (
  label_id TEXT PRIMARY KEY, activity_id TEXT, date TEXT NOT NULL, start_ms INTEGER, start_hour REAL, sport TEXT, parser_version INTEGER NOT NULL,
  distance_m REAL, elapsed_s REAL, run_share REAL, ef REAL, net_ef REAL, economy_jm REAL, beats_km REAL, run_pace REAL, run_hr REAL, avg_hr REAL,
  drift_pahr REAL, run_drift REAL, gct_fade REAL, stride_fade REAL, vr_fade REAL, cad_fade REAL, hr800 REAL, pace_hr150 REAL, onset_km REAL, mech_abs_km REAL,
  gain_m REAL, temp_device_c REAL, tl REAL, shoe_id TEXT, lat1 REAL, lon1 REAL, metrics TEXT NOT NULL, km TEXT NOT NULL, features TEXT, card TEXT, processed_at TEXT NOT NULL
);
CREATE INDEX fit_session_date ON fit_session(date);
CREATE TABLE run_weather (
  label_id TEXT PRIMARY KEY, indoor INTEGER NOT NULL DEFAULT 0, temp_c REAL, dew_c REAL, rh REAL, wind_ms REAL, rad_wm2 REAL, wbgt REAL, hours TEXT, source TEXT, fetched_at TEXT NOT NULL
);
CREATE TABLE weather_cache (cell TEXT NOT NULL, date TEXT NOT NULL, hours TEXT NOT NULL, fetched_at TEXT NOT NULL, PRIMARY KEY (cell, date));
CREATE TABLE daily_features (date TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE athlete_baseline (name TEXT NOT NULL, valid_from TEXT NOT NULL, valid_to TEXT, value REAL, sd REAL, n INTEGER, source TEXT, PRIMARY KEY (name, valid_from));
CREATE TABLE twin_state (version INTEGER PRIMARY KEY AUTOINCREMENT, as_of TEXT NOT NULL, created_at TEXT NOT NULL, trigger TEXT, schema TEXT NOT NULL, inputs_hash TEXT NOT NULL, state TEXT NOT NULL);
CREATE TABLE corr_edge (
  id INTEGER PRIMARY KEY AUTOINCREMENT, run_at TEXT NOT NULL, exposure TEXT NOT NULL, outcome TEXT NOT NULL, lag_lo INTEGER, lag_hi INTEGER, n INTEGER, n_eff REAL,
  rho REAL, partial_rho REAL, ci_lo REAL, ci_hi REAL, p REAL, q REAL, stable INTEGER, status TEXT NOT NULL, note TEXT
);
CREATE TABLE daily_log (date TEXT PRIMARY KEY, feel INTEGER, pain TEXT, gi INTEGER, strength TEXT, fuel TEXT, updated_at TEXT NOT NULL);
CREATE TABLE kb_docs (doc_id TEXT PRIMARY KEY, title TEXT, status TEXT, source_date TEXT, supersedes TEXT, path TEXT, body TEXT NOT NULL, hash TEXT, imported_at TEXT NOT NULL);
CREATE TABLE intel_job (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, status TEXT NOT NULL, started_at TEXT NOT NULL, finished_at TEXT, stats TEXT, error TEXT);
`, `
CREATE TABLE daily_feat (date TEXT PRIMARY KEY, run_km REAL, run_min REAL, run_n INTEGER, tl REAL, run_tl REAL, strength INTEGER, strength_lower INTEGER, strength_upper INTEGER, strength_tl REAL, thr_min REAL, quality INTEGER, double_day INTEGER,
  sleep_min REAL, sleep_hr REAL, hrv REAL, hrv_dev REAL, rhr REAL, wbgt REAL, pain_max REAL, feel REAL, gi REAL);
`])

export const mdb = open('memory.db', 'MEMORY_DB', [`
CREATE TABLE memory (
  id INTEGER PRIMARY KEY AUTOINCREMENT, tier TEXT NOT NULL CHECK (tier IN ('episodic','semantic','procedural')), kind TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, payload TEXT,
  evidence_tag TEXT NOT NULL DEFAULT 'HYPOTHESIS', n INTEGER NOT NULL DEFAULT 1, confidence REAL, status TEXT NOT NULL DEFAULT 'candidate' CHECK (status IN ('candidate','active','archived','retracted','proposal')),
  locked INTEGER NOT NULL DEFAULT 0, supersedes INTEGER, valid_from TEXT, valid_to TEXT, source TEXT, source_ref TEXT, created_by TEXT NOT NULL, hash TEXT UNIQUE, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX memory_tier ON memory(tier, status);
CREATE UNIQUE INDEX memory_ref ON memory(source, source_ref) WHERE source_ref IS NOT NULL;
CREATE VIRTUAL TABLE memory_fts USING fts5(title, body, content='memory', content_rowid='id', tokenize='unicode61 remove_diacritics 2');
CREATE TRIGGER memory_ai AFTER INSERT ON memory BEGIN INSERT INTO memory_fts(rowid, title, body) VALUES (new.id, new.title, new.body); END;
CREATE TRIGGER memory_ad AFTER DELETE ON memory BEGIN INSERT INTO memory_fts(memory_fts, rowid, title, body) VALUES ('delete', old.id, old.title, old.body); END;
CREATE TRIGGER memory_au AFTER UPDATE OF title, body ON memory BEGIN INSERT INTO memory_fts(memory_fts, rowid, title, body) VALUES ('delete', old.id, old.title, old.body); INSERT INTO memory_fts(rowid, title, body) VALUES (new.id, new.title, new.body); END;
CREATE TABLE memory_vec (id INTEGER PRIMARY KEY REFERENCES memory(id) ON DELETE CASCADE, model TEXT NOT NULL, dim INTEGER NOT NULL, vec BLOB NOT NULL);
CREATE TABLE coach_run (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL, intent TEXT NOT NULL, provider TEXT NOT NULL, model TEXT, effort TEXT, question TEXT, context_ids TEXT, context_tokens INTEGER, request TEXT, response TEXT, parsed TEXT, ok INTEGER NOT NULL, error TEXT, usage TEXT, cost_cny REAL);
CREATE TABLE memory_audit (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, run_id INTEGER, action TEXT NOT NULL, memory_id INTEGER, detail TEXT);
CREATE TABLE balance_snap (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, month TEXT NOT NULL, balance_cny REAL NOT NULL);
`, `
-- job ledger for scheduled coach runs: one row per (intent + target + day); caps attempts and spaces retries (Phase 0 hotfix)
CREATE TABLE coach_job (key TEXT PRIMARY KEY, intent TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, next_try TEXT, last_error TEXT, status TEXT NOT NULL DEFAULT 'pending', updated_at TEXT NOT NULL);
`])
