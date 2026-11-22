// Stage 3: link Garmin activities to the rows Lumpad already holds (COROS/Strava), per blueprint 4.1. PURE matching + a read-only dry-run report.
// Rule: |Δstart| <= 300 s, same sport family, |Δdist| <= 5 % (or both distance-less: |Δdur| <= 10 %). One-to-one, nearest start first.
// Winner by date: Garmin before CANON_CUTOFF (the live row is only an import of it), the live source from CANON_CUTOFF on.
import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'
import { openDb } from './db.js'

export const CANON_CUTOFF = process.env.CANON_CUTOFF || '2026-01-01'
const FAM = { running: 'run', treadmill_running: 'run', trail_running: 'run', walking: 'walk', hiking: 'walk', strength_training: 'strength', hiit: 'strength', indoor_cardio: 'cardio',
  cycling: 'ride', indoor_cycling: 'ride', paddelball: 'padel', pilates: 'pilates', soccer: 'soccer', lap_swimming: 'swim', run: 'run', walk: 'walk', strength: 'strength', weighttraining: 'strength', ride: 'ride', 'mountain bike': 'ride', swim: 'swim', padel: 'padel' }
export const family = (s) => FAM[String(s || '').toLowerCase()] || 'other:' + String(s || '').toLowerCase()

// g: [{activity_id,start_ms,sport,distance_m,duration_s}], l: [{id,start_ms,sport,distance_m,duration_s}] -> { pairs, ambiguous, garminOnly, liveOnly }
export function matchActivities(g, l, { tolS = 300, distTol = 0.05, durTol = 0.1, reviewDist = 0.15 } = {}) {
  const cands = []
  for (const a of g) for (const b of l) {
    const d = Math.abs(a.start_ms - b.start_ms) / 1000; if (d > tolS) continue
    const fam = family(a.sport) === family(b.sport)
    const hasD = a.distance_m > 0 && b.distance_m > 0
    const rd = hasD ? Math.abs(a.distance_m - b.distance_m) / Math.max(a.distance_m, b.distance_m) : null
    const rt = a.duration_s > 0 && b.duration_s > 0 ? Math.abs(a.duration_s - b.duration_s) / Math.max(a.duration_s, b.duration_s) : null
    // imports keep the start second: an exact-start, distance-less pair is the same workout even when COROS labels the sport differently (indoor_cardio→Strength)
    const ok = (fam || (d <= 5 && !hasD)) && (hasD ? rd <= distTol : rt == null || rt <= durTol)
    cands.push({ g: a.activity_id, l: b.id, d, fam, rd, rt, ok, review: !ok && fam && hasD && rd <= reviewDist })
  }
  cands.sort((x, y) => x.d - y.d)
  const ug = new Set(), ul = new Set(), pairs = [], ambiguous = []
  for (const c of cands) if (c.ok && !ug.has(c.g) && !ul.has(c.l)) { ug.add(c.g); ul.add(c.l); pairs.push(c) }
  for (const c of cands) if (!ug.has(c.g) && !ul.has(c.l) && (c.review || (!c.ok && !c.fam))) ambiguous.push(c) // near misses a human should look at
  // a matched pair is also flagged when a second candidate competes for the same live row within tolerance
  const competing = new Map(); for (const c of cands) if (c.ok) competing.set(c.l, (competing.get(c.l) || 0) + 1)
  for (const p of pairs) p.contested = competing.get(p.l) > 1
  return { pairs, ambiguous, garminOnly: g.filter((a) => !ug.has(a.activity_id)), liveOnly: l.filter((b) => !ul.has(b.id)) }
}

export const winnerFor = (dateLocal, cutoff = CANON_CUTOFF) => (dateLocal < cutoff ? 'garmin' : 'live')

export function loadInputs({ gdb = openDb(), liveFile = path.join(process.env.DATA_DIR || 'server/data', 'lumpad.db') } = {}) {
  const live = new DatabaseSync(liveFile, { readOnly: true })
  const l = live.prepare('SELECT id, start_ts*1000 AS start_ms, sport, distance_m, duration_s, date, source FROM activities WHERE start_ts IS NOT NULL').all()
  live.close()
  const g = gdb.prepare('SELECT activity_id, start_ms, sport, distance_m, duration_s, date_local FROM g_activity').all()
  return { g, l }
}

export function dryRun(opts = {}) {
  const { g, l } = loadInputs(opts), gd = new Map(g.map((a) => [a.activity_id, a])), ld = new Map(l.map((a) => [a.id, a]))
  const M = matchActivities(g, l), per = (arr, f) => arr.reduce((o, x) => { const k = f(x); o[k] = (o[k] || 0) + 1; return o }, {})
  const cutoffOf = (p) => winnerFor(gd.get(p.g).date_local)
  const winMin = Math.min(...l.map((x) => x.start_ms)), inWin = g.filter((a) => a.start_ms >= winMin - 86400e3)
  return {
    cutoff: CANON_CUTOFF, garmin_total: g.length, live_total: l.length, matched: M.pairs.length,
    matched_by_winner: per(M.pairs, cutoffOf), matched_contested: M.pairs.filter((p) => p.contested).map((p) => ({ g: p.g, l: p.l, dt_s: p.d })),
    matched_dist_dev_p95: (() => { const v = M.pairs.map((p) => p.rd).filter((x) => x != null).sort((a, b) => a - b); return v.length ? +v[Math.floor(v.length * 0.95)].toFixed(4) : null })(),
    garmin_only: M.garminOnly.length, garmin_only_in_live_window: M.garminOnly.filter((a) => inWin.includes(a)).length, garmin_only_by_sport: per(M.garminOnly, (a) => a.sport),
    garmin_only_by_year: per(M.garminOnly, (a) => a.date_local.slice(0, 4)),
    live_unmatched_in_garmin_span: M.liveOnly.filter((b) => b.start_ms >= Math.min(...g.map((x) => x.start_ms)) && b.start_ms <= Math.max(...g.map((x) => x.start_ms)) + 864e5).length,
    live_unmatched_by_source_year: per(M.liveOnly.filter((b) => b.start_ms <= Math.max(...g.map((x) => x.start_ms)) + 864e5), (b) => b.source + ':' + b.date.slice(0, 4)),
    ambiguous: M.ambiguous.slice(0, 40).map((c) => ({ g: c.g, gs: gd.get(c.g).sport, gdate: gd.get(c.g).date_local, l: c.l, ls: ld.get(c.l).sport, dt_s: Math.round(c.d), fam: c.fam, rd: c.rd == null ? null : +c.rd.toFixed(3) })), ambiguous_n: M.ambiguous.length,
  }
}
