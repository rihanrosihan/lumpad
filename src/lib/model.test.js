import test from 'node:test'
import assert from 'node:assert'
import { pmc, acwrRolling, monotonyStrain, distanceProgression, formZone, dailyLoadSeries, project } from './load.js'
import { hrvState, rhrState, quadrant, hrvSeries } from './hrv.js'
import { sleepState, asleepMin } from './sleep.js'
import { computeReadiness, weightsFor, tierOf } from './readiness.js'
import { decoupling, paceZone, compliance, tandaMarathon, muscleMap, sessionSteps, intensityDistribution, prs, cumulativeKm } from './analysis.js'
import { paces } from './vdot.js'
import { addDays } from './dates.js'

const days = (n, f, start = '2027-01-01') => Array.from({ length: n }, (_, i) => ({ date: addDays(start, i), ...f(i) }))

test('PMC: steady load converges; TSB uses yesterday; a spike raises ATL faster than CTL', () => {
  const p = pmc(days(200, () => ({ load: 100 })))
  assert.ok(Math.abs(p.at(-1).ctl - 100) < 1 && Math.abs(p.at(-1).atl - 100) < 0.1 && Math.abs(p.at(-1).tsb) < 1)
  const s = pmc([...days(60, () => ({ load: 50 })), { date: '2027-03-02', load: 300 }]), y = s.at(-2), t = s.at(-1)
  assert.equal(t.tsb, Math.round((y.ctl - y.atl) * 10) / 10)
  assert.ok(t.atl - y.atl > t.ctl - y.ctl); assert.ok(t.acwr > 1)
})
test('ACWR rolling is uncoupled (acute week excluded from chronic); needs 35 days', () => {
  const s = [...days(28, () => ({ load: 50 })), ...days(7, () => ({ load: 100 }), '2027-01-29')]
  assert.equal(acwrRolling(s), 2); assert.equal(acwrRolling(s.slice(0, 20)), null)
})
test('Monotony/strain (Foster): constant week → undefined; varied week computed', () => {
  assert.equal(monotonyStrain(days(7, () => ({ load: 50 }))).monotony, null)
  const m = monotonyStrain(days(7, (i) => ({ load: [100, 0, 80, 0, 120, 60, 0][i] })))
  assert.equal(m.weekLoad, 360); assert.ok(m.monotony > 0.9 && m.monotony < 1.2); assert.equal(m.strain, Math.round(360 * m.monotony))
})
test('form zones are relative to fitness', () => { assert.deepEqual([-40, -20, 0, 10, 40].map((x) => formZone(x).id), ['overload', 'productive', 'grey', 'fresh', 'transition']) })
test('distance progression week-on-week (Nielsen bands)', () => {
  const run = (date, km) => ({ sport_class: 'run', date, distance_m: km * 1000 }), d = distanceProgression([run('2027-01-03', 20), run('2027-01-10', 27)], '2027-01-12')
  assert.deepEqual([d.prev, d.cur, d.pct], [20, 27, 35])
})
test('projection continues the EWMA', () => { const p = project({ ctl: 50, atl: 50 }, days(7, () => ({ load: 50 }))); assert.equal(p.at(-1).ctl, 50) })
test('zero-filled daily series', () => assert.deepEqual(dailyLoadSeries([{ date: '2027-01-02', load: 9 }], '2027-01-01', '2027-01-03').map((d) => d.load), [0, 9, 0]))

const H = (n, f) => days(n, (i) => ({ hrv_avg: 80, resting_hr: 55, sleep_total_min: 480, sleep_awake_min: 20, ...f(i) }))
test('HRV: stable baseline → in corridor; a 7-day drop flags the trend; CV flagged when unstable', () => {
  const ok = hrvState(H(70, (i) => ({ hrv_avg: 80 + ((i * 7) % 5) - 2 })), '2027-03-11'); assert.ok(ok.enough && ok.z7 > -0.5 && !ok.flagTrend)
  const drop = hrvState(H(70, (i) => ({ hrv_avg: i >= 63 ? 60 : 80 + ((i * 7) % 5) - 2 })), '2027-03-11'); assert.ok(drop.flagTrend && drop.z7 < -2)
  assert.equal(hrvState(H(10, () => ({})), '2027-01-10').enough, false)
  assert.ok(hrvSeries(H(70, (i) => ({ hrv_avg: 80 + (i % 3) })), '2027-03-11').at(-1).lo != null)
})
test('RHR deviation vs 30 days; quadrant points', () => {
  const r = rhrState(H(40, (i) => ({ resting_hr: i === 39 ? 61 : 55 + (i % 2) })), '2027-02-09'); assert.ok(r.enough && r.dev > 5 && r.spike)
  assert.ok(quadrant(H(70, (i) => ({ hrv_avg: 78 + (i % 5), resting_hr: 55 + (i % 3) })), '2027-03-11').length === 7)
})
test('Sleep: asleep = total − awake (COROS total includes awake); 14-day debt', () => {
  assert.equal(asleepMin({ sleep_total_min: 393, sleep_awake_min: 136 }), 257)
  const s = sleepState(days(14, () => ({ sleep_total_min: 450, sleep_awake_min: 30 })), '2027-01-14', 480)
  assert.deepEqual([s.asleep_min, s.eff, s.vs_need_min, s.debt_min], [420, 93, -60, 840])
})
test('Readiness: weights sum to 100 in every phase; full good data → 100; caps from validated gates win', () => {
  for (const ph of ['BASE', 'PEAK', 'TAPER', 'RACE WEEK']) assert.equal(Object.values(weightsFor(ph)).reduce((a, b) => a + b, 0), 100)
  const good = { f: { pain: 0, tibia: false, energy: 5, doms: 5, hydration: 5 }, hrv: { enough: true, z7: 0, zToday: 0, cv7: 5, cvMean: 6, flagCv: false }, rhr: { enough: true, dev: 0 },
    sleep: { enough: true, asleep_min: 500, need_min: 480, debt_min: 0, nights: 14, eff: 95 }, pmcPoint: { acwr: 1.0, tsbPct: 0 }, monotony: { monotony: 1.2 }, progression: { pct: 5 }, muscleMax: 0, phase: 'BASE' }
  assert.equal(computeReadiness(good).score, 100)
  const pain = computeReadiness({ ...good, f: { ...good.f, pain: 3 } }); assert.ok(pain.score <= 44 && pain.capped && tierOf(pain.score).id === 'depleted')
  const shr = computeReadiness({ ...good, f: { ...good.f, sleepHR: 70 }, hard: true }); assert.equal(shr.score, 64)
  assert.equal(computeReadiness({ ...good, f: { ...good.f, sleepHR: 70 }, hard: false }).score, 100) // easy day: validated rule is about hard running
})
test('Readiness: missing pillars rescale; < 60 points of data → no score', () => {
  const r = computeReadiness({ f: { pain: 0, tibia: false, energy: 4, doms: 4, hydration: 4 }, rhr: { enough: true, dev: 1 }, sleep: { enough: true, asleep_min: 480, need_min: 480, debt_min: 0, nights: 14, eff: 92 }, muscleMax: 0, phase: 'BASE' })
  assert.equal(r.coverage, 56); assert.equal(r.score, null) // 30 + 6 + 20 points of data < 60
  const r2 = computeReadiness({ f: { pain: 0, tibia: false, energy: 4, doms: 4, hydration: 4 }, rhr: { enough: true, dev: 1 }, sleep: { enough: true, asleep_min: 480, need_min: 480, debt_min: 0, nights: 14, eff: 92 }, pmcPoint: { acwr: 1, tsbPct: 0 }, muscleMax: 0, phase: 'BASE' })
  assert.equal(r2.coverage, 68); assert.ok(r2.score > 85 && r2.score < 100) // rescaled to the 68 available points
  assert.equal(computeReadiness({ f: { pain: 0 } }).score, null)
})
test('Analysis: pace zones ordered; decoupling; compliance; Tanda; muscle decay; steps sum to planned km', () => {
  const p = paces(37); assert.deepEqual([p.E[0], p.M, p.T, p.I, p.R].map((x) => paceZone(x + 0.5, p)), ['E', 'M', 'T', 'I', 'R'].map((z, i) => (i === 0 ? 'E' : ['M', 'T', 'I', 'R'][i - 1] === 'M' ? 'M' : ['M', 'T', 'I', 'R'][i - 1])))
  const laps = Array.from({ length: 10 }, (_, i) => ({ distance_m: 1000, duration_s: 400, avg_hr: i < 5 ? 150 : 162 })); assert.equal(decoupling(laps).band, 'yellow')
  assert.deepEqual([compliance(10, 10.5, true), compliance(10, 8, true), compliance(10, 5, true), compliance(10, 0, true), compliance(10, 0, false)], ['ok', 'modified', 'off', 'missed', 'future'])
  assert.ok(Math.abs(tandaMarathon(50, 360) - (11.03 + 98.46 * Math.exp(-0.265) + 0.387 * 360)) < 1e-9)
  const m = muscleMap([{ type: 'lower', t: 0 }], 30 * 3.6e6); assert.ok(Math.abs(m.quads - 1.25) < 0.01 && m.shins === 0)
  for (const d of [{ kind: 'tt', km: 8, label: '5K Time Trial' }, { kind: 'quality', km: 13, label: 'M-reps 3×3 km' }, { kind: 'long', km: 30, label: 'Long Run', tags: ['MP 10'] }]) assert.ok(Math.abs(sessionSteps(d).reduce((a, s) => a + s[1], 0) - d.km) < 1.0, d.label)
})
test('Intensity distribution (3-zone), PRs within 2 % of distance, cumulative km', () => {
  const p = paces(35), acts = [{ id: 'a', sport_class: 'run', duration_s: 3000, avg_pace_s_km: p.E[1] + 30 }, { id: 'b', sport_class: 'run', duration_s: 1000, avg_pace_s_km: p.I }]
  const d = intensityDistribution(acts, {}, p); assert.deepEqual([d.low, d.high], [75, 25])
  const r = prs([{ sport_class: 'run', distance_m: 5020, duration_s: 1600, date: 'x' }, { sport_class: 'run', distance_m: 5500, duration_s: 1500 }], null); assert.ok(r['5K'] && !r['10K'])
  assert.equal(cumulativeKm([{ sport_class: 'run', date: '2027-02-03', distance_m: 5000 }], '2027-02').at(-1).km, 5)
})
