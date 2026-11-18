import test from 'node:test'
import assert from 'node:assert/strict'
import { validate, classifyBP, classifyGlucose, weightChange, windowMean, latest } from './bio.js'

test('validate: weight ranges and optional fields', () => {
  assert.equal(validate('weight', { d: '2026-11-18', kg: '75.3' }).ok, true)
  assert.equal(validate('weight', { d: '2026-11-18', kg: '12' }).ok, false)
  assert.equal(validate('weight', { d: '2026-11-18', kg: 75, bf: 70 }).ok, false)
  assert.deepEqual(validate('weight', { d: '2026-11-18', kg: 75, bf: '', lbm: '' }).entry, { d: '2026-11-18', kg: 75 })
  assert.equal(validate('weight', { d: '18-11-2026', kg: 75 }).ok, false)
})
test('validate: blood pressure must be physiologically consistent', () => {
  assert.equal(validate('bp', { d: '2026-05-02', sys: 119, dia: 78 }).ok, true)
  assert.equal(validate('bp', { d: '2026-05-02', sys: 78, dia: 119 }).ok, false)
  assert.equal(validate('bp', { d: '2026-05-02', sys: 300, dia: 80 }).ok, false)
  assert.equal(validate('bp', { d: '2026-05-02', sys: 120, dia: 80, pulse: 5 }).ok, false)
})
test('validate: glucose context defaults to random; lab needs name and value', () => {
  assert.equal(validate('glu', { d: '2026-03-01', mgdl: 93, ctx: 'fasting' }).entry.ctx, 'fasting')
  assert.equal(validate('glu', { d: '2026-03-01', mgdl: 93, ctx: 'x' }).entry.ctx, 'random')
  assert.equal(validate('glu', { d: '2026-03-01', mgdl: 10 }).ok, false)
  assert.equal(validate('lab', { d: '2026-01-19', name: 'HbA1c', value: '5.1', unit: '%' }).ok, true)
  assert.equal(validate('lab', { d: '2026-01-19', name: '', value: '5.1' }).ok, false)
})
test('classifyBP follows ACC/AHA categories (highest of the two wins)', () => {
  assert.equal(classifyBP(119, 78).id, 'normal')
  assert.equal(classifyBP(125, 75).id, 'elevated')
  assert.equal(classifyBP(118, 82).id, 'stage1')
  assert.equal(classifyBP(135, 70).id, 'stage1')
  assert.equal(classifyBP(150, 85).id, 'stage2')
  assert.equal(classifyBP(null, 80), null)
})
test('classifyGlucose: fasting vs non-fasting thresholds', () => {
  assert.equal(classifyGlucose(93, 'fasting').id, 'normal')
  assert.equal(classifyGlucose(110, 'fasting').id, 'impaired')
  assert.equal(classifyGlucose(130, 'fasting').id, 'high')
  assert.equal(classifyGlucose(130, 'post').id, 'normal')
  assert.equal(classifyGlucose(156, 'post').id, 'elevated')
  assert.equal(classifyGlucose(57, 'fasting').id, 'low')
})
test('weightChange and windowMean', () => {
  const w = [{ d: '2026-01-01', kg: 78 }, { d: '2026-02-20', kg: 77 }, { d: '2026-04-01', kg: 75 }]
  assert.deepEqual(weightChange(w, 90), { kg: -3, since: '2026-01-01' })
  assert.equal(weightChange([{ d: '2026-01-01', kg: 78 }]), null)
  const bp = [{ d: '2026-05-01', sys: 120 }, { d: '2026-05-02', sys: 130 }, { d: '2026-03-01', sys: 100 }]
  assert.deepEqual(windowMean(bp, 'sys', '2026-05-02', 30), { n: 2, mean: 125 })
  assert.equal(latest(bp).d, '2026-05-02')
})
