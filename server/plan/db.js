// plan.db = the versioned plan, triggers, adjustment audit, benchmarks, zone sets and the template catalog. NOT rebuildable (approvals, history) → included in server/snapshot.js.
// Schema: docs/adaptive-plan-engine-blueprint-v2.md §10.3. Opened lazily (importing this file does not create the database until first use).
import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'

export const MIGRATIONS = [`
CREATE TABLE plan_goal (
  id INTEGER PRIMARY KEY AUTOINCREMENT, race_date TEXT NOT NULL, name TEXT NOT NULL, cls TEXT NOT NULL CHECK (cls IN ('A','B','C','D')),
  distance_m REAL NOT NULL, target_s INTEGER, params TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  valid_from TEXT NOT NULL, valid_to TEXT, created_by TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE availability_rule (
  id INTEGER PRIMARY KEY AUTOINCREMENT, dow INTEGER NOT NULL CHECK (dow BETWEEN 0 AND 6), windows TEXT NOT NULL, pref TEXT,
  valid_from TEXT NOT NULL, valid_to TEXT, created_at TEXT NOT NULL
);
CREATE TABLE availability_exception (
  date TEXT NOT NULL, windows TEXT NOT NULL, reason TEXT, source TEXT NOT NULL DEFAULT 'athlete', created_at TEXT NOT NULL, PRIMARY KEY (date, source)
);
CREATE TABLE benchmark (
  id INTEGER PRIMARY KEY AUTOINCREMENT, metric TEXT NOT NULL, value TEXT NOT NULL, source TEXT NOT NULL, evidence_tag TEXT NOT NULL,
  measured_on TEXT NOT NULL, valid_from TEXT NOT NULL, superseded_by INTEGER REFERENCES benchmark(id), ref TEXT, created_at TEXT NOT NULL
);
CREATE INDEX benchmark_cur ON benchmark(metric, valid_from DESC);
CREATE TABLE zone_set (
  version INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL, benchmark_ids TEXT NOT NULL, body TEXT NOT NULL, hash TEXT NOT NULL UNIQUE, active INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX zone_set_one_active ON zone_set(active) WHERE active = 1;
CREATE TABLE workout_template (
  id TEXT NOT NULL, version INTEGER NOT NULL, kind TEXT NOT NULL, purpose TEXT NOT NULL, body TEXT NOT NULL, src TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','retired')), hash TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (id, version)
);
CREATE TABLE template_stats (
  template_id TEXT PRIMARY KEY, n INTEGER NOT NULL, adherence REAL, tiz REAL, hr_drift REAL, rpe REAL, pain48h_rate REAL, skip_rate REAL, last_done TEXT, updated_at TEXT NOT NULL
);
CREATE TABLE plan_version (
  id INTEGER PRIMARY KEY AUTOINCREMENT, parent_id INTEGER REFERENCES plan_version(id), base_macro_id INTEGER REFERENCES plan_version(id),
  kind TEXT NOT NULL CHECK (kind IN ('import','macro','micro','manual','revert')),
  status TEXT NOT NULL CHECK (status IN ('draft','proposed','active','superseded','rejected','expired')),
  horizon_from TEXT NOT NULL, horizon_to TEXT NOT NULL, goal_id INTEGER REFERENCES plan_goal(id), zone_set_version INTEGER REFERENCES zone_set(version),
  engine_version TEXT NOT NULL, inputs_hash TEXT NOT NULL, summary TEXT NOT NULL DEFAULT '{}',
  created_by TEXT NOT NULL CHECK (created_by IN ('engine','coach','athlete','import')), created_at TEXT NOT NULL, activated_at TEXT, superseded_at TEXT
);
CREATE UNIQUE INDEX plan_version_one_active ON plan_version(status) WHERE status = 'active';
CREATE INDEX plan_version_inputs ON plan_version(inputs_hash);
CREATE TABLE plan_session (
  id INTEGER PRIMARY KEY AUTOINCREMENT, version_id INTEGER NOT NULL REFERENCES plan_version(id), date TEXT NOT NULL, slot INTEGER NOT NULL DEFAULT 0,
  op TEXT NOT NULL DEFAULT 'set' CHECK (op IN ('set','clear')), template_id TEXT, template_version INTEGER,
  kind TEXT NOT NULL, label TEXT NOT NULL, week TEXT, phase TEXT, dose TEXT NOT NULL DEFAULT '{}', steps TEXT NOT NULL DEFAULT '[]', est TEXT,
  tags TEXT NOT NULL DEFAULT '[]', is_key INTEGER NOT NULL DEFAULT 0, locked INTEGER NOT NULL DEFAULT 0, note TEXT, origin TEXT NOT NULL, legacy TEXT,
  hash TEXT NOT NULL, UNIQUE (version_id, date, slot)
);
CREATE INDEX plan_session_date ON plan_session(date, slot, version_id);
CREATE TABLE plan_active_day (
  date TEXT NOT NULL, slot INTEGER NOT NULL DEFAULT 0, session_id INTEGER NOT NULL REFERENCES plan_session(id), version_id INTEGER NOT NULL REFERENCES plan_version(id), PRIMARY KEY (date, slot)
);
CREATE TABLE plan_trigger (
  id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, type TEXT NOT NULL, source TEXT NOT NULL, dedupe_key TEXT NOT NULL UNIQUE, payload TEXT NOT NULL,
  route TEXT CHECK (route IN ('micro','macro','render','none')), status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','handled','ignored','escalated')), handled_at TEXT, note TEXT
);
CREATE TABLE plan_adjustment (
  id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL, trigger_id INTEGER REFERENCES plan_trigger(id),
  from_version INTEGER REFERENCES plan_version(id), to_version INTEGER NOT NULL REFERENCES plan_version(id),
  loop TEXT NOT NULL CHECK (loop IN ('import','micro','macro','manual','revert')), scope_from TEXT NOT NULL, scope_to TEXT NOT NULL,
  operators TEXT NOT NULL, diff TEXT NOT NULL, rules TEXT NOT NULL, inputs TEXT NOT NULL, rationale_det TEXT NOT NULL, rationale_llm TEXT,
  coach_run_id INTEGER, llm_tokens INTEGER, auto INTEGER NOT NULL DEFAULT 0, expected TEXT
);
CREATE TABLE plan_adjustment_event (
  id INTEGER PRIMARY KEY AUTOINCREMENT, adjustment_id INTEGER NOT NULL REFERENCES plan_adjustment(id), at TEXT NOT NULL,
  event TEXT NOT NULL CHECK (event IN ('proposed','applied','rejected','expired','reverted','evaluated')), by TEXT NOT NULL CHECK (by IN ('athlete','engine','system')), detail TEXT
);
CREATE TRIGGER plan_adjustment_no_update BEFORE UPDATE ON plan_adjustment BEGIN SELECT RAISE(ABORT, 'plan_adjustment is append-only'); END;
CREATE TRIGGER plan_adjustment_no_delete BEFORE DELETE ON plan_adjustment BEGIN SELECT RAISE(ABORT, 'plan_adjustment is append-only'); END;
CREATE TRIGGER plan_session_no_update BEFORE UPDATE ON plan_session BEGIN SELECT RAISE(ABORT, 'plan_session rows are immutable'); END;
CREATE TRIGGER plan_session_no_delete BEFORE DELETE ON plan_session BEGIN SELECT RAISE(ABORT, 'plan_session rows are immutable'); END;
CREATE TABLE session_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL, session_id INTEGER REFERENCES plan_session(id), activity_id TEXT,
  rpe INTEGER CHECK (rpe BETWEEN 1 AND 10), verdict TEXT CHECK (verdict IN ('too_easy','right','too_hard')), text TEXT, tags TEXT, created_at TEXT NOT NULL
);
`]

export function openPlanDb(p) {
  const file = p ?? process.env.PLAN_DB ?? path.join(process.env.DATA_DIR || path.resolve('server/data'), 'plan.db')
  if (file !== ':memory:') { fs.mkdirSync(path.dirname(file), { recursive: true }) }
  const d = new DatabaseSync(file)
  if (file !== ':memory:') try { fs.chmodSync(file, 0o600) } catch {}
  d.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;')
  const v = d.prepare('PRAGMA user_version').get().user_version
  for (let i = v; i < MIGRATIONS.length; i++) { d.exec('BEGIN'); try { d.exec(MIGRATIONS[i]); d.exec(`PRAGMA user_version = ${i + 1}`); d.exec('COMMIT') } catch (e) { d.exec('ROLLBACK'); throw e } }
  return d
}
let shared = null
export const planDb = () => (shared ||= openPlanDb())
export const tx = (d, fn) => { d.exec('BEGIN IMMEDIATE'); try { const r = fn(); d.exec('COMMIT'); return r } catch (e) { try { d.exec('ROLLBACK') } catch {} throw e } }
