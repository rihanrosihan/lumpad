// Opt-in client read path for the adaptive plan engine (P1). OFF by default: the bundled src/data/plan.json is used exactly as before.
// ON (build: VITE_PLAN_SOURCE=engine · device: localStorage lumpad.planApi=1 · one visit: ?plan=api):
//   - calendar.js reads a validated copy of the server plan from localStorage at import time (synchronous, so no module ever sees two plans),
//   - refreshPlan() (called once after the app renders) fetches /api/plan/range in the background and updates that copy for the next launch,
//   - offline, the last good copy keeps working; an invalid or missing copy falls back to the bundled plan.
export const CACHE_KEY = 'lumpad.plan.cache.v1'
const DATE = /^\d{4}-\d{2}-\d{2}$/

export function planApiEnabled(env = {}, storage = null, search = '') {
  try { return env.VITE_PLAN_SOURCE === 'engine' || storage?.getItem('lumpad.planApi') === '1' || new URLSearchParams(search).get('plan') === 'api' } catch { return false }
}
// shape check: a day must have what every screen reads; dates strictly increasing; at least a season's worth of days
export function validPlan(days, { min = 30 } = {}) {
  if (!Array.isArray(days) || days.length < min) return false
  let prev = ''
  for (const d of days) {
    if (!d || typeof d !== 'object' || !DATE.test(d.date || '') || d.date <= prev || typeof d.kind !== 'string' || typeof d.km !== 'number' || !Number.isFinite(d.km) || typeof d.week !== 'string') return false
    prev = d.date
  }
  return true
}
export function readCache(storage) {
  try { const c = JSON.parse(storage.getItem(CACHE_KEY)); return validPlan(c?.days) ? c : null } catch { return null }
}
// choose the plan for this launch: the cached server plan when the path is enabled and the cache is valid, else the bundled one
export function choosePlan(bundled, { enabled, storage }) {
  if (!enabled) return { days: bundled, source: 'bundled' }
  const c = readCache(storage)
  return c ? { days: c.days, source: 'cache', version: c.version ?? null, saved_at: c.saved_at } : { days: bundled, source: 'bundled' }
}
export async function refreshPlan({ fetchFn = fetch, storage, enabled, onChange } = {}) {
  if (!enabled) return { skipped: true }
  try {
    const r = await fetchFn('/api/plan/range'); if (!r.ok) throw new Error('HTTP ' + r.status)
    const j = await r.json(); if (!validPlan(j.days)) throw new Error('invalid plan from server')
    const old = readCache(storage), changed = !old || JSON.stringify(old.days) !== JSON.stringify(j.days)
    if (changed) { storage.setItem(CACHE_KEY, JSON.stringify({ saved_at: new Date().toISOString(), source: j.source ?? null, version: j.version ?? null, days: j.days })); onChange?.({ version: j.version ?? null, first: !old }) }
    return { ok: true, changed, version: j.version ?? null }
  } catch (e) { return { ok: false, error: e.message } }
}
