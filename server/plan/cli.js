// Plan engine CLI (P0, shadow). Nothing here is read by the app yet.
//   node --env-file=.env server/plan/cli.js import      one-time import of src/data/plan.json as version 1 + seed the template catalog (idempotent)
//   node server/plan/cli.js report                       kernel report on the active plan (load guard weeks, long-run cap, 48 h)
//   node server/plan/cli.js resolve                      resolve benchmarks + zone set from live data and store them (shadow)
//   node server/plan/cli.js verify                       render the effective plan and compare it with plan.json (golden)
import fs from 'node:fs'
import { planDb } from './db.js'
import { importPlan, renderDays, wibDate } from './store.js'
import { seedCatalog } from './catalog.js'
import { validate, weekReport } from './kernel.js'
import { runZoneWatch } from './zonewatch.js'
import { resolveBenchmarks } from './benchmarks.js'

const PLAN = JSON.parse(fs.readFileSync(new URL('../../src/data/plan.json', import.meta.url), 'utf8'))
const cmd = process.argv[2], db = planDb()
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)
if (cmd === 'import') { console.log(importPlan(db, PLAN), 'templates seeded:', seedCatalog(db)) }
else if (cmd === 'verify') { const r = renderDays(db); const bad = PLAN.filter((d, i) => !eq(d, r[i])).length; console.log({ days: r.length, expected: PLAN.length, differences: bad }); process.exit(bad || r.length !== PLAN.length ? 1 : 0) }
else if (cmd === 'report') {
  const days = renderDays(db), ctx = {}, plain = weekReport(days, ctx), v = validate(days, ctx)
  console.log('plan-only (weeks with 4 planned predecessors):', { judged: plain.judged, over_load_guard: plain.over }, ' violations by rule:', v.reduce((a, x) => ((a[x.rule] = (a[x.rule] || 0) + 1), a), {}))
  try {
    const { idb } = await import('../intel/db.js'), t = idb.prepare('SELECT state FROM twin_state ORDER BY version DESC LIMIT 1').get(), s = t && JSON.parse(t.state)
    if (s) { const c2 = { seed: true, weekly4w: s.load?.weekly_km_4w, longest30: s.load?.longest_run_km_30d }, w2 = weekReport(days, c2); console.log('seeded with the twin actuals', { weekly_km_4w: c2.weekly4w, longest_run_km_30d: c2.longest30 }, { judged: w2.judged, over_load_guard: w2.over }, 'first weeks', w2.rows.slice(0, 5).map((r) => `${r.monday} ${r.km}km cap ${r.cap}`)) }
  } catch (e) { console.log('twin seed unavailable:', e.message) }
}
else if (cmd === 'resolve') {
  const { db: app } = await import('../store.js'), { load } = await import('../db.js'), kv = load('kv', {}), today = wibDate()
  const fitness = app.prepare('SELECT date, threshold_pace_s_km FROM fitness_daily ORDER BY date DESC LIMIT 14').all()
  const settings = kv['lumpad.settings']?.value || {}, results = kv['lumpad.results']?.value || {}, res = resolveBenchmarks({ settings, results, fitness, today })
  console.log(Object.values(res.benchmarks).map((b) => `${b.metric}=${JSON.stringify(b.value)} (${b.source})`).join('\n')); console.log(runZoneWatch({ db, today, settings, results, fitness }))
} else { console.log('usage: import | verify | report | resolve'); process.exit(2) }
