// Validates and applies a sync payload from the daily routine. Strict whitelist: unknown fields are ignored,
// invalid values reject that single record (reported back), never the whole batch. Idempotent (upserts).
import crypto from 'node:crypto'
import { db, tx } from './store.js'

const R = { // [type, lo, hi]
  health: {
    sleep_hr_avg: ['n', 25, 200], sleep_hr_min: ['n', 25, 200], sleep_hr_max: ['n', 25, 250], hrv_avg: ['n', 3, 400], hrv_status: ['s', 40],
    hrv_range_lo: ['n', 0, 400], hrv_range_hi: ['n', 0, 400], hrv_baseline: ['n', 0, 400], resting_hr: ['n', 25, 150], stress_avg: ['n', 0, 100],
    steps: ['n', 0, 200000], sleep_total_min: ['n', 0, 1500], sleep_deep_min: ['n', 0, 1500], sleep_light_min: ['n', 0, 1500],
    sleep_rem_min: ['n', 0, 1500], sleep_awake_min: ['n', 0, 1500], recovery_pct: ['n', 0, 100], load_short: ['n', 0, 5000], load_long: ['n', 0, 5000],
  },
  activity: {
    start_ts: ['n', 1e9, 4e9], sport: ['s', 40], name: ['s', 200], distance_m: ['n', 0, 1e6], duration_s: ['n', 0, 2e5], avg_hr: ['n', 25, 250],
    avg_pace_s_km: ['n', 60, 5000], cadence: ['n', 0, 300], power: ['n', 0, 2000], elevation_m: ['n', -500, 9000], calories: ['n', 0, 20000],
    temp_c: ['n', -50, 60], humidity: ['n', 0, 100], gear_id: ['s', 64], location: ['s', 120],
  },
  lap: { distance_m: ['n', 0, 1e6], duration_s: ['n', 0, 2e5], avg_pace_s_km: ['n', 60, 5000], avg_hr: ['n', 25, 250], cadence: ['n', 0, 300], power: ['n', 0, 2000], gct_ms: ['n', 50, 2000] },
  gear: { name: ['s', 120], brand: ['s', 80], model: ['s', 80], distance_m: ['n', 0, 1e8] },
}
const DATE = /^20[2-3]\d-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/
const LIM = { health: 800, activities: 400, laps: 600, gear: 60 }

// returns {ok, v} where v holds only valid whitelisted fields; null/undefined fields are skipped (never overwrite with null)
function pick(o, spec) {
  const out = {}
  for (const [k, [t, a, b]] of Object.entries(spec)) {
    const x = o?.[k]; if (x == null) continue
    if (t === 'n') { if (typeof x !== 'number' || !isFinite(x) || x < a || x > b) return { ok: false, why: `${k} invalid` }; out[k] = x }
    else { if (typeof x !== 'string' || x.length > a) return { ok: false, why: `${k} invalid` }; out[k] = x }
  }
  return { ok: true, v: out }
}
// upsert: `keys` identify the row; `vals` are merged (only the provided fields change)
function upsert(table, keys, vals) {
  const kc = Object.keys(keys), vc = Object.keys(vals), all = [...kc, ...vc]
  const sql = `INSERT INTO ${table} (${all.join(',')}) VALUES (${all.map(() => '?').join(',')}) ON CONFLICT(${kc.join(',')}) DO ${vc.length ? 'UPDATE SET ' + vc.map((k) => `${k}=excluded.${k}`).join(',') : 'NOTHING'}`
  db.prepare(sql).run(...Object.values(keys), ...Object.values(vals))
}

export function applyIngest(p) {
  const now = new Date().toISOString(), counts = { health: 0, activities: 0, laps: 0, gear: 0 }, rejected = []
  const arr = (k) => (Array.isArray(p?.[k]) ? p[k] : [])
  for (const k of Object.keys(LIM)) if (arr(k).length > LIM[k]) throw Object.assign(new Error(`${k}: too many items (max ${LIM[k]})`), { status: 413 })
  tx(() => {
    for (const h of arr('health')) {
      const r = DATE.test(h?.date) ? pick(h, R.health) : { ok: false, why: 'bad date' }
      if (!r.ok) { rejected.push({ kind: 'health', date: h?.date, why: r.why }); continue }
      upsert('health_daily', { date: h.date }, { ...r.v, pulled_at: now })
      counts.health++
    }
    for (const a of arr('activities')) {
      const okSrc = ['coros', 'strava'].includes(a?.source) && typeof a?.source_id === 'string' && /^[\w.-]{1,64}$/.test(a.source_id)
      const r = okSrc && DATE.test(a?.date) ? pick(a, R.activity) : { ok: false, why: 'bad source/id/date' }
      if (!r.ok) { rejected.push({ kind: 'activity', id: a?.source_id, why: r.why }); continue }
      const id = `${a.source}:${a.source_id}`
      const body = { source: a.source, source_id: a.source_id, date: a.date, ...r.v }
      upsert('activities', { id }, { ...body, pulled_at: now })
      counts.activities++
      if (Array.isArray(a.laps)) {
        if (a.laps.length > LIM.laps) { rejected.push({ kind: 'laps', id, why: 'too many laps' }); continue }
        db.prepare('DELETE FROM laps WHERE activity_id = ?').run(id) // laps are replaced as a set (lap count can change)
        a.laps.forEach((l, i) => {
          const lr = pick(l, R.lap)
          if (!lr.ok) return rejected.push({ kind: 'lap', id, idx: i, why: lr.why })
          upsert('laps', { activity_id: id, idx: i + 1 }, lr.v); counts.laps++
        })
      }
    }
    for (const g of arr('gear')) {
      const r = typeof g?.id === 'string' && /^[\w.-]{1,64}$/.test(g.id) ? pick(g, R.gear) : { ok: false, why: 'bad id' }
      if (!r.ok) { rejected.push({ kind: 'gear', id: g?.id, why: r.why }); continue }
      const body = { ...r.v, ...(typeof g.retired === 'boolean' ? { retired: g.retired ? 1 : 0 } : {}) }
      upsert('gear', { id: g.id }, { ...body, pulled_at: now })
      counts.gear++
    }
    const notes = Array.isArray(p?.run?.notes) ? p.run.notes.slice(0, 30).map((s) => String(s).slice(0, 300)) : []
    db.prepare('INSERT INTO sync_runs (received_at, started_at, trigger, ok, counts, notes) VALUES (?,?,?,?,?,?)').run(
      now, typeof p?.run?.started_at === 'string' ? p.run.started_at.slice(0, 40) : null, ['daily', 'manual', 'backfill'].includes(p?.run?.trigger) ? p.run.trigger : 'manual',
      rejected.length ? 0 : 1, JSON.stringify({ ...counts, rejected: rejected.length }), JSON.stringify([...notes, ...rejected.slice(0, 20).map((r) => 'rejected: ' + JSON.stringify(r))]))
  })
  return { ok: true, counts, rejected }
}

// --- auth: bearer token from env, constant-time compare, throttled after repeated failures
const fails = new Map()
export function checkToken(req) {
  const tok = process.env.INGEST_TOKEN
  if (!tok || tok.length < 32) throw Object.assign(new Error('ingest disabled (INGEST_TOKEN not set, min 32 chars)'), { status: 503 })
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '?', f = fails.get(ip) || { n: 0, t: Date.now() }
  if (Date.now() - f.t > 60000) { f.n = 0; f.t = Date.now() }
  if (f.n >= 10) throw Object.assign(new Error('too many attempts'), { status: 429 })
  const given = (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  const a = crypto.createHash('sha256').update(given).digest(), b = crypto.createHash('sha256').update(tok).digest()
  if (!crypto.timingSafeEqual(a, b)) { f.n++; fails.set(ip, f); throw Object.assign(new Error('unauthorized'), { status: 401 }) }
}

// --- read side for the app
export const syncStatus = () => ({
  lastRun: db.prepare('SELECT received_at, trigger, ok, counts, notes FROM sync_runs ORDER BY id DESC LIMIT 1').get() || null,
  recent: db.prepare('SELECT id, received_at, trigger, ok, counts FROM sync_runs ORDER BY id DESC LIMIT 10').all(),
  latestHealth: db.prepare('SELECT MAX(date) d FROM health_daily').get().d,
  healthDays: db.prepare('SELECT COUNT(*) n FROM health_daily').get().n,
  activities: db.prepare('SELECT COUNT(*) n, MIN(date) first, MAX(date) last FROM activities').get(),
})
export const healthRange = (from, to) => db.prepare('SELECT * FROM health_daily WHERE date BETWEEN ? AND ? ORDER BY date').all(from, to)
export const activitiesRange = (from, to) => db.prepare('SELECT * FROM activities WHERE date BETWEEN ? AND ? ORDER BY start_ts, date').all(from, to)
export const lapsOf = (id) => db.prepare('SELECT * FROM laps WHERE activity_id = ? ORDER BY idx').all(id)
export const validDate = (s) => DATE.test(s || '')
