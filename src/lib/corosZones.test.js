import test from 'node:test'
import assert from 'node:assert/strict'
import { zonesFromHist, hrZoneOf, hrRange, cfgOf, HR_ENDS_DEFAULT, validEnds } from './zones.js'
test('COROS zone ends: <136, 136–153, 154–162, 163–173, 174–180, >180', () => {
  const cfg = cfgOf({}); assert.deepEqual(cfg.hrEnds, [135, 153, 162, 173, 180])
  for (const [hr, z] of [[100, 1], [135, 1], [136, 2], [153, 2], [154, 3], [162, 3], [163, 4], [173, 4], [174, 5], [180, 5], [181, 6]]) assert.equal(hrZoneOf(hr, cfg), z, `hr ${hr}`)
  assert.deepEqual([1, 2, 3, 4, 5, 6].map((z) => hrRange(z, cfg)), [[0, 135], [136, 153], [154, 162], [163, 173], [174, 180], [181, 999]])
})
test('zonesFromHist counts every second at its own bpm (not a lap average)', () => {
  const z = zonesFromHist({ 130: 60, 135: 40, 136: 10, 150: 30, 160: 20, 170: 10, 175: 5, 190: 5 })
  assert.deepEqual(z, [100, 40, 20, 10, 5, 5])
})
test('per-second differs from lap-average: a lap swinging 140↔160 is not one zone', () => {
  const hist = { 140: 300, 160: 300 }, lapAvg = hrZoneOf(150, cfgOf({}))
  assert.equal(lapAvg, 2); assert.deepEqual(zonesFromHist(hist), [0, 300, 300, 0, 0, 0])   // Z2 300 s + Z3 300 s, not 600 s in Z2
})
test('validEnds needs 5 ascending positive numbers; invalid settings fall back to the default', () => {
  assert.ok(validEnds([100, 120, 140, 160, 180])); assert.ok(!validEnds([100, 100, 140, 160, 180])); assert.ok(!validEnds([1, 2]))
  assert.deepEqual(cfgOf({ hrEnds: [1, 2] }).hrEnds, HR_ENDS_DEFAULT)
})
