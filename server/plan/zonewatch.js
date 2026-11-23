// Benchmark watch (P2): resolve benchmarks, apply hysteresis, store a new zone set when they moved, and raise triggers.
//   - a zone-set change raises a 'render' trigger and NEVER creates a plan version (sessions are symbolic, so everything re-prices by itself)
//   - a 'macro' trigger (held until P4) is raised only when the goal arithmetic moved: |dVDOT| >= 1.0 vs the planning VDOT, the kill gate fired, or the CP11 ratio < 0.85
//   - hysteresis: a COROS-derived threshold pace must move >= 6 s/km from the stored one to count; TT results and athlete overrides apply at once
import { resolveBenchmarks, persist } from './benchmarks.js'
import { killGate } from '../../src/lib/plan.js'
import { TARGET } from '../../src/lib/plan.js'

export const TPACE_HYSTERESIS_S = 6, MACRO_DVDOT = 1.0
const cur = (db, metric) => db.prepare('SELECT value, source FROM benchmark WHERE metric=? AND superseded_by IS NULL ORDER BY id DESC LIMIT 1').get(metric)

export function applyHysteresis(db, res) {
  const t = res.benchmarks.tpace_s, c = cur(db, 'tpace_s'), stored = c && String(c.source).startsWith('coros:')
  // missing data never reverts a stored measured value to a seed default; a COROS value inside the noise band is held
  if (stored && (t.source.startsWith('seed') || (t.source === 'coros:fitness_daily' && Math.abs(JSON.parse(c.value) - t.value) < TPACE_HYSTERESIS_S))) {
    res.benchmarks.tpace_s = { ...t, value: JSON.parse(c.value), source: c.source, held: true } // within noise: keep the stored value
    res.cfg = { ...res.cfg, tpace: JSON.parse(c.value) }
  }
  return res
}
function planningVdot(db) {
  const v = db.prepare("SELECT zone_set_version FROM plan_version WHERE status='active'").get()
  const z = v?.zone_set_version && db.prepare('SELECT body FROM zone_set WHERE version=?').get(v.zone_set_version)
  return z ? JSON.parse(z.body).daniels.vdot : TARGET.baseline
}
const trig = (db, type, dedupe, payload, route) => Number(db.prepare('INSERT OR IGNORE INTO plan_trigger (at, type, source, dedupe_key, payload, route) VALUES (?,?,?,?,?,?)').run(new Date().toISOString(), type, 'nightly', dedupe, JSON.stringify(payload), route).changes)

// in: { db: plan.db, today, settings, results, fitness }. Returns what happened (also safe to call repeatedly: idempotent).
export function runZoneWatch({ db, today, settings = {}, results = {}, fitness = [] }) {
  const before = db.prepare('SELECT version FROM zone_set WHERE active=1').get()?.version ?? null
  const res = applyHysteresis(db, resolveBenchmarks({ settings, results, fitness, today })), p = persist(db, res, { today }), out = { ...p, triggers: [] }
  if (p.new_zone_set) {
    const dedupe = `bench:zs${p.zone_set}`
    if (trig(db, 'benchmark', dedupe, { from_zone_set: before, to_zone_set: p.zone_set, changed: p.changed_benchmarks, values: Object.fromEntries(Object.entries(res.benchmarks).map(([k, b]) => [k, { value: b.value, source: b.source }])) }, 'render')) out.triggers.push({ type: 'benchmark', route: 'render' })
  }
  const dv = res.benchmarks.vdot.value - planningVdot(db)
  if (Math.abs(dv) >= MACRO_DVDOT && trig(db, 'goal_change', `macro:vdot:${res.benchmarks.vdot.value}`, { reason: 'dVDOT', planning: planningVdot(db), now: res.benchmarks.vdot.value, delta: Math.round(dv * 100) / 100 }, 'macro')) out.triggers.push({ type: 'goal_change', route: 'macro', why: 'dVDOT' })
  let kg = null; try { kg = killGate(results) } catch {}
  if (kg?.fired && trig(db, 'goal_change', `macro:killgate:${kg.why}`, { reason: 'kill_gate', why: kg.why }, 'macro')) out.triggers.push({ type: 'goal_change', route: 'macro', why: 'kill_gate' })
  return out
}
// active zone set with provenance, for the API and the Profile screen
export function activeZones(db) {
  const z = db.prepare('SELECT version, created_at, benchmark_ids, body FROM zone_set WHERE active=1').get(); if (!z) return null
  const ids = JSON.parse(z.benchmark_ids), rows = db.prepare(`SELECT id, metric, value, source, evidence_tag, measured_on, valid_from FROM benchmark WHERE id IN (${ids.map(() => '?').join(',') || 'NULL'})`).all(...ids)
  return { zone_set: { version: z.version, created_at: z.created_at, ...JSON.parse(z.body) }, benchmarks: rows.map((r) => ({ ...r, value: JSON.parse(r.value), label: String(r.source).startsWith('override') ? 'override' : String(r.source).startsWith('seed') ? 'default' : 'measured' })) }
}
