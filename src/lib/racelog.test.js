import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { makeLog } from './racelog.js'

const R = JSON.parse(fs.readFileSync(new URL('../data/races/jakim2026.json', import.meta.url), 'utf8'))

test('Jakim 2026 race log: totals and scaling to the official distance', () => {
  const L = makeLog(R); assert.equal(R.laps.length, 44); assert.ok(Math.abs(L.total - 24857.27) < 0.5); assert.ok(Math.abs(L.cumKm.at(-1) - 43.2657) < 1e-6)
  assert.ok(Math.abs(L.f - 42.195 / 43.2657) < 1e-9); assert.ok(Math.abs(L.clockAt(42.195) - L.total) < 1e-6); assert.equal(L.clockAt(0), 0)
  assert.ok(Math.abs(L.clockAt(5 * L.f) - L.cumT[4]) < 1e-6) // 5 watch km = 5·f official km
  assert.equal(L.stopped, 24857 - 22901)
})
test('Jakim 2026: fast start, fade, run–walk later', () => {
  const L = makeLog(R); assert.ok(L.avgPace(0, 10) < 500 && L.avgPace(0, 10) > 440) // ~8:00 per official km on the first 10 km
  assert.ok(L.avgPace(30, 42.195) > L.avgPace(0, 10) * 1.3, 'the last 12 km were much slower'); assert.ok(L.avgHr(0, 10) > 160 && L.avgHr(30, 42.2) < 155)
  assert.ok(L.slow(540) >= 8); assert.ok(L.clockAt(21.0975) > 10800 && L.clockAt(21.0975) < 11300) // half way in about 3:04
  L.per.forEach((p, i) => i && assert.ok(p.km > L.per[i - 1].km))
})
