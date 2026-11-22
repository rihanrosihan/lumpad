import test from 'node:test'
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lumpad-archive-'))
Object.assign(process.env, { LUMPAD_DB: ':memory:', COROS_ARCHIVE_DB: ':memory:', DATA_DIR: tmp, COROS_FIT_DIR: path.join(tmp, 'fit'), COROS_ARCHIVE_FROM: '2025-01-01', LUMPAD_TOKEN_KEY: 'ab'.repeat(32) })
const A = await import('./archive.js'), { projectAll } = await import('./project.js'), { db } = await import('../store.js'), { decodeText } = await import('./mcp.js'), jobs = await import('../jobs.js')

const FIT = Buffer.concat([Buffer.from([14, 0x20, 0, 0, 0, 0, 0, 0]), Buffer.from('.FIT'), Buffer.alloc(20)])
const LAPS = JSON.stringify({ lapGroups: [{ type: 2, laps: [{ distance: 100000, time: 420, avgPace: 420, avgHr: 150, avgCadence: 170 }] }, { type: -1, laps: [{ avgCadence: 170 }] }] })
const rec = (n, name, d, id, st, ts) => `${n}. ${name} — ${d}\n   Time Window: startTimestamp=${ts} | endTimestamp=${ts + 1800}\n   Duration: 30:00 | Distance: 5.00 km\n   Average Pace: 6:00 /km | Avg HR: 150 bpm | Calories: 300 kcal\n   LabelId: ${id} | SportType: ${st}\n`
function fake({ quotaOn } = {}) {
  const log = []
  const call = async (tool, a = {}) => {
    log.push([tool, a])
    if (tool === quotaOn) throw Object.assign(new Error(tool + ': daily limit reached'), { quota: true })
    switch (tool) {
      case 'queryStressLevel': return 'Stress Level — Last 41 days\n\n2025-02-01:\nAverage Stress: 30\nRelaxed: 1h (50%)\n\n2025-01-20:\nAverage Stress: 25\nRelaxed: 2h (60%)'
      case 'queryDailyHealthData': return 'Daily Health\n\n--- 20250105 ---\nSteps: 0 | Calories: 0 kcal | Exercise: 0 min\n\n--- 20250121 ---\nSteps: 5000 | Calories: 1 kcal | Exercise: 0 min\nStress: Avg 25\nSleep Summary:\n  Total: 7h 0min | Deep: 1h 0min | Light: 4h 0min | REM: 1h 30min | Awake: 30 min\n  Sleep HR: Avg 55 bpm | Min 45 bpm | Max 80 bpm\n'
      case 'queryRestingHeartRate': return '2025-01-21: 52 bpm'
      case 'queryTrainingLoadAssessment': return '2025-01-21\nComment: Maintaining\nShort-Term Load: 40\nLong-Term Load: 60\nLoad Ratio: 0.67'
      case 'querySportRecords': return a.startDate.startsWith('202502') ? 'Sport Records (1 records)\n\n' + rec(1, 'Outdoor Run', '2025-02-05', '900', 100, 1738700000) : a.startDate.startsWith('202501') ? 'Sport Records (1 records)\n\n' + rec(1, 'Strength', '2025-01-15', '800', 402, 1736900000) : 'Sport Records (0 records)'
      case 'getActivityDetail': return 'Training Load: 120\nAerobic TE: 3.1\nTraining Focus: Base'
      case 'queryActivityLapData': return LAPS
      case 'queryCustomActivityLapData': return '{"laps":[]}'
      case 'queryActivityFitFileDownloadUrls': return `Activity FIT file download URL(s):\n1. ${a.labelId}.fit\n   https://s3.coros.com/fit/1/${a.labelId}.fit`
      case 'querySleepHrv': return a.startDate === '20250120' ? 'HRV Assessment\n2025-01-21:\n  HRV Avg: 80 ms — Normal\n  Normal Range: 50 - 100 ms\n  Baseline: 78 ms\n' : 'No data found in the last 7 days.'
      case 'queryWorkoutLibrary': return 'Workout Library\nTotal workouts: 1\n\n1. Easy [Running] [custom]\n   Workout ID: 55\n   Created: 2025-01-01 00:00:00 | Updated: 2025-02-01 10:00:00\n'
      case 'queryRecoveryStatus': return 'Recovery: 90%\nLevel: Fresh\nEstimated Full Recovery: 0h'
      case 'queryFitnessAssessmentOverview': return 'VO2max: 47\nRunning Level: 66'
      default: return 'No data found in the last 7 days.'
    }
  }
  return { call, log }
}
const fetchFn = async () => ({ ok: true, arrayBuffer: async () => FIT })

test('decodeText unwraps COROS JSON-string responses, leaves other text alone', () => {
  assert.equal(decodeText('"Sport Records\\n1. Run"'), 'Sport Records\n1. Run')
  assert.equal(decodeText('{"lapGroups":[]}'), '{"lapGroups":[]}')
  assert.equal(decodeText('Recovery: 90%'), 'Recovery: 90%')
})

test('first plan: snapshots, "last N days" tools and months — daily series wait for the health start date', () => {
  A.plan('2025-02-10')
  const keys = A.adb.prepare('SELECT key FROM tasks').all().map((r) => r.key)
  assert.ok(keys.includes('sport:2025-02') && keys.includes('sport:2025-01') && keys.includes('queryStressLevel:all') && keys.includes('queryDevices:2025-02-10'))
  assert.ok(!keys.some((k) => k.startsWith('querySleepHrv:') || k.startsWith('hc:')))
  assert.equal(JSON.parse(A.adb.prepare("SELECT args FROM tasks WHERE key='queryDailyHealthData:all'").get().args).days, 41)
})

test('session pulls everything newest first, discovers activities, stores FIT files, rebuilds app tables', async () => {
  const f = fake(), r = await A.runArchive({ call: f.call, today: '2025-02-10', maxCalls: 1000, fetchFn })
  assert.equal(r.failed, 0); assert.equal(r.stopped, 'budget used or queue empty')
  assert.equal(A.healthFrom(), '2025-01-20') // from stress (zero-step days ignored)
  const sport = f.log.filter(([t]) => t === 'querySportRecords').map(([, a]) => a.startDate); assert.deepEqual(sport, ['20250201', '20250101'])
  const days = f.log.map(([t, a]) => A.adb.prepare('SELECT day FROM tasks WHERE tool=? AND args=?').get(t, JSON.stringify(a))?.day).filter(Boolean)
  assert.deepEqual(days, [...days].sort().reverse(), 'calls run newest day first')
  for (const t of ['getActivityDetail', 'queryActivityLapData', 'queryCustomActivityLapData', 'queryActivityFitFileDownloadUrls', 'queryHealthCheckTimeSeries', 'queryStressTimeSeries', 'querySleepOverview', 'queryAvgHeartRate', 'queryWorkoutDetails', 'queryUserInfo'])
    assert.ok(f.log.some(([x]) => x === t), t + ' called')
  assert.equal(f.log.filter(([t]) => t === 'queryHealthCheckTimeSeries').length, 22) // one per day 01-20..02-10, none before the health start
  assert.equal(A.adb.prepare("SELECT COUNT(*) n FROM tasks WHERE status='pending'").get().n, 0)
  const fit = A.adb.prepare('SELECT * FROM fit_files ORDER BY label_id').all(); assert.equal(fit.length, 2); assert.ok(fs.existsSync(path.join(tmp, 'fit', '2025', '900.fit')))
  const s = A.status('2025-02-10'); assert.equal(s.complete, true); assert.equal(s.activities.n, 2); assert.equal(s.etaDays, 0)

  const p = projectAll(); assert.equal(p.rejected, 0)
  const a = db.prepare("SELECT training_load, cadence FROM activities WHERE id='coros:900'").get(); assert.deepEqual([a.training_load, a.cadence], [120, 170])
  assert.equal(db.prepare("SELECT COUNT(*) n FROM laps WHERE activity_id='coros:900'").get().n, 1)
  const h = db.prepare("SELECT hrv_avg, resting_hr, sleep_total_min, load_ratio FROM health_daily WHERE date='2025-01-21'").get(); assert.deepEqual([h.hrv_avg, h.resting_hr, h.sleep_total_min, h.load_ratio], [80, 52, 420, 0.67])
  assert.equal(db.prepare("SELECT COUNT(*) n FROM health_daily WHERE date='2025-01-05'").get().n, 0) // all-zero day not stored
  assert.equal(db.prepare("SELECT recovery_pct FROM health_daily WHERE date='2025-02-10'").get().recovery_pct, 90)
})

test('next day: only recent things are re-pulled; history is not asked again', async () => {
  const f = fake(); await A.runArchive({ call: f.call, today: '2025-02-11', maxCalls: 1000, fetchFn })
  assert.ok(!f.log.some(([t, a]) => t === 'querySportRecords' && a.startDate === '20250101'))
  assert.ok(!f.log.some(([t]) => t === 'getActivityDetail' || t === 'queryActivityFitFileDownloadUrls'))
  assert.ok(f.log.some(([t]) => t === 'queryRecoveryStatus') && f.log.some(([t, a]) => t === 'queryHealthCheckTimeSeries' && a.startDate === '20250211'))
})

test('quota error: bucket stops for the day, cap is learned, the rest continues; cap grows back later', async () => {
  const f = fake({ quotaOn: 'queryHealthCheckTimeSeries' }); const r = await A.runArchive({ call: f.call, today: '2025-02-12', maxCalls: 1000, fetchFn })
  assert.deepEqual(r.quota, ['queryHealthCheckTimeSeries']); assert.equal(f.log.filter(([t]) => t === 'queryHealthCheckTimeSeries').length, 1)
  const b = A.status('2025-02-12').buckets.find((x) => x.bucket === 'queryHealthCheckTimeSeries'); assert.equal(b.blockedToday, true); assert.equal(b.learned, 1); assert.ok(b.pending >= 1)
  assert.ok(f.log.some(([t]) => t === 'queryRecoveryStatus'))
  A.plan('2025-02-13') // yesterday hit the limit → no growth
  assert.equal(A.capOf('queryHealthCheckTimeSeries'), 1)
})

test('anomaly notice / unreadable laps are not stored as data: retried in a later session, failed after 3', async () => {
  A.adb.prepare("INSERT INTO activities (label_id, sport_type, date, start_ts, end_ts, rec, seen_at) VALUES ('901', 100, '2025-02-13', 1739400000, 1739401800, ?, 'x')").run(JSON.stringify({ source: 'coros', source_id: '901', date: '2025-02-13', sport: 'Run' }))
  const bad = fake(); let lapCalls = 0
  const call = async (t, a) => (t === 'queryActivityLapData' ? (lapCalls++, 'Tool call anomalies detected. High risk of session context pollution') : bad.call(t, a))
  for (let i = 1; i <= 3; i++) {
    await A.runArchive({ call, today: '2025-02-13', maxCalls: 1000, fetchFn })
    assert.equal(lapCalls, i, 'one try per session, not back-to-back')
    assert.equal(A.adb.prepare("SELECT status FROM tasks WHERE key='laps:901'").get().status, i < 3 ? 'pending' : 'failed')
  }
  assert.equal(A.responseText('laps:901'), null)
})

test('daily budget: total cap stops the session; ETA reflects the cap', async () => {
  process.env.COROS_BUDGET = '{"total":3}'
  try { const r = await A.runArchive({ call: fake().call, today: '2025-02-14', maxCalls: 1000, fetchFn }); assert.equal(r.calls, 3); assert.ok(A.status('2025-02-14').etaDays >= 1) }
  finally { delete process.env.COROS_BUDGET }
})

test('archive scheduler: hourly sessions, not 07:00–09:00 WIB, only with work and a connection', async () => {
  const { seal } = await import('./oauth.js')
  const start = () => 'started', yes = () => true
  assert.equal(jobs.tickArchive(new Date('2025-02-14T20:00:00Z'), start, yes), null) // not connected
  db.prepare("INSERT INTO oauth_tokens (provider, blob, expires_at, scope, updated_at) VALUES ('coros', ?, 9999999999, 's', 'x')").run(seal({ access_token: 'a' }))
  assert.equal(jobs.tickArchive(new Date('2025-02-14T20:00:00Z'), start, yes), 'started') // 03:00 WIB
  assert.equal(jobs.tickArchive(new Date('2025-02-15T00:30:00Z'), start, yes), null) // 07:30 WIB
  assert.equal(jobs.tickArchive(new Date('2025-02-14T20:00:00Z'), start, () => false), null) // nothing to do
  db.prepare("INSERT INTO sync_jobs (kind, status, started_at, local_date) VALUES ('archive','done',?,?)").run('2025-02-14T19:30:00.000Z', '2025-02-15')
  assert.equal(jobs.tickArchive(new Date('2025-02-14T20:00:00Z'), start, yes), null) // last session 30 min ago
})

test('a run that finished after the morning pull is picked up the same day (current month re-pulled every 2 h, not once a day)', async () => {
  const f = fake(); await A.runArchive({ call: f.call, today: '2025-02-11', maxCalls: 1000, fetchFn })
  const st = () => A.adb.prepare("SELECT status FROM tasks WHERE key='sport:2025-02'").get().status
  A.plan('2025-02-11'); assert.notEqual(st(), 'pending', 'just pulled: not asked again')
  A.adb.prepare("UPDATE tasks SET updated_at=? WHERE key='sport:2025-02'").run(new Date(Date.now() - 3 * 3600e3).toISOString())
  A.plan('2025-02-11'); assert.equal(st(), 'pending', 'pulled 3 h ago: asked again today')
})
