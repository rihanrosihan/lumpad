// Single read path for the season plan (P1). PLAN_SOURCE=json (default) serves src/data/plan.json exactly as before; PLAN_SOURCE=engine serves the active
// version of plan.db (rendered in plan.json shape) and falls back to plan.json when plan.db is missing or empty, so a reader can never end up without a plan (NFR-REL-1).
// NOTE: PLAN is loaded once at process start. That is correct while the active version never changes (P1/P2); P3 (micro patches) must switch readers to planDays()/planByDate().
import JSON_PLAN from '../../src/data/plan.json' with { type: 'json' }

export const planSource = () => (process.env.PLAN_SOURCE === 'engine' ? 'engine' : 'json')

export function loadPlan({ source = planSource(), db = null } = {}) {
  if (source !== 'engine') return { days: JSON_PLAN, source: 'json', version: null }
  try {
    const d = db || getDb()
    const v = d.prepare("SELECT id FROM plan_version WHERE status='active'").get()
    if (!v) throw new Error('no active plan version')
    const days = d.prepare('SELECT s.legacy, s.kind, s.label, s.dose, s.steps, s.date FROM plan_active_day a JOIN plan_session s ON s.id=a.session_id WHERE a.slot=0 ORDER BY a.date').all()
      .map((r) => (r.legacy ? JSON.parse(r.legacy) : { date: r.date, kind: r.kind, label: r.label, km: JSON.parse(r.dose).km ?? 0, steps: JSON.parse(r.steps) }))
    if (!days.length) throw new Error('active version has no days')
    return { days, source: 'engine', version: v.id }
  } catch (e) {
    console.warn('plan: PLAN_SOURCE=engine unavailable (' + e.message + '), serving plan.json')
    return { days: JSON_PLAN, source: 'json-fallback', version: null, error: e.message }
  }
}
let dbModule = null
const getDb = () => { if (!dbModule) throw new Error('plan db not initialised'); return dbModule() }
// engine mode needs the DB opener; imported lazily so json mode never touches plan.db
if (planSource() === 'engine') { const m = await import('./db.js'); dbModule = m.planDb }

const loaded = loadPlan()
export const PLAN = loaded.days
export const PLAN_META = { source: loaded.source, version: loaded.version, error: loaded.error ?? null, days: loaded.days.length, from: loaded.days[0]?.date, to: loaded.days.at(-1)?.date }
export const planRange = (from = '0000', to = '9999') => PLAN.filter((d) => d.date >= from && d.date <= to)
export const planDay = (date) => PLAN.find((d) => d.date === date) || null

// Engine mode only: after an accepted change, refresh the plan IN PLACE. Day objects keep their identity (their fields are replaced), so the by-date maps the
// readers built at import time stay valid. Dates are not added or removed here (a macro version that changes the horizon needs a restart until P4 handles it).
export function syncPlan({ db = null } = {}) {
  if (PLAN_META.source !== 'engine') return { synced: false, reason: 'PLAN_SOURCE is not engine' }
  const next = loadPlan({ source: 'engine', db }); if (next.source !== 'engine') return { synced: false, reason: next.error }
  const have = new Map(PLAN.map((d) => [d.date, d])); let changed = 0
  for (const n of next.days) { const d = have.get(n.date); if (!d) continue; if (JSON.stringify(d) !== JSON.stringify(n)) { for (const k of Object.keys(d)) delete d[k]; Object.assign(d, n); changed++ } }
  PLAN_META.version = next.version
  return { synced: true, changed, version: next.version, new_dates: next.days.filter((n) => !have.has(n.date)).length }
}
