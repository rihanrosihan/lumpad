import test from 'node:test'
import assert from 'node:assert/strict'
import { hrZoneOf, paceZoneOf, zoneSeconds, hrRange, paceRange, ZONE_DEFAULTS as C } from './zones.js'

test('HR zone bands follow % of LTHR (168): the same zones as the plan and the watch', () => {
  assert.equal(hrZoneOf(100, C), 0)       // < 65 %
  assert.equal(hrZoneOf(130, C), 1)       // Z1 ≤ 84 %
  assert.equal(hrZoneOf(148, C), 2)       // 88 %
  assert.equal(hrZoneOf(155, C), 3)       // 92 %
  assert.equal(hrZoneOf(164, C), 4)       // 98 % -> threshold
  assert.equal(hrZoneOf(170, C), 5)
  assert.equal(hrZoneOf(180, C), 6)
  assert.equal(hrZoneOf(null, C), null)
})
test('pace zones follow % of threshold pace (5:56): the same zones the plan prescribes', () => {
  assert.equal(paceZoneOf(900, C), 0)     // walking
  assert.equal(paceZoneOf(537, C), 0)     // 8:57/km = 151 % of threshold: slower than Z1
  assert.equal(paceZoneOf(480, C), 1)     // 8:00/km
  assert.equal(paceZoneOf(430, C), 2)     // 7:10/km
  assert.equal(paceZoneOf(380, C), 3)
  assert.equal(paceZoneOf(360, C), 4)     // ≈ threshold
  assert.equal(paceZoneOf(345, C), 5)
  assert.equal(paceZoneOf(320, C), 6)
})
test('zone boundaries agree with the ranges shown in the plan (paceRange / hrRange fall in their own zone)', () => {
  for (const z of [1, 2, 3, 4, 5]) {
    const [lo, hi] = hrRange(z, C); assert.equal(hrZoneOf(lo, C), z); assert.equal(hrZoneOf(hi, C), z)
    const [fast, slow] = paceRange(z, C); assert.equal(paceZoneOf(Math.round((fast + slow) / 2), C), z)
  }
})
test('zoneSeconds is time-weighted and keeps pace and HR separate (a hot slow run: easy pace, high HR)', () => {
  const laps = Array.from({ length: 10 }, () => ({ duration_s: 540, avg_pace_s_km: 537, avg_hr: 162 }))
  const z = zoneSeconds(laps, C)
  assert.equal(z.pace[0], 5400); assert.equal(z.hr[4], 5400); assert.equal(z.hr.reduce((a, b) => a + b, 0), 5400)
})
