import test from 'node:test'
import assert from 'node:assert/strict'
import { buildSessionPrescription } from './prescription.js'

test('buildSessionPrescription: green easy run returns Go verdict and WBGT-adjusted pace band', () => {
  const res = buildSessionPrescription({
    day: { kind: 'easy', km: 8, label: 'Easy aerobic' },
    readiness: { score: 78 },
    healthRow: { sleep_hr_avg: 56, hrv_status: 'Normal' },
    vdot: 31.7,
    wbgt: 28,
  })
  assert.equal(res.verdict, 'go')
  assert.equal(res.effectiveKm, 8)
  assert.equal(res.heatPenaltyPct, 5)
  assert.equal(res.openingCap.hrMaxBpm, 152)
  assert.equal(res.fueling.needed, false)
})

test('buildSessionPrescription: Sleep HR > 67 bpm on a quality day triggers Rule [1] downgrade to easy', () => {
  const res = buildSessionPrescription({
    day: { kind: 'quality', km: 12, label: 'Threshold cruise intervals' },
    readiness: { score: 62 },
    healthRow: { sleep_hr_avg: 71, hrv_status: 'Normal' },
    vdot: 31.7,
    wbgt: 26,
  })
  assert.equal(res.verdict, 'easy_only')
  assert.ok(res.effectiveKm <= 6)
  assert.ok(res.breaches.some((b) => b.rule === '[1]'))
})

test('buildSessionPrescription: Long run >= 16 km generates timestamped CHO gel schedule and GI flush', () => {
  const res = buildSessionPrescription({
    day: { kind: 'long', km: 22, label: 'Long Run' },
    readiness: { score: 72 },
    healthRow: { sleep_hr_avg: 58, hrv_status: 'Normal' },
    vdot: 31.7,
    wbgt: 29,
  })
  assert.equal(res.verdict, 'go')
  assert.equal(res.fueling.needed, true)
  assert.equal(res.fueling.mealBufferMin, 90)
  assert.equal(res.fueling.giFlushKm, 0.7)
  assert.ok(res.fueling.gelSchedule.length >= 4)
})
