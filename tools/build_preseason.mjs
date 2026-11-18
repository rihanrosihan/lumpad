// Builds the COROS-derived parts of the app from tools/data/coros-schedule.txt:
//   src/data/coros-plan.json  — the COROS schedule snapshot (overlay for every date, used until the server has a live copy)
//   src/data/plan.json        — prepends the pre-season block (2026-11-23 → 2026-12-31) taken straight from the COROS schedule.
// Idempotent: days before 2027-01-01 are replaced each run. Usage: node tools/build_preseason.mjs
import fs from 'node:fs'
import { parseSnapshot, classify, labelOf, TYPE_KIND, fmtHM } from '../src/lib/corosplan.js'
import { addDays, diffDays } from '../src/lib/dates.js'

const START = '2026-11-23', JAN1 = '2027-01-01'
const rows = classify(parseSnapshot(fs.readFileSync(new URL('./data/coros-schedule.txt', import.meta.url), 'utf8')))
fs.writeFileSync(new URL('../src/data/coros-plan.json', import.meta.url), JSON.stringify(rows.map(({ date, km, sec, tl, code }) => ({ date, km, sec, tl, code }))) + '\n')

const planUrl = new URL('../src/data/plan.json', import.meta.url)
const plan = JSON.parse(fs.readFileSync(planUrl, 'utf8')).filter((d) => d.date >= JAN1)
const by = Object.fromEntries(rows.map((r) => [r.date, r]))
const pre = []
for (let d = START; d < JAN1; d = addDays(d, 1)) {
  const w = Math.floor(diffDays(d, START) / 7) - 5, week = w >= 0 ? 'W0' : 'W' + w // W-5 … W-1; the week of 28 Dec joins W0 (28 Dec–3 Jan)
  const r = by[d], base = { date: d, week, phase: 'PRE-SEASON', event: null, src: 'coros' }
  if (!r) pre.push({ ...base, km: 0, label: '', kind: 'rest', tags: [], note: 'REST DAY' })
  else pre.push({ ...base, km: r.km ?? 0, label: labelOf(r) + ' · COROS', kind: TYPE_KIND[r.type], tags: [],
    note: r.km ? `COROS plan · ${fmtHM(r.sec)}${r.tl ? ' · ' + r.tl + ' TL' : ''}` : 'COROS free-mode run — no distance target' })
}
fs.writeFileSync(planUrl, JSON.stringify([...pre, ...plan], null, 1) + '\n')
console.log(`pre-season ${pre.length} days, ${Math.round(pre.reduce((s, d) => s + d.km, 0))} km; plan now ${pre.length + plan.length} days; coros rows ${rows.length}`)
