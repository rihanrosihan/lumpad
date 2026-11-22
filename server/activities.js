// Read side for the Activity tab: COROS and Strava both record every run, so rows are merged into one activity.
// Merge rule: same date, same sport class, distance within max(3 %, 100 m) (or, for distance-less sessions, duration within 5 %).
import { db } from './store.js'

const CLASS = { Run: 'run', TrailRun: 'run', VirtualRun: 'run', Walk: 'walk', Hike: 'walk', Strength: 'strength', WeightTraining: 'strength', Workout: 'strength' }
const cls = (s) => CLASS[s] || 'other:' + s
const close = (a, b) => (a.distance_m > 0 && b.distance_m > 0 ? Math.abs(a.distance_m - b.distance_m) <= Math.max(100, 0.03 * Math.max(a.distance_m, b.distance_m))
  : a.duration_s > 0 && b.duration_s > 0 && Math.abs(a.duration_s - b.duration_s) <= 0.05 * Math.max(a.duration_s, b.duration_s))

export function mergeActivities(rows) {
  const used = new Set(), out = []
  const byDate = new Map(); for (const r of rows) (byDate.get(r.date) || byDate.set(r.date, []).get(r.date)).push(r)
  for (const day of byDate.values()) {
    const coros = day.filter((r) => r.source === 'coros'), strava = day.filter((r) => r.source === 'strava')
    for (const c of coros) {
      const m = strava.find((s) => !used.has(s.id) && cls(s.sport) === cls(c.sport) && close(c, s)); if (m) used.add(m.id)
      // COROS is the primary record (training load, power, laps); Strava adds shoe, weather, the name you gave it, location.
      out.push({ ...c, sport_class: cls(c.sport), name: m?.name || c.name, gear_id: m?.gear_id ?? c.gear_id, temp_c: m?.temp_c ?? c.temp_c, humidity: m?.humidity ?? c.humidity,
        elevation_m: c.elevation_m ?? m?.elevation_m, location: m?.location || c.location, sources: m ? ['coros', 'strava'] : ['coros'], ids: m ? [c.id, m.id] : [c.id] })
    }
    for (const s of strava) if (!used.has(s.id)) out.push({ ...s, sport_class: cls(s.sport), sources: ['strava'], ids: [s.id] })
    // Garmin history (import of the pre-2026 archive): Garmin-only sessions are their own activities; matched sessions keep their COROS row (see activity_enrichment)
    for (const g of day.filter((r) => r.source === 'garmin')) out.push({ ...g, sport_class: cls(g.sport), sources: ['garmin'], ids: [g.id] })
  }
  return out.sort((a, b) => (b.start_ts || 0) - (a.start_ts || 0) || b.date.localeCompare(a.date))
}
// Garmin side-data per activity (training effect, zones, feel, …); {} when the Garmin import has not run (table absent)
const enrichmentFor = (ids) => { try { return new Map(db.prepare(`SELECT * FROM activity_enrichment WHERE activity_id IN (${ids.map(() => '?').join(',') || "''"})`).all(...ids).map((e) => [e.activity_id, e])) } catch { return new Map() } }
export const listMerged = (from, to) => {
  const m = mergeActivities(db.prepare('SELECT * FROM activities WHERE date BETWEEN ? AND ?').all(from, to)), e = enrichmentFor(m.flatMap((x) => x.ids))
  return m.map((x) => { const g = x.ids.map((i) => e.get(i)).find(Boolean); return g ? { ...x, garmin: g } : x })
}
export function activityDetail(id) {
  const a = db.prepare('SELECT * FROM activities WHERE id = ?').get(id); if (!a) return null
  const [merged] = mergeActivities(db.prepare('SELECT * FROM activities WHERE date = ?').all(a.date)).filter((m) => m.ids.includes(id))
  const lap = (m) => db.prepare('SELECT * FROM laps WHERE activity_id = ? ORDER BY idx').all(m)
  return { ...(merged || a), laps: (merged?.ids || [id]).flatMap(lap).filter((l, i, arr) => arr.findIndex((x) => x.idx === l.idx) === i) }
}
export const gearList = () => db.prepare(`SELECT g.id, g.name, g.brand, g.model, g.distance_m AS lifetime_m, g.retired,
  (SELECT COALESCE(SUM(a.distance_m),0) FROM activities a WHERE a.gear_id = g.id AND a.source='strava') AS tracked_m,
  (SELECT MAX(a.date) FROM activities a WHERE a.gear_id = g.id) AS last_used FROM gear g ORDER BY g.retired, g.distance_m DESC`).all()
// Everything the Readiness tab needs for a date window; derived metrics (form, ramp, zones) are computed client-side in src/lib/metrics.js
export function readinessData(from, to) {
  return {
    health: db.prepare('SELECT * FROM health_daily WHERE date BETWEEN ? AND ? ORDER BY date').all(from, to),
    loads: db.prepare("SELECT date, SUM(training_load) AS load, COUNT(*) AS n FROM activities WHERE source='coros' AND training_load IS NOT NULL AND date BETWEEN ? AND ? GROUP BY date ORDER BY date").all(from, to),
    fitness: db.prepare('SELECT * FROM fitness_daily ORDER BY date DESC LIMIT 1').get() || null,
  }
}

// laps of COROS runs in a window, keyed by activity id (for intensity distribution / HR max)
export function lapsInRange(from, to) {
  const out = {}; for (const l of db.prepare("SELECT l.* FROM laps l JOIN activities a ON a.id = l.activity_id WHERE a.date BETWEEN ? AND ? ORDER BY l.activity_id, l.idx").all(from, to)) (out[l.activity_id] ||= []).push(l)
  return out
}
export const exportRows = (table) => db.prepare(`SELECT * FROM ${table === 'health_daily' ? 'health_daily' : 'activities'} ORDER BY date`).all()
export function toCsv(rows) {
  if (!rows.length) return ''
  const cols = Object.keys(rows[0]), esc = (v) => (v == null ? '' : /[",\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v))
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n')
}

export function setShoe(ids, gearId) { const u = db.prepare('UPDATE activities SET gear_id = ? WHERE id = ?'); for (const x of ids) u.run(gearId, x); return ids }
