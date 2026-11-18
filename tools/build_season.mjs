// Builds the season from tools/data/coros-schedule.txt (+ the original Lumpad 2027 days for races, checkpoints, personal events):
//   src/data/coros-plan.json — the COROS schedule snapshot (overlay on the Day Plan page / Plan Sync, until the server has a live copy)
//   src/data/plan.json       — the season plan, 2026-11-23 → 2027-12-31 (see src/lib/season.js for the segments and phase rules)
// Usage: node tools/build_season.mjs
import fs from 'node:fs'
import { parseSnapshot, classify } from '../src/lib/corosplan.js'
import { buildSeason, SEASON_START } from '../src/lib/season.js'

const U = (p) => new URL(p, import.meta.url)
const rows = classify(parseSnapshot(fs.readFileSync(U('./data/coros-schedule.txt'), 'utf8')))
fs.writeFileSync(U('../src/data/coros-plan.json'), JSON.stringify(rows.map(({ date, km, sec, tl, code }) => ({ date, km, sec, tl, code }))) + '\n')
const orig = JSON.parse(fs.readFileSync(U('./data/lumpad-2027-original.json'), 'utf8'))
const plan = buildSeason(rows, orig)
fs.writeFileSync(U('../src/data/plan.json'), JSON.stringify(plan, null, 1) + '\n')
const km = (a, b) => Math.round(plan.filter((d) => d.date >= a && d.date <= b).reduce((s, d) => s + d.km, 0))
console.log(`season ${SEASON_START} → ${plan.at(-1).date}: ${plan.length} days, ${km('2026-11-23', '2027-12-31')} km (2027: ${km('2027-01-01', '2027-12-31')} km); coros rows ${rows.length}`)
