import test from 'node:test'
import assert from 'node:assert'
process.env.LUMPAD_DB = ':memory:'; process.env.DATA_DIR = '/tmp/lumpad-test-data'; process.env.LUMPAD_TOKEN_KEY = 'cd'.repeat(32)
const { pullRange, addDays } = await import('./pull.js'), { db } = await import('../store.js'), jobs = await import('../jobs.js')

const dh = (d, hr) => `--- ${d.replace(/-/g, '')} ---\nSteps: 100 | Calories: 1 kcal | Exercise: 0 min\nStress: Avg 30\nSleep Summary:\n  Total: 7h 0min | Deep: 1h 0min | Light: 4h 0min | REM: 1h 30min | Awake: 30 min\n  Sleep HR: Avg ${hr} bpm | Min 45 bpm | Max 80 bpm\n`
const LAPS = JSON.stringify({ lapGroups: [{ type: 2, laps: [{ distance: 100000, time: 450, avgPace: 450, avgHr: 150, avgCadence: 165, avgPower: 170, groundTime: 300 }] }, { type: -1, laps: [{ avgCadence: 165, avgPower: 170 }] }] })
function fake({ lapFails = 0, lapAlwaysBad = false } = {}) {
  const log = []; let lf = 0
  const call = async (tool, a) => {
    log.push([tool, a])
    if (tool === 'queryDailyHealthData') return 'hdr\n\n' + ['2027-01-04', '2027-01-05', '2027-01-06'].map((d, i) => dh(d, 60 + i)).join('\n')
    if (tool === 'querySleepHrv') return `HRV Assessment\n2027-01-05:\n  HRV Avg: 80 ms — Normal\n  Normal Range: 50 - 100 ms\n  Baseline: 78 ms\n\nSleep HRV Time Series\n2027-01-05:\n  hrv=1 ms`
    if (tool === 'queryRestingHeartRate') return '2027-01-05: 55 bpm\n2027-01-06: 57 bpm'
    if (tool === 'querySportRecords') return `1. Outdoor Run — 2027-01-05\n   Duration: 30:00 | Distance: 5.00 km\n   Average Pace: 6:00 /km | Avg HR: 150 bpm | Calories: 300 kcal\n   LabelId: 900 | SportType: 100\n\n2. Walk — 2027-01-06\n   Duration: 10:00 | Distance: 1.00 km\n   LabelId: 901 | SportType: 900\n`
    if (tool === 'queryTrainingLoadAssessment') return 'Training Load Assessment\n\n2027-01-06\nComment: Maintaining\nShort-Term Load: 40\nLong-Term Load: 60\nLoad Ratio: 0.67\n\n2027-01-05\nComment: Resuming\nShort-Term Load: 30\nLong-Term Load: 58\nLoad Ratio: 0.52'
    if (tool === 'querySleepOverview') return 'Sleep Overview\n\n2027-01-05\nSleep Score: 84\nAwake Count (>5 min): 0\n'
    if (tool === 'queryRecoveryStatus') return 'Recovery: 90%\nLevel: Fresh\nEstimated Full Recovery: 0h'
    if (tool === 'queryFitnessAssessmentOverview') return 'VO2max: 47\nRunning Level: 66\nThreshold Pace: 5:56 /km\n5 km Prediction: 28:40\n10 km Prediction: 1:00:33\nHalf Marathon Prediction: 2:17:13\nMarathon Prediction: 4:53:04'
    if (tool === 'getActivityDetail') return 'Training Load: 158\nAerobic TE: 3.6\nAnaerobic TE: 1.8\nTraining Focus: Tempo\nPerformance: Below Average'
    if (tool === 'queryActivityLapData') { if (lapAlwaysBad || lf++ < lapFails) return 'Tool call anomalies detected. High risk of session context pollution'; return LAPS }
    throw new Error('unexpected tool ' + tool)
  }
  return { call, log }
}
test('staged pull merges 3 health tools by date, windows HRV in 7s, saves activities + laps', async () => {
  const f = fake(), notes = [], stages = new Set()
  const r = await pullRange({ call: f.call, from: '2027-01-01', to: '2027-01-20', trigger: 'backfill', notes, progress: (p) => stages.add(p.stage) })
  assert.equal(f.log.filter(([t]) => t === 'querySleepHrv').length, 3) // 1–7, 8–14, 15–20
  assert.deepEqual([...stages], ['health', 'hrv', 'resting', 'load', 'sleep', 'snapshot', 'activities', 'laps', 'details', 'saving'])
  const h = db.prepare('SELECT * FROM health_daily WHERE date = ?').get('2027-01-05')
  assert.equal(h.sleep_hr_avg, 61); assert.equal(h.hrv_avg, 80); assert.equal(h.resting_hr, 55); assert.equal(h.sleep_total_min, 420)
  assert.equal(db.prepare('SELECT COUNT(*) n FROM laps').get().n, 1)
  assert.equal(h.load_short, 30); assert.equal(h.load_ratio, 0.52); assert.equal(h.sleep_score, 84)
  assert.equal(db.prepare('SELECT recovery_pct FROM health_daily WHERE date = ?').get('2027-01-20').recovery_pct, 90) // snapshot stored under the pull's end date
  assert.equal(db.prepare('SELECT vo2max, pred_m_s FROM fitness_daily').get().pred_m_s, 17584)
  const a = db.prepare("SELECT training_load, aerobic_te, training_focus FROM activities WHERE id = 'coros:900'").get(); assert.deepEqual([a.training_load, a.aerobic_te, a.training_focus], [158, 3.6, 'Tempo'])
  assert.equal(r.rejected, 0); assert.equal(db.prepare('SELECT trigger FROM sync_runs ORDER BY id DESC LIMIT 1').get().trigger, 'backfill')
})
test('re-running is idempotent (no duplicates) and skips laps already stored', async () => {
  const f = fake(); await pullRange({ call: f.call, from: '2027-01-01', to: '2027-01-20', trigger: 'daily' })
  assert.equal(db.prepare('SELECT COUNT(*) n FROM health_daily').get().n, 4) // 3 nights + the end-date snapshot row; second run adds nothing
  assert.equal(db.prepare("SELECT COUNT(*) n FROM activities").get().n, 2)
  assert.equal(f.log.filter(([t]) => t === 'queryActivityLapData').length, 0)
})
test('flaky lap tool: recovers on retry; gives up cleanly after 3 tries without failing the run', async () => {
  db.exec('DELETE FROM laps')
  let f = fake({ lapFails: 2 }); await pullRange({ call: f.call, from: '2027-01-01', to: '2027-01-20', trigger: 'daily' })
  assert.equal(db.prepare('SELECT COUNT(*) n FROM laps').get().n, 1); assert.equal(f.log.filter(([t]) => t === 'queryActivityLapData').length, 3)
  db.exec('DELETE FROM laps'); f = fake({ lapAlwaysBad: true }); const notes = []
  const r = await pullRange({ call: f.call, from: '2027-01-01', to: '2027-01-20', trigger: 'daily', notes })
  assert.equal(r.stats.lapsMissing, 1); assert.ok(notes.some((n) => /laps missing/.test(n)))
})
test('a failing tool is noted, other data still saved', async () => {
  const f = fake(), call = async (t, a) => (t === 'querySleepHrv' ? Promise.reject(new Error('boom')) : f.call(t, a)), notes = []
  await pullRange({ call, from: '2027-01-01', to: '2027-01-10', trigger: 'daily', notes })
  assert.ok(notes.some((n) => /HRV/.test(n))); assert.ok(db.prepare('SELECT COUNT(*) n FROM health_daily').get().n >= 3)
})
test('job runner: records progress/done, refuses concurrent jobs, records errors', async () => {
  let release; const gate = new Promise((r) => (release = r))
  const id = jobs.startJob('backfill', { from: '2027-01-01' }, { pull: async ({ progress }) => { progress({ stage: 'hrv', done: 1, total: 3 }); await gate; return { counts: { health: 1 } } } })
  assert.throws(() => jobs.startJob('daily', {}, { pull: async () => ({}) }), /already running/)
  assert.equal(jobs.recentJobs(1)[0].progress.stage, 'hrv'); release(); await jobs.whenIdle()
  assert.equal(jobs.recentJobs(1)[0].status, 'done')
  jobs.startJob('daily', {}, { pull: async () => { throw new Error('COROS down') } }); await jobs.whenIdle()
  assert.deepEqual([jobs.recentJobs(1)[0].status, jobs.recentJobs(1)[0].error], ['error', 'COROS down'])
})
test('scheduler: not before 07:50 WIB, once per day, max 3 attempts 30 min apart, only when connected', async () => {
  const { seal } = await import('./oauth.js')
  assert.equal(jobs.tick(new Date('2027-02-01T01:00:00Z'), () => 'x'), null) // not connected yet
  db.prepare("INSERT INTO oauth_tokens (provider, blob, expires_at, scope, updated_at) VALUES ('coros', ?, 9999999999, 's', 'x')").run(seal({ access_token: 'a' }))
  const started = []; const start = (k) => { started.push(k); db.prepare("INSERT INTO sync_jobs (kind,status,started_at,local_date) VALUES ('daily','error',?,?)").run(new Date(NOW).toISOString(), '2027-02-01'); return 1 }
  let NOW = new Date('2027-02-01T00:40:00Z') * 1 // 07:40 WIB
  assert.equal(jobs.tick(new Date(NOW), start), null)
  NOW = new Date('2027-02-01T00:52:00Z') * 1; jobs.tick(new Date(NOW), start); assert.equal(started.length, 1) // 07:52 → first attempt
  NOW += 10 * 60000; jobs.tick(new Date(NOW), start); assert.equal(started.length, 1) // 10 min later: too soon
  NOW += 25 * 60000; jobs.tick(new Date(NOW), start); assert.equal(started.length, 2)
  NOW += 31 * 60000; jobs.tick(new Date(NOW), start); assert.equal(started.length, 3)
  NOW += 31 * 60000; jobs.tick(new Date(NOW), start); assert.equal(started.length, 3) // cap reached
})
