// H9: monthly HR@8:00 baseline from steady runs, and the readiness cap it feeds
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
process.env.INTEL_DB = ':memory:'; process.env.MEMORY_DB = ':memory:'; process.env.DATA_DIR = fs.mkdtempSync((await import('node:path')).join((await import('node:os')).tmpdir(), 'lumpad-bl-'))
const { idb } = await import('./db.js'), B = await import('./baseline.js'), { computeReadiness } = await import('../../src/lib/readiness.js')
const ins = idb.prepare("INSERT INTO fit_session (label_id, date, parser_version, distance_m, run_share, hr800, metrics, km, processed_at) VALUES (?,?,1,?,?,?,'{}','[]','x')")
test('window ends 28 days before the month and spans 180 days', () => assert.deepEqual(B.hr800Window('2026-12-01'), { from: '2026-05-07', to: '2026-11-03' }))
test('too few steady runs: no row; races and run-walk do not count', () => {
  for (let i = 0; i < 9; i++) ins.run('s' + i, `2026-08-${String(i + 1).padStart(2, '0')}`, 8000, 0.95, 140 + i)
  ins.run('race', '2026-08-20', 36900, 0.48, 169); ins.run('rw', '2026-08-21', 6000, 0.6, 165)
  assert.equal(B.baselineJob('2026-12-05').hr800, 'too few runs')
})
test('ten steady runs: mean and sample SD written once; the previous row is closed', () => {
  ins.run('s9', '2026-08-15', 8000, 0.95, 149)
  const r = B.baselineJob('2026-12-05'); assert.equal(r.hr800, 'written'); assert.equal(r.n, 10); assert.equal(r.mean, 144.5); assert.equal(r.sd, 3)
  assert.equal(B.baselineJob('2026-12-20').hr800, 'exists')
  for (let i = 0; i < 10; i++) ins.run('t' + i, `2026-09-${String(i + 1).padStart(2, '0')}`, 8000, 0.95, 150)
  B.baselineJob('2027-01-02')
  assert.equal(idb.prepare("SELECT valid_to FROM athlete_baseline WHERE name='hr800' AND valid_from='2026-12-01'").get().valid_to, '2027-01-01')
})
test('readiness: aerobic marker >= 2 SD over >= 3 steady runs caps at 64; fewer runs or < 2 SD do not', () => {
  const base = { f: {}, hrv: {}, rhr: {}, sleep: {}, pmcPoint: { tsb: 0, ctl: 50, atl: 50, acwr: 1, tsbPct: 0 } }
  const capped = computeReadiness({ ...base, aerobic: { z: 2.4, n: 3 } })
  assert.ok(capped.caps.some((c) => /HR at 8:00\/km \+2.4 SD/.test(c.why)))
  assert.ok(!computeReadiness({ ...base, aerobic: { z: 3.6, n: 2 } }).caps.length)
  assert.ok(!computeReadiness({ ...base, aerobic: { z: 1.9, n: 6 } }).caps.length)
  assert.ok(!computeReadiness({ ...base, aerobic: null }).caps.length)
})
