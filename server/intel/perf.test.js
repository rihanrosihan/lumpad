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

test('long-term table merges both watches by quarter; device scores stay apart', async () => {
  const { idb } = await import('./db.js')
  try { idb.prepare('SELECT 1 FROM fit_session_hist LIMIT 1').get() } catch { idb.exec('CREATE TABLE fit_session_hist (label_id TEXT, date TEXT, start_ms INTEGER, sport TEXT, distance_m REAL, elapsed_s REAL, run_share REAL, ef REAL, drift_pahr REAL, hr800 REAL, pace_hr150 REAL, onset_km REAL, gct_fade REAL, stride_fade REAL, run_pace REAL, km TEXT, dup_of TEXT)') }
  const km = JSON.stringify([1, 2, 3, 4, 5, 6].map((k) => ({ km: k, sec: 360 })))
  const ins = (t, row) => idb.prepare(`INSERT INTO ${t} (${Object.keys(row).join(',')}) VALUES (${Object.keys(row).map(() => '?').join(',')})`).run(...Object.values(row))
  ins('fit_session_hist', { label_id: 'g1', date: '2025-02-01', start_ms: 1000, sport: 'running', distance_m: 6100, elapsed_s: 2200, run_share: 1, ef: 0.8, drift_pahr: 3, km, dup_of: null })
  ins('fit_session_hist', { label_id: 'g2', date: '2025-02-08', start_ms: 9e9, sport: 'running', distance_m: 6100, elapsed_s: 2200, run_share: 1, ef: 0.82, drift_pahr: 2, km, dup_of: 'x' })
  const r = P.allRuns(); assert.equal(r.filter((x) => x.label_id === 'g1').length, 1); assert.equal(r.filter((x) => x.label_id === 'g2').length, 0, 'a duplicate of a live run is not counted twice')
  const lt = P.longTerm(r); assert.equal(lt[0].quarter, '2025-Q1'); assert.equal(lt[0].era, 'garmin'); assert.equal(lt[0].runs, 1)
  assert.deepEqual(P.devices([{ metric: 'garmin_vo2max', date: '2025-01-01', value: 44 }, { metric: 'garmin_vo2max', date: '2025-06-01', value: 46 }, { metric: 'garmin_pred_5k', date: '2025-06-01', value: 1700 }]).garmin.vo2max, { first: 44, last: 46, peak: { value: 46, date: '2025-06-01' } })
  assert.equal(P.devices([]).garmin, null)
})
