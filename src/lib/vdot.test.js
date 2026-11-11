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
test('gate: sleep HR 70 on Tuesday is red', () => {
  assert.equal(evaluate({ sleepHR: 70, hrv: '', pain: '', tibia: false, te: '', mealBufferMin: '', plannedMin: '', fasted: false }, 2).level, 'red')
})
