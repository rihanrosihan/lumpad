// Pull traces for the Go replay test: runs the REAL Node pullRange against a scripted fake COROS (no personal data, in-memory DB) through
// scenarios that exercise every branch (retries, halving, page splits, duplicates, flaky laps, failing tools, multi-batch payloads).
import fs from 'node:fs'
import zlib from 'node:zlib'
process.env.LUMPAD_DB = ':memory:'; process.env.DATA_DIR = '/tmp/lumpad-trace-gen'; process.env.LUMPAD_TOKEN_KEY = 'cd'.repeat(32)
fs.mkdirSync(process.env.DATA_DIR, { recursive: true })
const { pullRange } = await import('../server/coros/pull.js'), kvdb = await import('../server/db.js'), { db } = await import('../server/store.js')

const dh = (d, hr) => `--- ${d.replace(/-/g, '')} ---\nSteps: ${hr * 100} | Calories: 1 kcal | Exercise: 0 min\nStress: Avg 30\nSleep Summary:\n  Total: 7h 0min | Deep: 1h 0min | Light: 4h 0min | REM: 1h 30min | Awake: 30 min\n  Sleep HR: Avg ${hr} bpm | Min 45 bpm | Max 80 bpm`
const LAPS = JSON.stringify({ lapGroups: [{ type: 2, laps: [{ distance: 100000, time: 450, avgPace: 450, avgHr: 150, avgCadence: 165, avgPower: 170, groundTime: 300, avgStrideLength: 81, strideHeight: 85, strideRatio: 74 }, { distance: 50000, time: 260, avgPace: 520, avgHr: 152, avgCadence: 0 }] }, { type: -1, laps: [{ avgCadence: 165, avgPower: 170, maxHr: 171 }] }] })
const rec = (i, d, sport = 100, name = 'Outdoor Run') => `${i}. ${name} — ${d}\n   Duration: 30:00 | Distance: ${(5 + i / 10).toFixed(2)} km\n   Average Pace: 6:00 /km | Avg HR: 150 bpm | Calories: 300 kcal\n   LabelId: ${9000 + i} | SportType: ${sport}\n   startTimestamp=${1790000000 + i * 3600} endTimestamp=${1790001800 + i * 3600}\n`
function fake(o = {}) {
  let lf = 0, n = 0
  return async (tool, a) => {
    n++
    if (o.fail?.[tool]) { const f = o.fail[tool]; if (typeof f === 'function' ? f(a) : true) throw new Error(`${tool}: COROS error ${n}`) }
    if (tool === 'queryDailyHealthData') return 'hdr\n\n' + ['2027-01-04', '2027-01-05', '2027-01-06', '2026-12-30'].map((d, i) => dh(d, 60 + i)).join('\n')
    if (tool === 'querySleepHrv') return `HRV Assessment\n${a.startDate.slice(0, 4)}-${a.startDate.slice(4, 6)}-${a.startDate.slice(6)}:\n  HRV Avg: 80 ms — Normal\n  Normal Range: 50 - 100 ms\n  Baseline: 78 ms\n\nSleep HRV Time Series\n2027-01-05:\n  hrv=1 ms`
    if (tool === 'queryRestingHeartRate') return '2027-01-05: 55 bpm\n2027-01-06: 57 bpm\n2026-12-01: 50 bpm'
    if (tool === 'querySportRecords') {
      const s = a.startDate, e = a.endDate, N = o.many && s <= '20270131' && e >= '20270101' ? o.many : 2
      const all = Array.from({ length: N }, (_, i) => [i + 1, `2027-01-${String(1 + (i % 28)).padStart(2, '0')}`]).filter(([, d]) => d.replace(/-/g, '') >= s && d.replace(/-/g, '') <= e)
      const list = all.map(([i, d]) => rec(i, d, i % 5 === 0 ? 402 : i % 7 === 0 ? 900 : 100, i % 5 === 0 ? 'Strength' : i % 7 === 0 ? 'Walk' : 'Outdoor Run'))
      if (o.dup && list.length) list.push(rec(1, '2027-01-01', 100, 'Outdoor Run (edited)'))
      return `Sport Records (${list.length})\n\n` + list.join('\n')
    }
    if (tool === 'queryTrainingLoadAssessment') return 'Training Load Assessment\n\n2027-01-06\nComment: Maintaining\nShort-Term Load: 40\nLong-Term Load: 60\nLoad Ratio: 0.67\n\n2027-01-05\nComment: Resuming\nShort-Term Load: 30\nLong-Term Load: 58\nLoad Ratio: 0.52'
    if (tool === 'querySleepOverview') return 'Sleep Overview\n\n2027-01-05\nSleep Score: 84\nAwake Count (>5 min): 0\n'
    if (tool === 'queryRecoveryStatus') return 'Recovery: 90%\nLevel: Fresh\nEstimated Full Recovery: 1d 4h'
    if (tool === 'queryFitnessAssessmentOverview') return 'VO2max: 47\nRunning Level: 66\nThreshold Pace: 5:56 /km\n5 km Prediction: 28:40\n10 km Prediction: 1:00:33\nHalf Marathon Prediction: 2:17:13\nMarathon Prediction: 4:53:04'
    if (tool === 'queryDevices') return 'Devices\n1. COROS APEX 4\n2. COROS POD 2\n'
    if (tool === 'queryTrainingSchedule') return o.emptyPlan ? 'Training Schedule\n====\n' : `Training Schedule\n====\n\n${a.startDate.slice(0, 4)}-${a.startDate.slice(4, 6)}-${a.startDate.slice(6)}\nP10540\nPlan ID: 9\nidInPlan: 1\nDistance: 8.00 km\nEstimated Time: 1:11:19\nLoad: 103 TL\n\n2027-01-02\nPlan ID: 9\nDistance: 800 m\n\nUse Plan ID`
    if (tool === 'getActivityDetail') return 'Training Load: 158\nAerobic TE: 3.6\nAnaerobic TE: 1.8\nTraining Focus: Tempo\nPerformance: Below Average\nAdjusted Pace: 5:58 /km'
    if (tool === 'queryActivityLapData') { if (o.lapAlwaysBad || lf++ < (o.lapFails || 0)) return 'Tool call anomalies detected. High risk of session context pollution'; return LAPS }
    throw new Error('unexpected tool ' + tool)
  }
}
const scenarios = [
  ['backfill, empty DB, plan due', { from: '2027-01-01', to: '2027-01-20', trigger: 'backfill' }, {}],
  ['re-run: laps and training load known, plan fresh', { from: '2027-01-01', to: '2027-01-20', trigger: 'daily' }, {}],
  ['flaky laps (2 bad answers then good)', { from: '2027-01-01', to: '2027-01-10', trigger: 'daily', clear: true }, { lapFails: 2 }],
  ['laps always unreadable', { from: '2027-01-01', to: '2027-01-10', trigger: 'daily', clear: true }, { lapAlwaysBad: true }],
  ['failing HRV, recovery, fitness, devices', { from: '2027-01-01', to: '2027-01-12', trigger: 'daily' }, { fail: { querySleepHrv: true, queryRecoveryStatus: true, queryFitnessAssessmentOverview: true, queryDevices: true } }],
  ['daily health and training load only answer short windows (halving)', { from: '2026-12-01', to: '2027-01-20', trigger: 'backfill' }, { fail: { queryDailyHealthData: (a) => a.days > 20, queryTrainingLoadAssessment: (a) => a.days > 12 } }],
  ['150 activities in January: page split + 2 payload batches + duplicate id', { from: '2027-01-01', to: '2027-02-03', trigger: 'backfill', clear: true, planStale: true }, { many: 150, dup: true }],
  ['320 activities: 2 batches; schedule fails', { from: '2027-01-01', to: '2027-01-31', trigger: 'backfill', clear: true, planStale: true }, { many: 320, fail: { queryTrainingSchedule: (a) => a.startDate > '20270101' } }],
  ['empty schedule with no previous copy; activities fail', { from: '2027-01-03', to: '2027-01-05', trigger: 'daily', noPlan: true }, { emptyPlan: true, fail: { querySportRecords: true } }],
]
const traces = []
for (const [name, a, o] of scenarios) {
  if (a.clear) { db.exec('DELETE FROM laps'); db.exec('UPDATE activities SET training_load = NULL') }
  if (a.planStale) kvdb.save('coros_plan', { rows: [], at: '2020-01-01T00:00:00Z' })
  if (a.noPlan) kvdb.save('coros_plan', null)
  await pullRange({ call: fake(o), from: a.from, to: a.to, trigger: a.trigger, notes: [] })
  const row = db.prepare('SELECT body FROM pull_trace ORDER BY id DESC LIMIT 1').get()
  traces.push({ name, trace: JSON.parse(zlib.gunzipSync(row.body).toString('utf8')) })
}
fs.writeFileSync('lumpadd/internal/coros/testdata/pull_traces.json', JSON.stringify(traces))
console.log(traces.map((t) => `${t.name}: ${t.trace.calls.length} calls, ${t.trace.payloads.length} payloads, ${t.trace.payloads.reduce((s, p) => s + p.activities.length, 0)} activities, notes ${t.trace.payloads[0].run.notes.length}`).join('\n'))
