import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { addDays, diffDays, mondayOf } from './dates.js'
import { parseSnapshot, classify, weekly, findings, labelOf, byDate, allByDate } from './corosplan.js'
import { buildSeason, phaseOf, SEGMENTS, RACES, RACE_BY_DATE, weekNo, weekSource } from './season.js'
import { fromCoros, timeTrial } from './workouts.js'
import { estimate, stepKm, describe, summary, hrRange, paceRange, flat } from './zones.js'
import { CHECKPOINTS } from './plan.js'

const J = (p) => JSON.parse(fs.readFileSync(new URL(p, import.meta.url), 'utf8'))
const PLAN = J('../data/plan.json'), SNAP = J('../data/coros-plan.json'), ORIG = J('../../tools/data/lumpad-2027-original.json')
const TXT = fs.readFileSync(new URL('../../tools/data/coros-schedule.txt', import.meta.url), 'utf8')
const ROWS = classify(parseSnapshot(TXT)), BY = Object.fromEntries(PLAN.map((d) => [d.date, d]))
const wk = (mon) => PLAN.filter((d) => d.date >= mon && d.date < addDays(mon, 7))
const km = (mon) => Math.round(wk(mon).reduce((s, d) => s + d.km, 0) * 10) / 10

test('plan.json is exactly what tools/build_season.mjs builds (run it after editing the schedule, season.js or the checkpoints)', () => {
  assert.deepEqual(PLAN, JSON.parse(JSON.stringify(buildSeason(ROWS, ORIG))))
  assert.deepEqual(SNAP.map((r) => [r.date, r.km, r.sec, r.tl]), parseSnapshot(TXT).map((r) => [r.date, r.km, r.sec, r.tl]))
})
test('contiguous 23 Nov 2026 → 31 Dec 2027; weeks W-5…W52 are Mon–Sun', () => {
  assert.equal(PLAN[0].date, '2026-11-23'); assert.equal(PLAN.at(-1).date, '2027-12-31'); assert.equal(PLAN.length, 404)
  PLAN.forEach((d, i) => assert.equal(d.date, addDays('2026-11-23', i)))
  assert.equal(BY['2027-01-04'].week, 'W1'); assert.equal(BY['2026-11-23'].week, 'W-5'); assert.equal(BY['2027-10-18'].week, 'W42')
  for (const d of PLAN) assert.equal(d.week, 'W' + weekNo(d.date))
})
test('COROS plan A pattern: weeks map to plan A weeks so each race week is A20', () => {
  assert.equal(weekSource(-5), 1); assert.equal(weekSource(11), 17); assert.equal(weekSource(12), 9); assert.equal(weekSource(23), 20)
  assert.equal(weekSource(26), 4); assert.equal(weekSource(42), 20); assert.equal(weekSource(45), 20); assert.equal(weekSource(47), 1)
  // the original dates of plan A are kept up to W11 (except the checkpoint days)
  for (const d of PLAN.filter((x) => x.date <= '2027-03-21' && x.src === 'coros' && x.km > 0)) assert.equal(d.from, d.date)
  // weekday pattern of a build week: Mon easy · Tue threshold · Wed easy · Thu rest · Fri steady · Sat easy · Sun long
  assert.deepEqual(wk('2027-08-09').map((d) => d.kind), ['easy', 'quality', 'easy', 'rest', 'quality', 'easy', 'long'])
})
test('high mileage: three 96 km peaks, season above the COROS plans in distance and load', () => {
  assert.equal(km('2027-03-01'), 96); assert.equal(km('2027-05-03'), 96); assert.equal(km('2027-09-13'), 96)
  const last = '2027-12-18', s = PLAN.filter((d) => d.date <= last)
  assert.ok(s.reduce((a, d) => a + d.km, 0) > SNAP.reduce((a, r) => a + (r.km || 0), 0) * 1.1)
  assert.ok(s.reduce((a, d) => a + (d.tl || 0), 0) > SNAP.reduce((a, r) => a + (r.tl || 0), 0))
})
test('races on the real dates with their class, target and status; nothing else ≥ 40 km', () => {
  assert.deepEqual(PLAN.filter((d) => d.km >= 40).map((d) => d.date), RACES.map((r) => r.date))
  const c = (d) => [RACE_BY_DATE[d].cls, RACE_BY_DATE[d].target, RACE_BY_DATE[d].reg]
  assert.deepEqual(c('2027-06-13'), ['B', 'sub 5:00', 'registered']); assert.deepEqual(c('2027-06-20'), ['D', null, 'no-info'])
  assert.deepEqual(c('2027-10-24'), ['A', 'sub 4:00', 'not-open']); assert.deepEqual(c('2027-11-14'), ['C', null, 'no-info'])
  assert.match(BY['2027-06-13'].label, /B-race/); assert.match(BY['2027-06-20'].label, /D-race/); assert.match(BY['2027-11-14'].label, /C-race/); assert.match(BY['2027-10-24'].label, /A-RACE/)
  assert.deepEqual(BY['2027-10-24'].steps[0].pace, [336, 341]); assert.deepEqual(BY['2027-06-13'].steps[0].pace, [420, 426])
  assert.equal(BY['2027-10-23'].label, 'JRF Half · bib jog'); assert.equal(BY['2027-06-16'].label, 'G-MJM gate jog 20′')
  assert.ok(!PLAN.some((d) => d.phase === 'C-RACE'))
})
test('taper and recovery around every marathon', () => {
  for (const r of ['2027-06-13', '2027-10-24', '2027-11-14']) assert.ok(km(addDays(mondayOf(r), -7)) < km(addDays(mondayOf(r), -14)) || r === '2027-11-14', 'taper ' + r)
  for (const m of ['2027-06-21', '2027-10-25', '2027-11-15']) { assert.equal(BY[m].kind, 'rest'); assert.equal(BY[addDays(m, 1)].kind, 'rest'); assert.ok(km(m) <= 30) }
})
test('phases follow the race dates', () => {
  const ph = (d) => BY[d].phase
  assert.equal(ph('2026-11-23'), 'BASE'); assert.equal(ph('2027-02-10'), 'RAMADAN'); assert.equal(ph('2027-04-05'), 'BUILD'); assert.equal(ph('2027-05-10'), 'PEAK')
  assert.equal(ph('2027-06-03'), 'TAPER'); assert.equal(ph('2027-06-09'), 'RACE WEEK'); assert.equal(ph('2027-06-17'), 'RACE WEEK'); assert.equal(ph('2027-06-23'), 'RECOVERY')
  assert.equal(ph('2027-07-10'), 'BASE'); assert.equal(ph('2027-08-10'), 'BUILD'); assert.equal(ph('2027-09-20'), 'PEAK'); assert.equal(ph('2027-10-14'), 'TAPER')
  assert.equal(ph('2027-10-20'), 'RACE WEEK'); assert.equal(ph('2027-10-27'), 'RECOVERY'); assert.equal(ph('2027-11-03'), 'TAPER'); assert.equal(ph('2027-11-12'), 'RACE WEEK'); assert.equal(ph('2027-12-20'), 'BASE')
  for (const d of PLAN) assert.equal(d.phase, phaseOf(d.date))
})
test('checkpoints: 20, ascending dates, each on its plan day; TTs are real time-trial sessions with a target pace', () => {
  assert.equal(CHECKPOINTS.length, 20); CHECKPOINTS.forEach((c, i) => i && assert.ok(c.date > CHECKPOINTS[i - 1].date, 'CP' + c.id))
  for (const c of CHECKPOINTS) { const d = BY[c.date]; assert.ok(d.tags.includes('CP' + c.id), 'CP' + c.id)
    if (c.kind === 'tt') { assert.equal(d.kind, 'tt'); const tt = flat(d.steps).find((s) => s.t === 'tt'); assert.ok(tt.pace, 'pace for CP' + c.id) }
    if (c.kind === 'lr') assert.ok(d.km >= 9, 'CP' + c.id + ' on a real session') }
  assert.equal(BY['2026-12-19'].km, 9); assert.equal(BY['2027-04-17'].km, 14); assert.equal(BY['2027-08-28'].km, 25.1)
  assert.equal(BY['2027-01-19'].event, 'Birthday Run'); assert.equal(BY['2027-08-17'].event, 'Independence Run')
})
test('every running day has a structured workout with HR and pace targets', () => {
  for (const d of PLAN.filter((x) => x.km > 0)) {
    assert.ok(d.steps?.length, 'steps ' + d.date); assert.ok(d.sec > 0 && d.tl > 0, 'time/TL ' + d.date)
    assert.ok(Math.abs(stepKm(d.steps) - d.km) < 0.01, 'km ' + d.date)
    for (const r of describe(d.steps).flatMap((x) => (x.rep ? x.steps : [x]))) if (r.what !== 'Warm-up' && r.what !== 'Cool-down') assert.ok(r.pace || r.hr || r.what === 'Free run', 'target ' + d.date)
  }
})
test('plan A courses rebuild exactly (distance, COROS time and load within 3%)', () => {
  const cases = [['P10547', 18.4, 7921, 364], ['P10547', 12, 5548, 218], ['P10547', 17.5, 7222, 385], ['P10544', 19.2, 8848, 299], ['P10544', 9.2, 4467, 151], ['P10545', 27, 11561, 477], ['P10541', 13, 5972, 221], ['P10540', 8, 4279, 103], ['P10594', 16, 7959, 206]]
  for (const [code, k, sec, tl] of cases) { const w = fromCoros(code, k), e = estimate(w.steps); assert.equal(stepKm(w.steps), k, code + ' ' + k); assert.ok(Math.abs(e.sec / sec - 1) < 0.03, code + ' time'); assert.ok(Math.abs(e.tl / tl - 1) < 0.03, code + ' load') }
  assert.equal(summary(fromCoros('P10547', 18.4).steps), 'WU 5′ · 4× (1.6 km Z2 + 3 km Z4) · CD 5′')
  assert.deepEqual(hrRange(2), [145, 151]); assert.deepEqual(paceRange(4), [360, 374]); assert.deepEqual(hrRange(4, { lthr: 180, tpace: 300 }), [171, 178])
  assert.equal(stepKm(timeTrial(5000, 400).steps), 9)
})
test('segments cover the season without gaps', () => { assert.equal(SEGMENTS[0].from, '2026-11-23'); assert.equal(SEGMENTS.at(-1).to, '2027-12-31'); SEGMENTS.forEach((s, i) => i && assert.equal(addDays(SEGMENTS[i - 1].to, 1), s.from)) })
test('classify COROS rows', () => {
  const c = Object.fromEntries(ROWS.map((r) => [r.date, r])), by = byDate(ROWS)
  assert.equal(by['2026-11-29'].type, 'long'); assert.equal(by['2026-12-03'].type, 'quality'); assert.equal(c['2026-11-26'].type, 'free'); assert.equal(by['2027-04-11'].type, 'race')
  assert.equal(labelOf(by['2027-03-21']), 'Long run · quality'); assert.equal(allByDate(ROWS)['2027-10-12'].map((r) => r.type).sort().join(), 'easy,strength')
})
test('findings: ramp, wrong COROS marathon dates, races unknown to the watch, overlaps, Ramadan, volume, last long run', () => {
  const W = weekly(PLAN, ROWS); assert.equal(W.find((w) => w.mon === '2026-11-23').coros, 35.5)
  const f = Object.fromEntries(findings(PLAN, ROWS, { actualAvg4: 19 }).map((x) => [x.id, x]))
  assert.match(f.ramp.body, /\+87%/); assert.equal(f['fm-stray'].tone, 'red'); assert.match(f['fm-stray'].body, /2027-04-11, 2027-07-04, 2027-09-25/)
  assert.match(f['fm-missing'].body, /2027-06-13, 2027-06-20, 2027-10-24, 2027-11-14/); assert.ok(f.overlap0 && f.overlap1 && f.overlap2)
  assert.match(f.ramadan.title, /Ramadan/); assert.equal(f.volume.tone, 'green'); assert.match(f['lr-before-a'].body, /27 km on 10-10, 14 days/)
  assert.equal(findings(PLAN, ROWS).find((x) => x.id === 'ramp'), undefined)
})
