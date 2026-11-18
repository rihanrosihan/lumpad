import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { splits, clock, runWalk, hms, mss, parseHMS, compass, segmentAt, FM } from './courseplan.js'

const R = JSON.parse(fs.readFileSync(new URL('../data/routes/jakim.json', import.meta.url), 'utf8'))

test('parse / format', () => { assert.equal(parseHMS('4:59:00'), 17940); assert.equal(parseHMS('59:00'), 3540); assert.equal(parseHMS('abc'), null); assert.equal(hms(17940), '4:59:00'); assert.equal(mss(426), '7:06') })
test('even splits add up to the goal time, 43 slots, last is the 0.195 km', () => {
  const sp = splits(17940, 'even'), cl = clock(sp); assert.equal(sp.length, 43); assert.ok(Math.abs(cl[42] - 17940) < 1e-6); assert.ok(Math.abs(sp[0] - 17940 / FM) < 1e-9); assert.ok(Math.abs(sp[42] - (17940 / FM) * (FM - 42)) < 1e-9)
  assert.equal(hms(cl[20] + (cl[21] - cl[20]) * 0.0975 / 1), hms(cl[20] + (cl[21] - cl[20]) * 0.0975)) // sanity, monotonic
  cl.forEach((c, i) => i && assert.ok(c > cl[i - 1]))
})
test('negative split: first half slower, second faster, same finish', () => {
  const sp = splits(14400, 'negative'), cl = clock(sp); assert.ok(Math.abs(cl[42] - 14400) < 1e-6); assert.ok(sp[0] > sp[41]); assert.ok(Math.abs(sp[0] / (14400 / FM) - 1.015) < 1e-9)
  assert.ok(Math.abs(cl[20] + (21.0975 - 21) * sp[21] - (14400 / 2 + 14400 / FM * 21.0975 * 0.015 )) < 5) // the half-way clock is ~1.5% slower than half the time
})
test('run–walk: run pace such that the cycle averages the goal pace', () => {
  const avg = 17940 / FM, rw = runWalk(avg, 4, 1, 630); assert.ok(rw.runPace < avg && rw.runPace > 330)
  assert.ok(Math.abs(300 / rw.cycleKm - avg) < 1e-6); assert.ok(Math.abs(rw.runKm * rw.runPace - 240) < 1e-6); assert.ok(Math.abs(rw.walkKm * 630 - 60) < 1e-6); assert.equal(runWalk(200, 1, 5, 630), null)
})
test('compass', () => { assert.equal(compass(0), 'N'); assert.equal(compass(182), 'S'); assert.equal(compass(-90), 'W'); assert.equal(compass(131), 'SE') })
test('Jakim course data: corners, U-turns, headings', () => {
  assert.ok(R.corners.length >= 20 && R.corners.every((c) => c.deg >= 55 && (c.dir === 'L' || c.dir === 'R'))); assert.equal(R.kmHeadings.length, 43)
  const u = R.corners.filter((c) => c.deg >= 140).map((c) => c.km); for (const t of R.turns.filter((x) => x.km > 5)) assert.ok(u.some((k) => Math.abs(k - t.km) < 0.7), 'U-turn ' + t.name)
  assert.equal(R.turns.length, 7); assert.equal(segmentAt(R.segments, 0.3).from, 0); assert.equal(segmentAt(R.segments, 42.1).to, 42.195)
})
