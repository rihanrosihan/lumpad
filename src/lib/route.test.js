import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const R = JSON.parse(fs.readFileSync(new URL('../data/routes/jakim.json', import.meta.url), 'utf8'))
const hv = (a, b) => { const r = (x) => (x * Math.PI) / 180, dp = r(b[0] - a[0]), dl = r(b[1] - a[1]), h = Math.sin(dp / 2) ** 2 + Math.cos(r(a[0])) * Math.cos(r(b[0])) * Math.sin(dl / 2) ** 2; return 2 * 6371008.8 * Math.asin(Math.sqrt(h)) }

test('Jakim route: marathon distance, start at Monas, finish at GBK, 42 km marks', () => {
  assert.equal(R.officialKm, 42.195); assert.ok(R.trackKm > 42.5 && R.trackKm < 43.2) // GPX as drawn, before scaling
  assert.equal(R.line[0][2], 0); assert.ok(Math.abs(R.line.at(-1)[2] - 42.195) < 0.01); assert.equal(R.marks.length, 42)
  assert.ok(hv(R.start, [-6.1754, 106.8272]) < 1200, 'start near Monas'); assert.ok(hv(R.finish, [-6.2183, 106.8019]) < 1500, 'finish near Gelora Bung Karno')
  R.line.forEach((p, i) => i && assert.ok(p[2] >= R.line[i - 1][2]))
})
test('Jakim route: markers follow the track, turn points match the official map, segments tile 0–42.195', () => {
  const segDist = (p, a, b) => { const k = Math.cos((p[0] * Math.PI) / 180), X = (q) => [(q[1] - p[1]) * 111320 * k, (q[0] - p[0]) * 110540], [ax, ay] = X(a), [bx, by] = X(b), dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy, t = l ? Math.max(0, Math.min(1, (-ax * dx - ay * dy) / l)) : 0; return Math.hypot(ax + t * dx, ay + t * dy) }
  for (const m of R.marks) { const near = Math.min(...R.line.slice(1).map((q, i) => segDist(m.ll, R.line[i], q))); assert.ok(near < 15, 'km ' + m.km + ' off the track by ' + Math.round(near) + ' m') }
  const south = R.turns.find((t) => /Mampang/.test(t.name)); assert.ok(south.km > 12 && south.km < 13); assert.ok(south.ll[0] < -6.25)
  assert.equal(R.segments[0].from, 0); assert.equal(R.segments.at(-1).to, 42.195); R.segments.forEach((s, i) => i && assert.equal(s.from, R.segments[i - 1].to))
  assert.equal(R.elevation, null) // the official GPX carries no elevation: never invent a profile
  assert.ok(fs.existsSync(new URL('../../public/' + R.gpx, import.meta.url)))
})
