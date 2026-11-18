import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { addDays, diffDays } from './dates.js'
import { parseSnapshot, classify, weekly, findings, labelOf } from './corosplan.js'

const PLAN = JSON.parse(fs.readFileSync(new URL('../data/plan.json', import.meta.url), 'utf8'))
const SNAP = JSON.parse(fs.readFileSync(new URL('../data/coros-plan.json', import.meta.url), 'utf8'))
const TXT = fs.readFileSync(new URL('../../tools/data/coros-schedule.txt', import.meta.url), 'utf8')

test('plan is contiguous from 23 Nov 2026 to 31 Dec 2027, every day once', () => {
  assert.equal(PLAN[0].date, '2026-11-23'); assert.equal(PLAN.at(-1).date, '2027-12-31')
  PLAN.forEach((d, i) => assert.equal(d.date, addDays('2026-11-23', i), 'gap at index ' + i))
  assert.equal(PLAN.length, diffDays('2027-12-31', '2026-11-23') + 1)
})
test('pre-season weeks W-5…W-1 are Mon–Sun, week of 28 Dec joins W0, phase PRE-SEASON up to 31 Dec', () => {
  const pre = PLAN.filter((d) => d.date < '2027-01-01'), weeks = [...new Set(pre.map((d) => d.week))]
  assert.deepEqual(weeks, ['W-5', 'W-4', 'W-3', 'W-2', 'W-1', 'W0'])
  assert.ok(pre.every((d) => d.phase === 'PRE-SEASON' && d.src === 'coros'))
  assert.equal(PLAN.find((d) => d.date === '2026-11-23').km, 8)
  assert.equal(Math.round(pre.filter((d) => d.week === 'W-5').reduce((s, d) => s + d.km, 0) * 10) / 10, 35.5)
})
test('2027 Lumpad plan is untouched (races, checkpoints, total)', () => {
  const y = PLAN.filter((d) => d.date >= '2027-01-01')
  assert.equal(y.length, 365); assert.equal(Math.round(y.reduce((s, d) => s + d.km, 0) * 10) / 10, 2872.7)
  assert.deepEqual(y.filter((d) => d.kind === 'race').map((d) => d.date), ['2027-06-13', '2027-06-16', '2027-06-20', '2027-10-23', '2027-10-24'])
  assert.equal(new Set(y.flatMap((d) => d.tags.filter((t) => /^CP\d+$/.test(t)))).size, 20)
})
test('bundled COROS snapshot = tools/data/coros-schedule.txt (run node tools/build_preseason.mjs after editing it)', () => {
  const rows = parseSnapshot(TXT); assert.equal(SNAP.length, rows.length)
  assert.deepEqual(SNAP.map((r) => [r.date, r.km, r.sec, r.tl]), rows.map((r) => [r.date, r.km, r.sec, r.tl]))
  assert.equal(SNAP[0].date, '2026-11-23'); assert.equal(SNAP.at(-1).date, '2027-12-18')
})
test('classify: long = longest run of the week (≥12 km), quality by load density, ≥40 km = marathon distance, no km = free run', () => {
  const c = Object.fromEntries(classify(parseSnapshot(TXT)).map((r) => [r.date, r]))
  assert.equal(c['2026-11-29'].type, 'long'); assert.equal(c['2026-11-23'].type, 'easy'); assert.equal(c['2026-12-03'].type, 'quality')
  assert.equal(c['2026-11-26'].type, 'free'); assert.equal(classify(parseSnapshot(TXT)).filter((r) => r.date === '2027-10-12').map((r) => r.type).sort().join(), 'easy,strength'); assert.equal(c['2027-04-11'].type, 'race'); assert.equal(c['2027-03-21'].type, 'long'); assert.equal(labelOf(c['2027-03-21']), 'Long run · quality')
})
test('weekly + findings: ramp, overlaps, stray marathon days, tail after the last COROS workout', () => {
  const rows = classify(parseSnapshot(TXT)), W = weekly(PLAN, rows), w1 = W.find((w) => w.mon === '2026-11-23')
  assert.equal(w1.coros, 35.5); assert.equal(w1.lumpad, 35.5)
  const f = Object.fromEntries(findings(PLAN, rows, { actualAvg4: 19 }).map((x) => [x.id, x]))
  assert.equal(f.ramp.tone, 'yellow'); assert.match(f.ramp.body, /\+87%/)
  assert.ok(f.overlap0 && f.overlap1); assert.match(f['fm-stray'].body, /2027-04-11, 2027-07-04, 2027-09-25/)
  assert.match(f['fm-missing'].body, /2027-06-13/); assert.equal(f.tail, undefined) /* Plan D runs to 18 Dec 2027 */; assert.ok(f.overlap2); assert.ok(f['vol-high'] && f['vol-low'] && f['post-race']); assert.match(f['post-race'].body, /23 km long run/)
  assert.equal(findings(PLAN, rows).find((x) => x.id === 'ramp'), undefined) // no recent-actuals → no ramp claim
})
test('several sessions on one date: byDate = the run, allByDate = all', async () => {
  const { byDate, allByDate } = await import('./corosplan.js'), rows = classify(parseSnapshot(TXT))
  assert.equal(byDate(rows)['2027-10-12'].km, 5); assert.equal(allByDate(rows)['2027-10-12'].length, 2)
  assert.equal(findings(PLAN, rows).find((x) => x.id === 'fm-missing').body.includes('2027-10-24 — the COROS plans treat') || /2027-10-24/.test(findings(PLAN, rows).find((x) => x.id === 'fm-missing').body), true)
})
