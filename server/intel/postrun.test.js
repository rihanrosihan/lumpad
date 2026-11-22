import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
process.env.INTEL_DB = ':memory:'; process.env.MEMORY_DB = ':memory:'; process.env.DATA_DIR = fs.mkdtempSync((await import('node:path')).join((await import('node:os')).tmpdir(), 'lumpad-pr-'))
const { idb, mdb } = await import('./db.js'), { todayActivity } = await import('./today.js'), { postRunTarget } = await import('./schedule.js'), G = await import('./grounding.js')
const twin = (asOf) => ({ created_at: '2026-11-22T06:47:00Z', state: { as_of: asOf, load: { ctl: 76.1, atl: 106.4, tsb: -14.2, acwr_ewma: 1.4 } } })
const run = { id: 'coros:1', name: 'Outdoor Run', sport: 'Run', distance_m: 11200, duration_s: 5964, avg_hr: 146, avg_pace_s_km: 475, training_load: 201, fit: true }

test('no activity today: no block (the normal morning brief)', () => assert.equal(todayActivity([], twin('2026-11-22'), '2026-11-22'), undefined))
test('after a run: the activity, its load and form before → after (CTL − ATL)', () => {
  const t = todayActivity([run], twin('2026-11-22'), '2026-11-22')
  assert.equal(t.activities[0].km, 11.2); assert.equal(t.activities[0].minutes, 99); assert.equal(t.tl_today, 201)
  assert.equal(t.load.tsb_this_morning, -14.2); assert.equal(t.load.tsb_after_today, -30.3)
})
test('twin not rebuilt for today: load after today is declared unknown, never guessed', () => {
  const t = todayActivity([run], twin('2026-11-21'), '2026-11-22'); assert.equal(t.load.tsb_after_today, undefined); assert.match(t.load.note, /not been rebuilt/)
})
test('the answer may quote today_activity numbers: they are part of the grounding base', () => {
  const user = 'CONTEXT JSON:\n' + JSON.stringify({ twin: {}, telemetry: [], correlation_edges: [], today_activity: todayActivity([run], twin('2026-11-22'), '2026-11-22') })
  const v = G.verifyAnswer({ summary: 'You ran 11.2 km at 146 bpm, load 201; form went from -14.2 to -30.3', analysis_md: '', recommendations: [], cited_ids: [] }, { itemIds: [], items: [], base: G.measuredBase(user) })
  assert.deepEqual(v.unverified, [])
})
test('post-run brief: only after a brief exists and a run was processed later; once per run', () => {
  const day = '2026-11-22'
  assert.equal(postRunTarget(day), null)   // no brief yet: the normal brief covers the run
  mdb.prepare("INSERT INTO coach_run (created_at, intent, provider, ok) VALUES ('2026-11-22T00:10:00Z','daily_brief','deepseek',1)").run()   // 07:10 WIB
  idb.prepare("INSERT INTO fit_session (label_id, date, start_ms, parser_version, metrics, km, processed_at) VALUES ('L1',?,1,1,'{}','[]','2026-11-22T06:47:00.000Z')").run(day)
  assert.equal(postRunTarget(day), 'after-run L1')
  mdb.prepare("INSERT INTO coach_run (created_at, intent, provider, question, ok) VALUES ('2026-11-22T06:50:00Z','daily_brief','deepseek','after-run L1',1)").run()
  assert.equal(postRunTarget(day), null)   // done for that run
})

test('tomorrow\'s planned session is part of today_activity (so the brief can judge it)', () => {
  const tm = { date: '2026-11-23', kind: 'easy', label: 'Aerobic Endurance Run', km: 8, tl: 103, steps: [{ t: 'wu', sec: 300 }, { t: 'run', m: 8000, z: 2 }] }
  const t = todayActivity([run], twin('2026-11-22'), '2026-11-22', tm)
  assert.deepEqual(t.tomorrow_plan, { date: '2026-11-23', kind: 'easy', label: 'Aerobic Endurance Run', km: 8, planned_tl: 103, hr_zone: 2 })
  assert.equal(todayActivity([run], twin('2026-11-22'), '2026-11-22').tomorrow_plan, null)
})
