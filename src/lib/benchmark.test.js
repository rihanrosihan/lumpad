import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { makeLog } from './racelog.js'
import { benchmark, OFFICIAL_2026, GOAL_OFFICIAL, WATCH_PLAN, PLAN_MID } from './benchmark.js'
import { RACE_BY_DATE } from './season.js'

const L = makeLog(JSON.parse(fs.readFileSync(new URL('../data/races/jakim2026.json', import.meta.url), 'utf8')))

test('2026 official 6:53:03 → sub-5:00 official, planned as 4:50–4:52 on the watch: about 2 hours to cut', () => {
  assert.equal(OFFICIAL_2026, 24783); assert.equal(GOAL_OFFICIAL, 17999); assert.deepEqual(WATCH_PLAN, [17400, 17520]); assert.equal(PLAN_MID, 17460)
  const B = benchmark(L); assert.equal(B.cut, 24783 - 17460); assert.ok(B.cut > 2 * 3600 - 100 && B.cut < 2 * 3600 + 200); assert.equal(B.cutGoal, 24783 - 17999); assert.equal(B.buffer, 17999 - 17460)
  assert.ok(Math.abs(B.pace27 - 17460 / 42.195) < 1e-9); assert.ok(B.pace26 > 585 && B.pace26 < 590) // ≈ 9:47/km official
  assert.ok(B.vdot27 > B.vdot26 + 8) // the fitness gap
})
test('where the time comes from: 5 km blocks and kilometre classes add up', () => {
  const B = benchmark(L), sum = B.five.reduce((a, x) => a + x.saved, 0); assert.ok(Math.abs(sum - (L.total - 17460)) < 1); assert.equal(B.five.length, 9)
  assert.ok(B.five.at(-1).saved > B.five[0].saved, 'the last block saves more than the first')
  const tot = B.cls.reduce((a, c) => a + c.saved, 0); assert.ok(Math.abs(tot - (L.total - 17460)) < 40, 'classes: ' + tot); assert.ok(B.cls[2].saved > 1800, 'walking and stops are the biggest block'); assert.ok(Math.abs(B.cls.reduce((a, c) => a + c.km, 0) - 42.195) < 0.01)
  assert.ok(B.marks.every((m) => m.diff > 0))
})
test('Jakim 2027 race meta follows the benchmark', () => {
  const j = RACE_BY_DATE['2027-06-13']; assert.deepEqual(j.watchPlan, WATCH_PLAN); assert.deepEqual(j.pace.map((p) => Math.round(p * 42.195)), [17384, 17511]) // 6:52–6:55/km ≈ 4:50–4:52
  assert.match(j.note, /2026: 6:53:03/)
})
