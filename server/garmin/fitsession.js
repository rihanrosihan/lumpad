// Stage 5a: Garmin activity FIT -> intel.db `fit_session_hist` (SAME metrics as fit_session, SEPARATE table).
// Why separate: fit_session feeds 17 modules (twin, cards' z-scores, similar-session mirroring, matrices, coach context). Mixing 330 historical rows into it would
// change today's outputs. Opt-in consumers read fit_session_hist explicitly. Idempotent on (label_id, parser_version); resumable; sequential (one FIT in memory).
import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'
import { parseFitFile, toSeries, PARSER_VERSION } from '../intel/fit.js'
import { sessionMetrics, perKm, classify, gradeSeries, BASELINE } from '../intel/metrics.js'
import { features } from '../intel/card.js'
import { openDb } from './db.js'

const dataDir = () => process.env.DATA_DIR || path.resolve('server/data')
const startHourWib = (ms) => { const d = new Date(ms + 7 * 3600e3); return d.getUTCHours() + d.getUTCMinutes() / 60 }
const r1 = (x) => (Number.isFinite(x) ? Math.round(x * 10) / 10 : null)

export function openIntel(file = path.join(dataDir(), 'intel.db')) {
  const d = new DatabaseSync(file); d.exec('PRAGMA busy_timeout = 15000')
  if (!d.prepare("SELECT 1 FROM sqlite_master WHERE name='fit_session_hist'").get()) {
    d.exec(`CREATE TABLE fit_session_hist AS SELECT * FROM fit_session WHERE 0;
      ALTER TABLE fit_session_hist ADD COLUMN garmin_id INTEGER; ALTER TABLE fit_session_hist ADD COLUMN app_id TEXT; ALTER TABLE fit_session_hist ADD COLUMN dup_of TEXT; ALTER TABLE fit_session_hist ADD COLUMN era TEXT DEFAULT 'garmin_hist';
      CREATE UNIQUE INDEX fit_session_hist_label ON fit_session_hist(label_id); CREATE INDEX fit_session_hist_date ON fit_session_hist(date);`)
  }
  return d
}

export async function processGarminFit({ a, file, tl = null, appId = null }, { idb, baseline = BASELINE } = {}) {
  const S = toSeries(await parseFitFile(file)), m = sessionMetrics(S, baseline), feat = features(m, { tl, hrvDev: null })
  const hasGps = Number.isFinite(S.lat) && Number.isFinite(S.lon), label = 'garmin:' + a.activity_id
  const dup = idb.prepare('SELECT label_id FROM fit_session WHERE ABS(start_ms - ?) <= 120000 LIMIT 1').get(S.t0)?.label_id || null // already processed from an earlier manual upload
  const row = { label_id: label, activity_id: appId, date: a.date_local, start_ms: S.t0, start_hour: startHourWib(S.t0), sport: m.sport, parser_version: PARSER_VERSION, distance_m: m.distance_m, elapsed_s: m.elapsed_s, run_share: m.run_share,
    ef: m.ef, net_ef: m.net_ef, economy_jm: m.economy_jm, beats_km: m.beats_km, run_pace: m.run_pace, run_hr: m.run_hr, avg_hr: m.avg_hr, drift_pahr: m.drift_pahr?.value ?? null, run_drift: m.run_phase_drift?.value ?? null,
    gct_fade: m.bio_fade?.gct_ms ?? null, stride_fade: m.bio_fade?.stride_m ?? null, vr_fade: m.bio_fade?.vratio_pct ?? null, cad_fade: m.bio_fade?.cadence ?? null, hr800: m.hr_at_800, pace_hr150: m.pace_at_hr150,
    onset_km: m.fade_onset?.km ?? null, mech_abs_km: m.mech_abs_km, gain_m: m.gain_m, temp_device_c: m.temp_device_c, tl, shoe_id: null, lat1: hasGps ? r1(S.lat) : null, lon1: hasGps ? r1(S.lon) : null,
    metrics: JSON.stringify(m), km: JSON.stringify(perKm(S, classify(S), gradeSeries(S))), features: JSON.stringify(feat), card: null, processed_at: new Date().toISOString(), garmin_id: a.activity_id, app_id: appId, dup_of: dup, era: 'garmin_hist' }
  const ks = Object.keys(row)
  idb.prepare(`INSERT INTO fit_session_hist (${ks.join(',')}) VALUES (${ks.map(() => '?').join(',')}) ON CONFLICT(label_id) DO UPDATE SET ${ks.filter((k) => k !== 'label_id').map((k) => `${k}=excluded.${k}`).join(',')}`)
    .run(...ks.map((k) => (row[k] === undefined ? null : row[k])))
  return { label, km: m.distance_m / 1000, dup }
}

// all linked activity FITs not yet processed at this parser version; stops at the time budget (resumable). live: node:sqlite handle of lumpad.db (read-only use)
export async function runFitSessions({ gdb = openDb(), idb = openIntel(), live, budgetMs = 20 * 60e3, limit = Infinity, log = () => {} } = {}) {
  const t0 = Date.now(), c = { done: 0, skipped: 0, failed: 0, dup_of_live: 0, stopped: null }
  const todo = gdb.prepare("SELECT a.*, f.path AS fpath FROM g_activity a JOIN raw_fit f ON f.fit_id = a.fit_id WHERE f.path IS NOT NULL ORDER BY a.start_ms").all()
  const task = gdb.prepare(`INSERT INTO ingest_task (key, stage, status, attempts, error, updated_at) VALUES (?,?,?,1,?,?) ON CONFLICT(key) DO UPDATE SET status=excluded.status, attempts=attempts+1, error=excluded.error, updated_at=excluded.updated_at`)
  const liveRow = live ? live.prepare('SELECT id, training_load FROM activities WHERE garmin_id = ? AND source != ?') : null
  for (const a of todo) {
    if (c.done >= limit) break
    if (Date.now() - t0 > budgetMs) { c.stopped = 'budget'; break }
    const have = idb.prepare('SELECT parser_version FROM fit_session_hist WHERE label_id=?').get('garmin:' + a.activity_id)
    if (have && have.parser_version === PARSER_VERSION) { c.skipped++; continue }
    try {
      const L = liveRow?.get(a.activity_id, 'garmin'), appId = L?.id || 'garmin:' + a.activity_id, r = await processGarminFit({ a, file: a.fpath, tl: L?.training_load ?? null, appId }, { idb })
      c.done++; if (r.dup) c.dup_of_live++; task.run('fit_hist|' + a.activity_id, 'fit_hist', 'done', null, new Date().toISOString())
    } catch (e) { c.failed++; task.run('fit_hist|' + a.activity_id, 'fit_hist', 'failed', String(e.message).slice(0, 200), new Date().toISOString()) }
    if (c.done % 25 === 0) log('fit_hist', c.done)
    await new Promise((r) => setImmediate(r))
  }
  return c
}
