import test from 'node:test'
import assert from 'node:assert'
import { tsMs, hoursBack, airAtHour, airSign, googleTileUrl } from './geo.js'
test('tsMs accepts seconds or milliseconds', () => { assert.equal(tsMs(1700000000), 1700000000000); assert.equal(tsMs(1700000000000), 1700000000000); assert.equal(tsMs(null), null) })
test('hoursBack covers the start and is clamped', () => { const n = 1e12; assert.equal(hoursBack(n - 5 * 3600e3, n), 7); assert.equal(hoursBack(n - 9999 * 3600e3, n), 720); assert.equal(hoursBack(n + 1e6, n), 2); assert.equal(hoursBack(n + 99 * 3600e3, n), 1) })
test('airAtHour picks the nearest hour within 90 minutes, else null', () => {
  const hs = [{ at: '2026-11-20T01:00:00Z', n: 1 }, { at: '2026-11-20T02:00:00Z', n: 2 }]
  assert.equal(airAtHour(hs, Date.parse('2026-11-20T01:50:00Z')).n, 2); assert.equal(airAtHour(hs, Date.parse('2026-11-20T05:00:00Z')), null); assert.equal(airAtHour([], 1), null)
})
test('airSign and tile url', () => { assert.deepEqual(airSign('Good air quality'), ['Good', 'good']); assert.deepEqual(airSign(null), ['—', 'normal']); assert.match(googleTileUrl('satellite'), /t=satellite$/) })
import { svgRoute, elevPath, gpx, localIso, leaveBy, bearing, courseHeading } from './geo.js'
test('svgRoute fits the box; elevPath handles gaps; gpx lists points', () => {
  const r = svgRoute([[0, 0], [1, 1]], 100, 100, 10); assert.match(r.d, /^M/); assert.ok(r.proj([0, 0])[1] >= 80); assert.equal(svgRoute([]).d, ''); assert.equal(elevPath([5]), ''); assert.match(elevPath([1, 5, 3, null]), /^M0\.0 /)
  assert.equal((gpx('a<b', [[1, 2], [3, 4]]).match(/<trkpt/g) || []).length, 2); assert.ok(!gpx('a<b', []).includes('a<b'))
})
test('localIso and leaveBy handle offsets and the previous day', () => {
  assert.equal(localIso('2027-10-24', '02:15', 25200), '2027-10-24T02:15:00+07:00'); assert.equal(localIso('2027-10-24', '02:15', -18000), '2027-10-24T02:15:00-05:00'); assert.equal(localIso('x', '00:00', 19800), 'xT00:00:00+05:30')
  assert.deepEqual(leaveBy('02:15', 35, 10), { hhmm: '01:30', dayOffset: 0 }); assert.deepEqual(leaveBy('00:20', 35, 10), { hhmm: '23:35', dayOffset: -1 })
})
test('bearing and courseHeading', () => {
  assert.equal(bearing([0, 0], [1, 0]), 0); assert.equal(bearing([0, 0], [0, 1]), 90)
  const track = Array.from({ length: 20 }, (_, i) => [0, i * 0.001]); assert.equal(courseHeading(track, [0, 0.005]), 90); assert.equal(courseHeading(track, [0, 0.019]), 90)
})
