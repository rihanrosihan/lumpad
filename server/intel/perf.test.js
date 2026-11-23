import test from 'node:test'
import assert from 'node:assert'
process.env.INTEL_DB = ':memory:'; process.env.MEMORY_DB = ':memory:'; process.env.DATA_DIR = (await import('node:fs')).mkdtempSync((await import('node:path')).join((await import('node:os')).tmpdir(), 'perf-'))
const P = await import('./perf.js')

test('trend: newest against the ones before, direction depends on which way is better', () => {
  assert.equal(P.trend([0.70, 0.71, 0.72, 0.80, 0.81, 0.82], 'up', 3).direction, 'improving')
  assert.equal(P.trend([0.80, 0.81, 0.82, 0.70, 0.71, 0.72], 'up', 3).direction, 'worsening')
  assert.equal(P.trend([5, 5, 5, 5], 'down', 2).direction, 'flat')
  assert.equal(P.trend([10, 11, 12, 8, 7, 9], 'down', 3).direction, 'improving', 'lower drift is better')
  assert.equal(P.trend([1], 'up').direction, 'flat')
})
test('best window: fastest consecutive km, a gap in the series breaks the window', () => {
  const km = [1, 2, 3, 4, 6, 7, 8].map((k, i) => ({ km: k, sec: [300, 290, 280, 400, 270, 270, 270][i] }))
  assert.equal(P.bestWindow(km, 3), 810, '6-7-8 is the fastest three in a row'); assert.equal(P.bestWindow(km, 4), 1270, 'only 1-4 is contiguous'); assert.equal(P.bestWindow(km, 5), null)
})
test('summary builds from an empty database without failing', () => { const s = P.perfSummary(); assert.equal(s.vdot.baseline, 31.7); assert.equal(s.coros, null); assert.deepEqual(s.speed.pbs, {}) })

test('a partial last kilometre can never become a record', () => {
  const km = [{ km: 1, sec: 300 }, { km: 2, sec: 300 }, { km: 3, sec: 20 }]
  assert.equal(P.bestWindow(km, 1, 2050), 300); assert.equal(P.bestWindow(km, 3, 2050), null)
  assert.equal(P.bestWindow([{ km: 1, sec: 40 }], 1, 5000), null, 'an impossible km time is dropped')
})
