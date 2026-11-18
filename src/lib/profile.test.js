import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { makeProfile, smooth, despike } from './profile.js'

const R = JSON.parse(fs.readFileSync(new URL('../data/routes/jakim.json', import.meta.url), 'utf8'))

test('smooth / despike', () => {
  assert.deepEqual(smooth([0, 10, 20], 1).map(Math.round), [5, 10, 15]); const a = Array(30).fill(10); a[15] = 40; assert.equal(despike(a)[15], 10); assert.equal(despike(a)[3], 10)
  const ramp = Array.from({ length: 30 }, (_, i) => i); assert.deepEqual(despike(ramp), ramp) // a steady slope is not a spike
})
test('profile of a synthetic course: hill up and down', () => {
  const ele = Array.from({ length: 101 }, (_, i) => (i <= 50 ? i * 0.5 : (100 - i) * 0.5)), P = makeProfile(ele, 0.1, 10, 0) // 0 → 25 m over 5 km, back down
  assert.equal(P.n, 101); assert.ok(Math.abs(P.at(5) - 25) < 1e-9); const s = P.stats(0, 10); assert.ok(Math.abs(s.gain - 25) < 0.5 && Math.abs(s.loss - 25) < 0.5)
  assert.ok(Math.abs(P.grade(2.5) - 0.5) < 1e-6 * 100) // 0.5 m per 100 m = 0.5%
  const c = P.climbs(8, 4); assert.equal(c.length, 1); assert.equal(c[0].id, 'T1'); assert.ok(Math.abs(c[0].gain - 25) < 1)
  assert.equal(P.composition().reduce((a, x) => a + x.km, 0).toFixed(1), '10.0'); assert.equal(P.perKm().length, 10)
})
test('Jakim profile: flat course, ~5–30 m, a few gentle rises, no stadium spike at the finish', () => {
  const E = R.elevation; assert.ok(E && E.ele.length > 800 && E.stepKm === 0.05)
  const P = makeProfile(E.ele, E.stepKm, R.officialKm), all = P.stats(0, P.total)
  assert.ok(all.max < 40 && all.min > 0 && all.max - all.min < 35, 'range ' + all.min + '–' + all.max); assert.ok(all.gain > 40 && all.gain < 140, 'gain ' + all.gain)
  assert.ok(P.at(42.195) < 30, 'finish not a roof spike: ' + P.at(42.195)); assert.ok(Math.max(...Array.from({ length: 420 }, (_, i) => Math.abs(P.grade(i * 0.1 + 0.15)))) < 2.5)
  const c = P.climbs(); assert.ok(c.length >= 2 && c.length <= 6); assert.ok(c[0].a < 1 && c[0].b > 10, 'first climb: the rise from Monas to Mampang')
  const comp = P.composition(); assert.ok(comp.find((x) => x.id === 'flat').pct > 70); assert.ok(Math.abs(comp.reduce((a, x) => a + x.pct, 0) - 100) < 0.5)
  assert.ok(P.at(12.4) > P.at(0) + 10) // Mampang (south) is higher than Monas (north)
})
