// Performance summary: the numbers the Knowledge Graph screen leads with. Computed from the same sources as the graph's Performance layer (FIT sessions, COROS fitness, training load),
// so what the panel says and what the graph shows agree. Every metric carries a direction (is up good or bad?) so a trend can be called improving or worsening.
import { idb } from './db.js'
import { db as appDb } from '../store.js'
import { vdotFromRace } from '../../src/lib/vdot.js'
import { TARGET } from '../../src/lib/plan.js'
import fs from 'node:fs'
import path from 'node:path'
import { loadPRs } from './prs.js'

const med = (a) => { const x = a.filter(Number.isFinite).sort((p, q) => p - q); return x.length ? (x.length % 2 ? x[(x.length - 1) / 2] : (x[x.length / 2 - 1] + x[x.length / 2]) / 2) : null }
const r1 = (x, n = 1) => (x == null ? null : +x.toFixed(n))
const wib = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10)
// a trend of the newest `n` against the `n` before them; better = 'up' or 'down'
export function trend(vals, better = 'up', n = 5) {
  const v = vals.filter(Number.isFinite); if (v.length < 2) return { recent: v.length ? r1(v[v.length - 1], 3) : null, prior: null, delta: null, direction: 'flat' }
  const k = Math.min(n, Math.floor(v.length / 2)), a = med(v.slice(-k)), b = med(v.slice(-2 * k, -k)), d = a - b, tol = Math.abs(b) * 0.01
  return { recent: r1(a, 3), prior: r1(b, 3), delta: r1(d, 3), direction: Math.abs(d) <= tol ? 'flat' : (d > 0) === (better === 'up') ? 'improving' : 'worsening' }
}
// fastest run of `w` consecutive km (a gap in the km series breaks it); seconds, or null
// only COMPLETE kilometres count: the last row of a run is a partial km (a few metres) and would make an impossible 1 km time
export function bestWindow(km, w, distM = Infinity) {
  const full = Math.floor(distM / 1000), ks = km.filter((k) => k.km <= full && k.sec >= 150 && k.sec <= 1500).sort((a, b) => a.km - b.km); let best = null
  for (let i = 0; i + w <= ks.length; i++) { if (ks[i + w - 1].km - ks[i].km !== w - 1) continue; let s = 0; for (let j = i; j < i + w; j++) s += ks[j].sec || 0; if (s > 0 && (best == null || s < best)) best = s }
  return best
}
const COLS = 'label_id, date, start_ms, distance_m, elapsed_s, run_share, ef, drift_pahr, hr800, pace_hr150, onset_km, gct_fade, stride_fade, run_pace, km'
const parseKm = (s) => { let km = []; try { km = JSON.parse(s.km || '[]') } catch {} return { ...s, km } }
// every run we have FIT data for, from BOTH watches: the live table (COROS, plus the Garmin files already imported into it) and the Garmin history rows that are not duplicates of a live run
export function allRuns() {
  const live = idb.prepare(`SELECT ${COLS} FROM fit_session ORDER BY date`).all().map(parseKm), starts = live.map((s) => s.start_ms).filter(Boolean).sort((a, b) => a - b)
  const near = (ms) => { let lo = 0, hi = starts.length; while (lo < hi) { const m = (lo + hi) >> 1; if (starts[m] < ms) lo = m + 1; else hi = m } return [starts[lo - 1], starts[lo]].some((x) => x != null && Math.abs(x - ms) <= 300000) }
  let hist = []; try { hist = idb.prepare(`SELECT ${COLS} FROM fit_session_hist WHERE dup_of IS NULL AND (sport LIKE '%run%' OR sport IS NULL) ORDER BY date`).all().map(parseKm).filter((s) => !s.start_ms || !near(s.start_ms)) } catch {}
  return [...live, ...hist].sort((a, b) => (a.date < b.date ? -1 : 1))
}
const q = (d) => { const [y, m] = d.split('-').map(Number); return `${y}-Q${Math.ceil(m / 3)}` }
// per quarter, both watches in one series (the numbers are computed from the FIT files by the same parser, so they are comparable; device scores are not and are shown apart)
export function longTerm(ses) {
  const by = new Map(); for (const s of ses) { const k = q(s.date); if (!by.has(k)) by.set(k, []); by.get(k).push(s) }
  return [...by.entries()].sort().map(([k, a]) => { const best = a.map((s) => { let b = 0; for (const w of [5, 10]) { const t = bestWindow(s.km, w, s.distance_m); if (t) b = Math.max(b, vdotFromRace(w * 1000, t)) } return b > 25 && b < 75 ? b : 0 }), lr = a.filter((s) => (s.distance_m || 0) >= 16000)
    return { quarter: k, era: k < '2026-Q1' ? 'garmin' : 'coros', runs: a.length, km: r1(a.reduce((t, s) => t + (s.distance_m || 0), 0) / 1000, 0), ef: r1(med(a.map((s) => s.ef)), 3), drift: r1(med(a.map((s) => s.drift_pahr)), 1), best_vdot: r1(Math.max(0, ...best)) || null,
      long_runs: lr.length, onset_km: r1(med(lr.map((s) => s.onset_km)), 1), run_share: r1(med(lr.map((s) => s.run_share)), 2) } })
}
const readDevice = () => { try { return JSON.parse(fs.readFileSync(path.join(process.env.DATA_DIR || path.resolve('server/data'), 'garmin_device.json'), 'utf8')).points || [] } catch { return [] } }
// the two watches' own scores, each on its own scale
export function devices(points = readDevice()) {
  const series = (m) => points.filter((p) => p.metric === m).sort((a, b) => a.date.localeCompare(b.date)), last = (m) => series(m).at(-1) || null
  const v = series('garmin_vo2max'), peak = v.reduce((b, p) => (!b || p.value > b.value ? p : b), null)
  return { garmin: v.length ? { period: [v[0].date, v.at(-1).date], vo2max: { first: v[0].value, last: v.at(-1).value, peak: peak && { value: peak.value, date: peak.date } }, pred: { '5k': last('garmin_pred_5k')?.value, '10k': last('garmin_pred_10k')?.value, hm: last('garmin_pred_hm')?.value, marathon: last('garmin_pred_marathon')?.value }, load: last('garmin_load_chronic') && { chronic: last('garmin_load_chronic').value, acute: last('garmin_load_acute')?.value, ratio: last('garmin_load_ratio')?.value, date: last('garmin_load_chronic').date } } : null }
}
export function perfSummary() {
  const ses = allRuns()
  const col = (k, filter = () => true) => ses.filter((s) => s[k] != null && filter(s)).map((s) => s[k])
  const long = (s) => (s.distance_m || 0) >= 16000
  // VDOT of every session's best effort (5 K / 10 K window, or the whole run when it was mostly run)
  const vd = ses.map((s) => { let b = 0; for (const w of [5, 10]) { const t = bestWindow(s.km, w, s.distance_m); if (t) b = Math.max(b, vdotFromRace(w * 1000, t)) } if ((s.distance_m || 0) >= 8000 && s.elapsed_s && (s.run_share || 0) >= 0.85) b = Math.max(b, vdotFromRace(s.distance_m, s.elapsed_s)); return b > 25 && b < 75 ? { date: s.date, v: b } : null }).filter(Boolean)
  const latestVd = vd.at(-1) || null, bestVd90 = vd.filter((x) => x.date >= new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10)).reduce((m, x) => Math.max(m, x.v), 0) || null
  const pb = {}; for (const w of [1, 3, 5, 10, 15, 20]) { let best = null; for (const s of ses) { const t = bestWindow(s.km, w, s.distance_m); if (t && (!best || t < best.secs)) best = { secs: Math.round(t), pace: Math.round(t / w), date: s.date, label: s.label_id, vdot: r1(vdotFromRace(w * 1000, t)) } } if (best) pb[w + 'k'] = best }
  const fit = appDb.prepare('SELECT * FROM fitness_daily ORDER BY date DESC LIMIT 30').all(), f0 = fit[0] || null, fOld = fit.at(-1) || null
  const load = appDb.prepare('SELECT date, load_short, load_long, load_ratio FROM health_daily WHERE load_long IS NOT NULL ORDER BY date DESC LIMIT 1').get() || null
  const longs = ses.filter(long)
  return {
    generated: wib(),
    vdot: { baseline: TARGET.baseline, needed: TARGET.vdotNeeded, race_equivalent: TARGET.vdotRace, latest_effort: latestVd && { value: r1(latestVd.v), date: latestVd.date }, best_effort_90d: r1(bestVd90), trend: trend(vd.map((x) => x.v), 'up'),
      gap_to_needed: latestVd ? r1(TARGET.vdotNeeded - latestVd.v) : null, note: 'Effort-implied: training efforts are rarely all-out, so this is a floor; race and time-trial results are the real tests.' },
    coros: f0 && { date: f0.date, vo2max: f0.vo2max, running_level: f0.running_level, threshold_pace_s_km: f0.threshold_pace_s_km, pred_5k_s: f0.pred_5k_s, pred_10k_s: f0.pred_10k_s, pred_hm_s: f0.pred_hm_s, pred_marathon_s: f0.pred_m_s,
      since: fOld && fOld.date !== f0.date ? { date: fOld.date, vo2max: fOld.vo2max, running_level: fOld.running_level } : null },
    cardio: { ef: trend(col('ef'), 'up'), drift_pahr: trend(col('drift_pahr'), 'down'), hr800: trend(col('hr800'), 'down'), pace_hr150: trend(col('pace_hr150'), 'down') },
    durability: { long_runs: longs.length, run_share: trend(longs.filter((s) => s.run_share != null).map((s) => s.run_share), 'up', 4), onset_km: trend(longs.filter((s) => s.onset_km != null).map((s) => s.onset_km), 'up', 4), gct_fade: trend(longs.filter((s) => s.gct_fade != null).map((s) => s.gct_fade), 'down', 4), longest_km: r1(Math.max(0, ...ses.map((s) => (s.distance_m || 0) / 1000))) },
    strava_prs: (() => { const d = loadPRs(); const rel = d.prs.filter((p) => p.meters >= 3000 && p.meters <= 21100); const best = rel.reduce((m, p) => (!m || p.vdot > m.vdot ? p : m), null); return { updated: d.updated, prs: d.prs, activities: d.activities || {}, best_vdot: best ? { value: best.vdot, label: best.label, url: best.url } : null } })(),
    long_term: longTerm(ses), devices: devices(), runs_total: ses.length,
    speed: { pbs: pb, run_pace: trend(col('run_pace'), 'down') },
    load,
  }
}
