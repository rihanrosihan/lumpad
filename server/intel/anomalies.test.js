import test from 'node:test'
import assert from 'node:assert/strict'
import { detectAnomalies } from './anomalies.js'

const r = (km, pace, runPace, hr, gain, walk, stop, runShare) => ({ km, pace, runPace, hr, gain, walk, stop, runShare, sec: pace })
// the 22 Nov run: 8 km of running, a 25-minute stop at km 4, then walking with a partner from km 9
const NOV22 = [r(1, 477, 470, 157, 10, 0, 7, 0.985), r(2, 478, 477, 157, 0, 0, 0, 1), r(3, 554, 488, 149, 2, 247, 0, 0.553), r(4, 2018, 420, 143, 8, 205, 1535, 0.137), r(5, 476, 474, 157, 5, 8, 0, 0.983), r(6, 527, 463, 154, 3, 30, 53, 0.842), r(7, 516, 471, 155, 4, 18, 44, 0.88), r(8, 469, 443, 161, 6, 82, 0, 0.825), r(9, 668, 561, 138, 5, 505, 0, 0.243), r(10, 666, null, 121, 5, 665, 0, 0), r(11, 591, 550, 139, 1, 224, 0, 0.62), r(12, 713, null, 124, 0, 157, 0, 0)]
test('walks and pauses are found and neighbouring kilometres merge into one range', () => {
  const a = detectAnomalies(NOV22, { distance_m: 11220 }).anomalies
  assert.deepEqual(a.map((x) => [x.kind, x.km_from, x.km_to]), [['pause', 3, 4], ['walk', 6, 8], ['walk', 9, 12]]); assert.ok(a.find((x) => x.km_from === 3 && /stopped 25:35/.test(x.detail)))
  assert.ok(a.every((x) => x.needs_context))
})
test('an even pace with a gradual heart-rate rise produces nothing to ask about', () => {
  const even = Array.from({ length: 10 }, (_, i) => r(i + 1, 360 + (i % 2) * 4, 360 + (i % 2) * 4, 150 + i * 2, 3, 0, 0, 1))
  assert.deepEqual(detectAnomalies(even, { distance_m: 10000 }).anomalies, [])
})
test('a heart-rate spike is explained by a climb or a faster pace, and only an unexplained one needs context', () => {
  const base = (i) => r(i, 360, 360, 150, 2, 0, 0, 1), rows = [1, 2, 3, 4, 5, 6, 7, 8].map(base)
  const climb = rows.map((x) => (x.km === 5 ? { ...x, hr: 162, gain: 25 } : x)), fast = rows.map((x) => (x.km === 5 ? { ...x, hr: 162, pace: 340, runPace: 340 } : x)), mystery = rows.map((x) => (x.km === 5 ? { ...x, hr: 162 } : x))
  const s = (rr) => detectAnomalies(rr, { distance_m: 8000 }).anomalies.find((x) => x.kind === 'hr_spike')
  assert.equal(s(climb).explained_by, 'climb'); assert.equal(s(climb).needs_context, false); assert.equal(s(fast).explained_by, 'faster pace'); assert.equal(s(mystery).needs_context, true)
})
test('slow and fast kilometres are flagged against the usual running pace; a slow first kilometre and a partial last one are not', () => {
  const rows = Array.from({ length: 9 }, (_, i) => r(i + 1, 360, 360, 150, 2, 0, 0, 1)); rows[0] = { ...rows[0], pace: 395, runPace: 395 }; rows[3] = { ...rows[3], pace: 420, runPace: 420 }; rows[6] = { ...rows[6], pace: 320, runPace: 320 }; rows[8] = { ...rows[8], pace: 500, runPace: 500 }
  const a = detectAnomalies(rows, { distance_m: 8300 }).anomalies
  assert.deepEqual(a.map((x) => [x.kind, x.km_from]), [['slow', 4], ['fast', 7]])
})
test('no rows, no anomalies', () => assert.deepEqual(detectAnomalies([], {}).anomalies, []))

test('alternating walk and stop kilometres merge into sections of at most 5 km; early heart-rate jumps are warm-up', () => {
  const rows = Array.from({ length: 14 }, (_, i) => (i < 3 ? r(i + 1, 450, 450, 140 + i * 2, 2, 0, 0, 1) : i % 2 ? r(i + 1, 700, 520, 140, 2, 300, 0, 0.5) : r(i + 1, 700, 450, 140, 2, 0, 200, 0.6)))
  const a = detectAnomalies(rows, { distance_m: 14000 }).anomalies
  assert.ok(a.length <= 3, 'few questions: ' + a.length); assert.ok(a.every((x) => x.km_to - x.km_from < 5)); assert.ok(!a.some((x) => x.kind === 'hr_spike' && x.km_from <= 2))
})

test('a small stop is not folded into a long walk', () => {
  const rows = Array.from({ length: 8 }, (_, i) => r(i + 1, 360, 360, 150, 2, 0, 0, 1)); rows[3] = r(4, 400, 360, 150, 2, 0, 50, 0.9); rows[4] = r(5, 700, 500, 140, 2, 400, 0, 0.3)
  assert.deepEqual(detectAnomalies(rows, { distance_m: 8000 }).anomalies.map((x) => [x.km_from, x.km_to]), [[4, 4], [5, 5]])
})
