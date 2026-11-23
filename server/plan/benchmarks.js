// Benchmark Resolver + zone sets (P0: computed and stored in shadow; no reader uses them yet). Pure core; the CLI feeds it.
// Precedence (blueprint §9.2.1): override > TT-derived > COROS fitness_daily (7-day median, >= 3 days) > seed.
import crypto from 'node:crypto'
import { ZONES, hrRange, paceRange, cfgOf } from '../../src/lib/zones.js'
import { paces, vdotFromRace } from '../../src/lib/vdot.js'
import { ATHLETE } from '../../src/lib/athlete.js'
import { TARGET } from '../../src/lib/plan.js'

const median = (a) => { const s = [...a].sort((x, y) => x - y), m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2 }

// in: { settings:{lthr,tpace,hrEnds}, results:{[cpId]:{vdot}}, fitness:[{date, threshold_pace_s_km}], today }
export function resolveBenchmarks({ settings = {}, results = {}, fitness = [], today }) {
  const out = {}, put = (metric, value, source, evidence_tag, measured_on) => { out[metric] = { metric, value, source, evidence_tag, measured_on } }
  const recent = fitness.filter((f) => f.threshold_pace_s_km != null && f.date > addD(today, -7)).map((f) => f.threshold_pace_s_km)
  if (settings.tpace) put('tpace_s', +settings.tpace, 'override', 'REPORTED', today)
  else if (recent.length >= 3) put('tpace_s', Math.round(median(recent)), 'coros:fitness_daily', 'MEASURED', today)
  else put('tpace_s', ATHLETE.tpace_s, 'seed:athlete.js', 'REPORTED', today)
  const tt = Object.entries(results).filter(([, r]) => r?.vdot != null).map(([id, r]) => [+id, r.vdot]).sort((a, b) => a[0] - b[0]).at(-1)
  if (tt) put('vdot', tt[1], `tt:CP${tt[0]}`, 'MEASURED', today); else put('vdot', TARGET.baseline, 'seed:plan.js', 'REPORTED', today)
  put('lthr', +settings.lthr || ATHLETE.lthr, settings.lthr ? 'override' : 'seed:athlete.js', settings.lthr ? 'REPORTED' : 'REPORTED', today)
  const cfg = cfgOf({ lthr: out.lthr.value, tpace: out.tpace_s.value, hrEnds: settings.hrEnds })
  put('hr_ends', cfg.hrEnds, Array.isArray(settings.hrEnds) ? 'override' : 'seed:zones.js (COROS app)', 'REPORTED', today)
  put('hrmax', ATHLETE.hrmax, 'seed:athlete.js', 'REPORTED', today)
  return { benchmarks: out, cfg }
}
const addD = (s, n) => { const d = new Date(s + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }

export function buildZoneSet({ benchmarks, cfg }) {
  const vdot = benchmarks.vdot.value, p = paces(vdot)
  const body = { hr: [1, 2, 3, 4, 5, 6].map((z) => hrRange(z, cfg)), pace: [1, 2, 3, 4, 5, 6].map((z) => paceRange(z, cfg)), names: ZONES.slice(1).map((z) => z.name),
    daniels: { vdot, E: p.E.map(Math.round), T: Math.round(p.T), M: Math.round(p.M), I: Math.round(p.I), R: Math.round(p.R) }, cfg }
  return { body, hash: crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex') }
}

// store: only writes when a benchmark value changed or the zone set hash is new. Returns what changed (a new zone set never creates a plan version).
export function persist(db, res, { today }) {
  const ids = [], changed = []
  for (const b of Object.values(res.benchmarks)) {
    const cur = db.prepare('SELECT * FROM benchmark WHERE metric=? AND superseded_by IS NULL ORDER BY id DESC LIMIT 1').get(b.metric), val = JSON.stringify(b.value)
    if (cur && cur.value === val && cur.source === b.source) { ids.push(cur.id); continue }
    const id = Number(db.prepare('INSERT INTO benchmark (metric, value, source, evidence_tag, measured_on, valid_from, created_at) VALUES (?,?,?,?,?,?,?)').run(b.metric, val, b.source, b.evidence_tag, b.measured_on, today, new Date().toISOString()).lastInsertRowid)
    if (cur) db.prepare('UPDATE benchmark SET superseded_by=? WHERE id=?').run(id, cur.id)
    ids.push(id); changed.push(b.metric)
  }
  const z = buildZoneSet(res), have = db.prepare('SELECT version FROM zone_set WHERE hash=?').get(z.hash)
  let version = have?.version
  if (!have) { db.prepare('UPDATE zone_set SET active=0 WHERE active=1').run(); version = Number(db.prepare('INSERT INTO zone_set (created_at, benchmark_ids, body, hash, active) VALUES (?,?,?,?,1)').run(new Date().toISOString(), JSON.stringify(ids), JSON.stringify(z.body), z.hash).lastInsertRowid) }
  else if (!db.prepare('SELECT active FROM zone_set WHERE version=?').get(version).active) { db.prepare('UPDATE zone_set SET active=0 WHERE active=1').run(); db.prepare('UPDATE zone_set SET active=1 WHERE version=?').run(version) }
  return { zone_set: version, new_zone_set: !have, changed_benchmarks: changed }
}
export { vdotFromRace }
