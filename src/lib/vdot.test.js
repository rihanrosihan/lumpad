import test from 'node:test'
import assert from 'node:assert'
import { vdotFromRace, paces, fmtPace, fmtTime, parseTime } from './vdot.js'
test('baseline 10K 1:00:55 ≈ VDOT 31.7', () => {
  assert.ok(Math.abs(vdotFromRace(10000, parseTime('1:00:55')) - 31.7) < 0.15)
})
test('VDOT 37.9 marathon ≈ 4:00 and MP ≈ 5:41', () => {
  const p = paces(37.9); console.log(fmtTime(p.full), fmtPace(p.M), fmtPace(p.T), fmtPace(p.I), fmtPace(p.E[0]), fmtPace(p.E[1]))
  assert.ok(Math.abs(p.full - 14400) < 90)
})
test('table row 31.7', () => {
  const p = paces(31.7); console.log(fmtTime(p.fiveK), fmtPace(p.T), fmtPace(p.I), fmtPace(p.M), fmtPace(p.E[0]), fmtPace(p.E[1]))
})
import { killGate } from './plan.js'
import { evaluate } from './gate.js'
test('kill gate: two reds from CP4', () => {
  assert.equal(killGate({ 4: { vdot: 31 }, 6: { vdot: 31 } }).fired, true)
  assert.equal(killGate({ 4: { vdot: 31 }, 6: { vdot: 34.4 } }).fired, false)
  assert.equal(killGate({ 11: { ratio: 0.8 } }).fired, true)
})
test('gate: easy day', () => { assert.equal(evaluate({ sleepHR: 70, hrv: '', pain: '', tibia: false, te: '', mealBufferMin: '', plannedMin: '', fasted: false }, { kind: 'easy', tags: [] }).level, 'yellow') })
test('gate: sleep HR 70 before a quality session is red, before easy is yellow', () => {
  assert.equal(evaluate({ sleepHR: 70, hrv: '', pain: '', tibia: false, te: '', mealBufferMin: '', plannedMin: '', fasted: false }, { kind: 'quality', tags: [] }).level, 'red')
})
import { CHECKPOINTS, cpDistance } from './plan.js'
import { raceTime } from './vdot.js'
test('G/R thresholds match the poster (±6s: lines are shown rounded to 0.1)', () => {
  const poster = { 1: ['29:42', '30:31'], 2: ['29:28', '30:16'], 3: ['28:42', '29:28'], 4: ['58:35', '1:00:07'], 6: ['27:42', '28:24'], 8: ['56:14', '57:38'], 10: ['26:11', '26:48'], 11: ['2:04:06', '2:07:10'], 12: ['25:27', '26:02'], 15: ['24:57', '25:31'] }
  for (const [id, [g, r]] of Object.entries(poster)) {
    const c = CHECKPOINTS.find((x) => x.id === +id), d = cpDistance(c)
    const G = raceTime(c.line - 0.5, d), R = raceTime(c.line - 1.5, d)
    console.log('CP' + id, fmtTime(G), g, fmtTime(R), r)
    assert.ok(Math.abs(G - parseTime(g)) <= (d > 10000 ? 12 : 6), `CP${id} G ${fmtTime(G)} vs ${g}`)
    assert.ok(Math.abs(R - parseTime(r)) <= (d > 10000 ? 12 : 6), `CP${id} R ${fmtTime(R)} vs ${r}`)
  }
})
