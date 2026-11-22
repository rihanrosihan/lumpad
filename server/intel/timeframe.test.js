import test from 'node:test'
import assert from 'node:assert/strict'
import { timeFrame, frameNote, sessionFacts, loadAfter, sinceThen, diffDays } from './timeframe.js'

test('time frame: live for everything except a session review of a dated run', () => {
  assert.equal(timeFrame({ intent: 'daily_brief', today: '2026-11-22' }).mode, 'live')
  assert.equal(timeFrame({ intent: 'session_review', activityDate: null, today: '2026-11-22' }).mode, 'live')
  assert.equal(timeFrame({ intent: 'session_review', activityDate: '2026-11-22', today: '2026-11-22' }).mode, 'same_day')
  assert.deepEqual(timeFrame({ intent: 'session_review', activityDate: '2026-11-21', today: '2026-11-22' }), { mode: 'recent', session_date: '2026-11-21', today: '2026-11-22', days_ago: 1 })
  assert.equal(timeFrame({ intent: 'session_review', activityDate: '2026-11-19', today: '2026-11-22' }).mode, 'past')
  assert.equal(diffDays('2026-11-22', '2026-10-24'), 29)
})
test('past frames omit today (stable prompt fingerprint) and forbid day-specific orders; same_day adds nothing', () => {
  const tf = timeFrame({ intent: 'session_review', activityDate: '2026-10-24', today: '2026-11-22' })
  assert.equal(tf.today, undefined); const note = frameNote(tf); assert.match(note, /RETROSPECTIVE/); assert.match(note, /2026-10-24/); assert.match(note, /Do NOT give orders for a specific day/)
  assert.equal(frameNote({ mode: 'same_day' }), ''); assert.equal(frameNote({ mode: 'live' }), ''); assert.match(frameNote({ mode: 'recent', session_date: '2026-11-21', today: '2026-11-22', days_ago: 1 }), /1 day ago/)
})
test('session facts: the two reviewed runs — HR climbed late (not high throughout), last km not faster, walking share from run share', () => {
  const km = [[497, 153, 0.978], [510, 153, 0.933], [510, 149, 0.919], [520, 152, 0.86], [505, 156, 0.81], [500, 158, 0.78], [515, 160, 0.7], [530, 162, 0.7], [523, 167, 0.752], [460, 172, 0.776], [494, 177, 0.863]].map(([pace, hr, runShare], i) => ({ km: i + 1, pace, hr, runShare }))
  const f = sessionFacts(km, { run_share: 0.74, avg_hr: 159, distance_m: 21590 })
  assert.equal(f.walking_share_pct, 26); assert.equal(f.hr_first_3km, 152); assert.equal(f.hr_last_3km, 172); assert.equal(f.hr_trend, 'rose steadily late'); assert.equal(f.pace_trend, 'last km about the same pace as the first')
  const half = sessionFacts([{ km: 1, pace: 462, hr: 134, runShare: 0.99 }, { km: 2, pace: 456, hr: 143, runShare: 1 }, { km: 3, pace: 626, hr: 136, runShare: 0.69 }, { km: 4, pace: 470, hr: 150, runShare: 0.8 }], { run_share: 0.69 })
  assert.equal(half.walking_share_pct, 31); assert.equal(half.first_km_with_walking, 3); assert.equal(sessionFacts([{ km: 1 }], {}), undefined)
})
test('load after a day, and what happened since', () => {
  const daily = Array.from({ length: 60 }, (_, i) => ({ date: new Date(Date.UTC(2026, 8, 1 + i)).toISOString().slice(0, 10), tl: i === 53 ? 400 : 50 }))
  const a = loadAfter(daily, daily[53].date), b = loadAfter(daily, daily[52].date); assert.ok(a.atl > b.atl + 30); assert.ok(a.tsb_after < b.tsb_after); assert.equal(loadAfter([], '2026-01-01'), null)
  const s = sinceThen([{ date: '2026-10-24', sport: 'Run', distance_m: 21600 }, { date: '2026-10-25', sport: 'Run', distance_m: 9160, duration_s: 3000, avg_hr: 160 }, { date: '2026-10-27', sport: 'Walk', distance_m: 3000 }], '2026-10-24')
  assert.equal(s.n_activities, 2); assert.equal(s.run_km, 9.2); assert.equal(s.first_days[0].date, '2026-10-25')
})
