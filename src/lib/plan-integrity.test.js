import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { addDays, diffDays, mondayOf } from './dates.js'
import { parseSnapshot, classify, weekly, findings, labelOf, byDate, allByDate } from './corosplan.js'
import { buildSeason, phaseOf, SEGMENTS, RACES, weekNo } from './season.js'

const J = (p) => JSON.parse(fs.readFileSync(new URL(p, import.meta.url), 'utf8'))
const PLAN = J('../data/plan.json'), SNAP = J('../data/coros-plan.json'), ORIG = J('../../tools/data/lumpad-2027-original.json')
const TXT = fs.readFileSync(new URL('../../tools/data/coros-schedule.txt', import.meta.url), 'utf8')
const ROWS = classify(parseSnapshot(TXT)), BY = Object.fromEntries(PLAN.map((d) => [d.date, d]))

test('plan.json is exactly what tools/build_season.mjs builds (run it after editing the schedule, the original plan or season.js)', () => {
  assert.deepEqual(PLAN, JSON.parse(JSON.stringify(buildSeason(ROWS, ORIG))))
  assert.deepEqual(SNAP.map((r) => [r.date, r.km, r.sec, r.tl]), parseSnapshot(TXT).map((r) => [r.date, r.km, r.sec, r.tl]))
})
test('contiguous from 23 Nov 2026 to 31 Dec 2027, every day once; weeks W-5…W52 are Mon–Sun', () => {
  assert.equal(PLAN[0].date, '2026-11-23'); assert.equal(PLAN.at(-1).date, '2027-12-31'); assert.equal(PLAN.length, 404)
  PLAN.forEach((d, i) => assert.equal(d.date, addDays('2026-11-23', i)))
  assert.equal(BY['2027-01-04'].week, 'W1'); assert.equal(BY['2026-11-23'].week, 'W-5'); assert.equal(BY['2027-10-18'].week, 'W42'); assert.equal(weekNo('2027-12-31'), 52)
  for (const d of PLAN) assert.equal(d.week, 'W' + weekNo(d.date))
})
test('races are on the real dates and nowhere else (no other 40+ km day)', () => {
  assert.deepEqual(PLAN.filter((d) => d.kind === 'race' && d.km >= 40).map((d) => d.date), ['2027-06-13', '2027-06-20', '2027-10-24', '2027-11-14'])
  assert.deepEqual(PLAN.filter((d) => d.km >= 40).map((d) => d.date), RACES.map((r) => r.date))
  assert.match(BY['2027-10-24'].label, /A-RACE/); assert.match(BY['2027-11-14'].label, /Bormar/); assert.equal(BY['2027-10-23'].km, 5)
  assert.ok(PLAN.filter((d) => d.kind !== 'race').every((d) => d.km <= 36)) // longest training run
})
test('phases follow the race dates', () => {
  const ph = (d) => BY[d].phase
  assert.equal(ph('2026-11-23'), 'BASE'); assert.equal(ph('2027-02-10'), 'RAMADAN'); assert.equal(ph('2027-04-05'), 'BUILD'); assert.equal(ph('2027-05-10'), 'PEAK')
  assert.equal(ph('2027-06-03'), 'TAPER'); assert.equal(ph('2027-06-09'), 'C-RACE'); assert.equal(ph('2027-06-17'), 'C-RACE'); assert.equal(ph('2027-06-23'), 'RECOVERY'); assert.equal(ph('2027-07-10'), 'BASE')
  assert.equal(ph('2027-08-10'), 'BUILD'); assert.equal(ph('2027-09-20'), 'PEAK'); assert.equal(ph('2027-10-14'), 'TAPER'); assert.equal(ph('2027-10-20'), 'RACE WEEK'); assert.equal(ph('2027-10-27'), 'RECOVERY')
  assert.equal(ph('2027-11-03'), 'TAPER'); assert.equal(ph('2027-11-12'), 'C-RACE'); assert.equal(ph('2027-11-17'), 'RECOVERY'); assert.equal(ph('2027-12-20'), 'BASE')
  for (const d of PLAN) assert.equal(d.phase, phaseOf(d.date))
})
test('cycles end on the real races: race week, 1 taper week, a recovery week after each marathon', () => {
  const wk = (mon) => Math.round(PLAN.filter((d) => d.date >= mon && d.date < addDays(mon, 7)).reduce((s, d) => s + d.km, 0))
  for (const r of ['2027-06-13', '2027-10-24']) { const prev = wk(addDays(mondayOf(r), -14)), tap = wk(addDays(mondayOf(r), -7)); assert.ok(tap < prev, `taper before ${r}`) }
  for (const m of ['2027-06-21', '2027-10-25', '2027-11-15']) { assert.equal(BY[m].kind, 'rest'); assert.equal(BY[addDays(m, 1)].kind, 'rest'); assert.ok(wk(m) <= 30, 'recovery week ' + m) }
})
test('volume comes from COROS: the high-volume weeks are there (≥90 km in Mar, May, Sep)', () => {
  const wk = (mon) => PLAN.filter((d) => d.date >= mon && d.date < addDays(mon, 7)).reduce((s, d) => s + d.km, 0)
  assert.ok(wk('2027-03-01') >= 95 && wk('2027-05-03') >= 95 && wk('2027-09-13') >= 95)
  assert.equal(Math.round(PLAN.reduce((s, d) => s + d.km, 0)), 3607)
})
test('checkpoints CP1–CP20 and personal events survive; strength days come from COROS', () => {
  assert.equal(new Set(PLAN.flatMap((d) => d.tags.filter((t) => /^CP\d+$/.test(t)))).size, 20)
  assert.equal(BY['2027-01-19'].event, 'Birthday Run'); assert.equal(BY['2027-08-17'].event, 'Independence Run')
  assert.ok(PLAN.some((d) => d.tags.includes('Strength')))
})
test('segments tile the season without gaps or overlaps and keep weekdays', () => {
  assert.equal(SEGMENTS[0].from, '2026-11-23'); assert.equal(SEGMENTS.at(-1).to, '2027-12-31')
  SEGMENTS.forEach((s, i) => { if (i) assert.equal(addDays(SEGMENTS[i - 1].to, 1), s.from); if (i < SEGMENTS.length - 1) assert.equal(diffDays(s.to, s.from) % 7, 6, s.id + ' is whole weeks'); if (s.src) assert.equal(Math.abs(diffDays(s.from, s.src)) % 7, 0, s.id + ' keeps weekdays') })
})
test('classify: long = longest run of the week (≥12 km), quality by load density, ≥40 km = marathon distance, time-only = strength, no data = free run', () => {
  const c = Object.fromEntries(ROWS.map((r) => [r.date, r])), by = byDate(ROWS)
  assert.equal(by['2026-11-29'].type, 'long'); assert.equal(by['2026-11-23'].type, 'easy'); assert.equal(by['2026-12-03'].type, 'quality'); assert.equal(c['2026-11-26'].type, 'free')
  assert.equal(by['2027-04-11'].type, 'race'); assert.equal(by['2027-03-21'].type, 'long'); assert.equal(labelOf(by['2027-03-21']), 'Long run · quality')
  assert.equal(allByDate(ROWS)['2027-10-12'].map((r) => r.type).sort().join(), 'easy,strength'); assert.equal(by['2027-10-12'].km, 5)
})
test('weekly + findings: ramp, wrong COROS marathon dates, unknown races, overlaps, Ramadan, checkpoints, last long run', () => {
  const W = weekly(PLAN, ROWS), w1 = W.find((w) => w.mon === '2026-11-23'); assert.equal(w1.coros, 35.5); assert.equal(w1.lumpad, 35.5)
  const f = Object.fromEntries(findings(PLAN, ROWS, { actualAvg4: 19 }).map((x) => [x.id, x]))
  assert.match(f.ramp.body, /\+87%/); assert.equal(f['fm-stray'].tone, 'red'); assert.match(f['fm-stray'].body, /2027-04-11, 2027-07-04, 2027-09-25/); assert.match(f['fm-stray'].body, /Bormar FM 11-14/)
  assert.match(f['fm-missing'].body, /2027-06-13, 2027-06-20, 2027-10-24, 2027-11-14/); assert.ok(f.overlap0 && f.overlap1 && f.overlap2)
  assert.match(f.ramadan.title, /Ramadan/); assert.ok(f['cp-collide']); assert.match(f['lr-before-a'].body, /27 km on 10-10, 14 days/)
  assert.equal(findings(PLAN, ROWS).find((x) => x.id === 'ramp'), undefined)
})
