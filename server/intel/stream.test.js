import test from 'node:test'
import assert from 'node:assert/strict'
process.env.DATA_DIR = (await import('node:fs')).mkdtempSync((await import('node:path')).join((await import('node:os')).tmpdir(), 'lumpad-test-data-'))
const { buildStream, fitPath } = await import('./stream.js')
function fit(secs, { enhanced = false, noGps = false } = {}) {
  const t0 = Date.UTC(2026, 0, 1), rec = []
  for (let i = 0; i < secs; i++) {
    const r = { timestamp: new Date(t0 + i * 1000), distance: i * 3, heart_rate: 140 + (i >> 8), cadence: 85 }
    r[enhanced ? 'enhanced_speed' : 'speed'] = 3; r[enhanced ? 'enhanced_altitude' : 'altitude'] = 100 + i * 0.01
    if (!noGps) { r.position_lat = -7.6 + i * 1e-5; r.position_long = 110.2 + i * 1e-5 }
    rec.push(r)
  }
  return { records: rec }
}
test('stream: downsampled series and a real route, in step with the 1 Hz series', () => {
  const s = buildStream(fit(3000))
  assert.ok(s.t.length <= 421 && s.t.length > 300); assert.equal(s.hr.length, s.t.length); assert.equal(s.pace.length, s.t.length)
  assert.ok(Math.abs(s.pace[10] - 333.3) < 1); assert.ok(Math.abs(s.km.at(-1) - 9) < 0.1); assert.ok(s.has_alt)
  assert.ok(s.route.length >= 100 && s.route.length <= 701); assert.deepEqual(s.route[0], [-7.6, 110.2]); assert.ok(s.route.at(-1)[0] > -7.6)
})
test('stream: Garmin-style enhanced fields give the same speed and altitude; a run without GPS has an empty route', () => {
  const a = buildStream(fit(600)), b = buildStream(fit(600, { enhanced: true, noGps: true }))
  assert.deepEqual(a.pace, b.pace); assert.deepEqual(a.alt, b.alt); assert.deepEqual(b.route, [])
})
test('stream: a stored path cannot leave the data directory', () => {
  assert.throws(() => fitPath('../../etc/passwd'), (e) => e.status === 400)
  assert.ok(fitPath('fit/2026/1.fit').endsWith('fit/2026/1.fit'))
})
