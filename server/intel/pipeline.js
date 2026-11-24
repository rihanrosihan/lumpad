// fit-to-memory: FIT file → metrics (intel.db) + episode card (intel.db + memory.db episodic). Idempotent on (label_id, parser_version).
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { db as app } from '../store.js'
import { idb, mdb, tx } from './db.js'
import { parseFitFile, toSeries, PARSER_VERSION } from './fit.js'
import { sessionMetrics, perKm, classify, gradeSeries, BASELINE } from './metrics.js'
import { buildCard, features, zMatrix, cosine, FEATURES } from './card.js'
import { PLAN } from '../plan/read.js'

const RUN = new Set([100, 101, 102, 103]), PLAN_BY = Object.fromEntries(PLAN.map((d) => [d.date, d]))
const dataDir = () => process.env.DATA_DIR || path.resolve('server/data')
const tick = () => new Promise((r) => setImmediate(r))

export function fitFiles(adb) { return adb.prepare('SELECT label_id, sport_type, date, path FROM fit_files ORDER BY date DESC').all() }

const health = (date) => app.prepare('SELECT hrv_avg, hrv_baseline, sleep_hr_avg, resting_hr FROM health_daily WHERE date=?').get(date)
const shoeOf = (gearId) => { if (!gearId) return null; const g = app.prepare('SELECT name, distance_m FROM gear WHERE id=?').get(gearId); return g ? { name: g.name, km: g.distance_m / 1000 } : null }
const startHourWib = (ms) => { const d = new Date(ms + 7 * 3600e3); return d.getUTCHours() + d.getUTCMinutes() / 60 }

export async function processFit({ label_id, date, file }, { baseline = BASELINE } = {}) {
  const S = toSeries(await parseFitFile(file)), m = sessionMetrics(S, baseline)
  const act = app.prepare('SELECT id, training_load, gear_id, name FROM activities WHERE id=?').get('coros:' + label_id) || {}
  const lat = S.lat, lon = S.lon, hasGps = Number.isFinite(lat) && Number.isFinite(lon)
  const h = health(date), r1 = (x) => (Number.isFinite(x) ? Math.round(x * 10) / 10 : null)
  const hrvDev = h?.hrv_avg != null && h?.hrv_baseline ? (h.hrv_avg - h.hrv_baseline) / h.hrv_baseline : null
  const feat = features(m, { tl: act.training_load, hrvDev })
  const km = JSON.stringify(perKm(S, classify(S), gradeSeries(S)))
  idb.prepare(`INSERT INTO fit_session (label_id, activity_id, date, start_ms, start_hour, sport, parser_version, distance_m, elapsed_s, run_share, ef, net_ef, economy_jm, beats_km, run_pace, run_hr, avg_hr,
      drift_pahr, run_drift, gct_fade, stride_fade, vr_fade, cad_fade, hr800, pace_hr150, onset_km, mech_abs_km, gain_m, temp_device_c, tl, shoe_id, lat1, lon1, metrics, km, features, processed_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(label_id) DO UPDATE SET activity_id=excluded.activity_id, date=excluded.date, start_ms=excluded.start_ms, start_hour=excluded.start_hour, sport=excluded.sport, parser_version=excluded.parser_version,
      distance_m=excluded.distance_m, elapsed_s=excluded.elapsed_s, run_share=excluded.run_share, ef=excluded.ef, net_ef=excluded.net_ef, economy_jm=excluded.economy_jm, beats_km=excluded.beats_km, run_pace=excluded.run_pace,
      run_hr=excluded.run_hr, avg_hr=excluded.avg_hr, drift_pahr=excluded.drift_pahr, run_drift=excluded.run_drift, gct_fade=excluded.gct_fade, stride_fade=excluded.stride_fade, vr_fade=excluded.vr_fade, cad_fade=excluded.cad_fade,
      hr800=excluded.hr800, pace_hr150=excluded.pace_hr150, onset_km=excluded.onset_km, mech_abs_km=excluded.mech_abs_km, gain_m=excluded.gain_m, temp_device_c=excluded.temp_device_c, tl=excluded.tl, shoe_id=excluded.shoe_id,
      lat1=excluded.lat1, lon1=excluded.lon1, metrics=excluded.metrics, km=excluded.km, features=excluded.features, processed_at=excluded.processed_at`).run(
    label_id, act.id || null, date, S.t0, startHourWib(S.t0), m.sport, PARSER_VERSION, m.distance_m, m.elapsed_s, m.run_share, m.ef, m.net_ef, m.economy_jm, m.beats_km, m.run_pace, m.run_hr, m.avg_hr,
    m.drift_pahr?.value ?? null, m.run_phase_drift?.value ?? null, m.bio_fade?.gct_ms ?? null, m.bio_fade?.stride_m ?? null, m.bio_fade?.vratio_pct ?? null, m.bio_fade?.cadence ?? null, m.hr_at_800, m.pace_at_hr150,
    m.fade_onset?.km ?? null, m.mech_abs_km, m.gain_m, m.temp_device_c, act.training_load ?? null, act.gear_id ?? null, hasGps ? Math.round(lat * 10) / 10 : null, hasGps ? Math.round(lon * 10) / 10 : null,
    JSON.stringify(m), km, JSON.stringify(feat), new Date().toISOString())
  return { label_id, date, km: m.distance_m / 1000 }
}

// cards + similar sessions need all sessions processed first (z-scores over the whole set)
// load state + strength/sleep context the day of each run (blueprint §5.4): CTL τ42 / ATL τ7 over daily_feat.tl; exposures from the 1–3 days BEFORE
function contextByDate() {
  const rows = idb.prepare('SELECT date, run_km, tl, strength, strength_lower, sleep_min FROM daily_feat ORDER BY date').all(), out = {}
  let ctl = 0, atl = 0
  rows.forEach((d, i) => {
    const prev = (n) => rows.slice(Math.max(0, i - n), i)
    out[d.date] = { km7: prev(7).reduce((s, x) => s + (x.run_km || 0), 0), ctl: Math.round(ctl), atl: Math.round(atl), tsb: Math.round(ctl - atl), gym_72h: prev(3).some((x) => x.strength), lower_72h: prev(3).some((x) => x.strength_lower), sleep_min: d.sleep_min }
    ctl += ((d.tl || 0) - ctl) / 42; atl += ((d.tl || 0) - atl) / 7
  })
  return out
}
export function buildCards({ only } = {}) {
  const CTX = contextByDate()
  const sessions = idb.prepare('SELECT * FROM fit_session ORDER BY date').all(), withF = sessions.map((s) => ({ s, f: JSON.parse(s.features || '{}') }))
  const Z = zMatrix(withF.map((x) => x.f)), vecs = withF.map((x) => ({ s: x.s, v: Z.z(x.f) }))
  let n = 0
  for (const { s, v } of vecs) {
    if (only && !only.has(s.label_id)) continue
    const m = JSON.parse(s.metrics), w = idb.prepare('SELECT * FROM run_weather WHERE label_id=?').get(s.label_id)
    const similar = vecs.filter((o) => o.s.label_id !== s.label_id && o.s.date < s.date && o.s.distance_m > 3000).map((o) => ({ ...o.s, sim: cosine(v, o.v) })).sort((a, b) => b.sim - a.sim).slice(0, 3)
    const log = idb.prepare('SELECT * FROM daily_log WHERE date=?').get(s.date)
    const card = buildCard({ date: s.date, startHour: s.start_hour, m, weather: w, health: health(s.date), log, shoe: shoeOf(s.shoe_id), plan: PLAN_BY[s.date], similar, race: s.distance_m > 40000, ctx7: CTX[s.date] })
    idb.prepare('UPDATE fit_session SET card=? WHERE label_id=?').run(card, s.label_id)
    upsertEpisodic(s, card); n++
  }
  return n
}
function upsertEpisodic(s, card) {
  const now = new Date().toISOString(), hash = crypto.createHash('sha256').update(card).digest('hex'), title = `Run ${s.date} ${(s.distance_m / 1000).toFixed(1)} km`
  const ex = mdb.prepare("SELECT id, hash FROM memory WHERE source='fit' AND source_ref=?").get(s.label_id)
  if (ex?.hash === hash) return
  if (ex) mdb.prepare('UPDATE memory SET title=?, body=?, hash=?, updated_at=?, valid_from=? WHERE id=?').run(title, card, hash, now, s.date, ex.id)
  else mdb.prepare(`INSERT INTO memory (tier, kind, title, body, payload, evidence_tag, status, source, source_ref, created_by, hash, valid_from, created_at, updated_at) VALUES ('episodic','session',?,?,?,'MEASURED','active','fit',?,'system',?,?,?,?)`)
    .run(title, card, JSON.stringify({ label_id: s.label_id, date: s.date }), s.label_id, hash, s.date, now, now)
}

// process every FIT of a run sport that is not yet at the current parser version
export async function fitJob(adb, { limit = 1000, baseline } = {}) {
  const have = new Map(idb.prepare('SELECT label_id, parser_version FROM fit_session').all().map((r) => [r.label_id, r.parser_version]))
  // a file the parser rejected as hopeless (a few-second recording) is remembered in coros.db meta so the hourly job stops retrying it; a parser_version bump retries it once
  const junk = new Set(adb.prepare("SELECT k FROM meta WHERE k LIKE 'fit_junk:%' AND v=?").all(String(PARSER_VERSION)).map((r) => r.k.slice(9)))
  const todo = fitFiles(adb).filter((f) => RUN.has(f.sport_type) && have.get(f.label_id) !== PARSER_VERSION && !junk.has(f.label_id)).slice(0, limit)
  let done = 0, failed = []
  for (const f of todo) {
    const file = path.join(dataDir(), f.path)
    try { if (!fs.existsSync(file)) throw new Error('file missing'); await processFit({ label_id: f.label_id, date: f.date, file }, { baseline }); done++ } catch (e) { if (/too few records/.test(e.message)) adb.prepare('INSERT INTO meta (k, v) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').run('fit_junk:' + f.label_id, String(PARSER_VERSION)); else failed.push({ label_id: f.label_id, why: String(e.message).slice(0, 120) }) }
    await tick()
  }
  const cards = done || todo.length === 0 ? buildCards() : 0
  return { processed: done, failed: failed.length, failures: failed.slice(0, 5), cards, total: idb.prepare('SELECT COUNT(*) n FROM fit_session').get().n }
}
