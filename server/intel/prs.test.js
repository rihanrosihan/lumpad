import test from 'node:test'
import assert from 'node:assert'
process.env.DATA_DIR = (await import('node:fs')).mkdtempSync((await import('node:path')).join((await import('node:os')).tmpdir(), 'prs-'))
const P = await import('./prs.js')
const TEXT = `Best Efforts
400m    1:58 https://www.strava.com/activities/17323939491/best-efforts
1/2 mile    4:04 https://www.strava.com/activities/17323939491/best-efforts
1K    5:07 https://www.strava.com/activities/17323939491/best-efforts
5K    29:21 https://www.strava.com/activities/20150551990/best-efforts
10K    59:48 https://www.strava.com/activities/20150551990/best-efforts
Half-Marathon    2:45:24 https://www.strava.com/activities/19961681031/best-efforts
Marathon    6:42:18 -> https://www.strava.com/activities/18911502236/best-efforts
Activities    342`
test('Strava best-efforts block is parsed (labels, h:mm:ss, urls, the -> arrow), noise ignored', () => {
  const r = P.parseStravaPRs(TEXT); assert.deepEqual(r.map((x) => x.label), ['400m', '1/2 mile', '1K', '5K', '10K', 'Half-Marathon', 'Marathon'])
  assert.equal(r.find((x) => x.label === '5K').time_s, 1761); assert.equal(r.find((x) => x.label === 'Half-Marathon').time_s, 9924); assert.equal(r.find((x) => x.label === 'Marathon').time_s, 24138)
  assert.equal(r.find((x) => x.label === 'Marathon').activity_id, '18911502236'); assert.equal(r.find((x) => x.label === '5K').pace_s_km, 352.2)
  assert.ok(r.find((x) => x.label === '10K').vdot > 31.5 && r.find((x) => x.label === '10K').vdot < 33, 'a 59:48 10K is worth VDOT ~32')
})
test('saving keeps the records and fills dates from the Strava API when available, and survives it being unavailable', async () => {
  const d = await P.savePRs(TEXT, { activityFn: async (id) => { if (id === '20150551990') return { id, start_date_local: '2026-09-13T05:30:00Z', name: 'MILO 10K' }; throw new Error('401') } })
  assert.equal(d.prs.length, 7); assert.equal(d.prs.find((x) => x.label === '5K').date, '2026-09-13'); assert.equal(d.prs.find((x) => x.label === '1K').date, null)
  assert.equal(P.loadPRs().prs.length, 7); await assert.rejects(() => P.savePRs('nothing here'), /No Strava best efforts/)
})

test('activity detail keeps what is useful and drops location and free text', () => {
  const d = P.activityDetail({ id: 20150551990, name: 'MILO 10K', start_date_local: '2026-09-13T05:30:00Z', sport_type: 'Run', distance: 10130, moving_time: 3700, elapsed_time: 3800, total_elevation_gain: 40, average_heartrate: 168, max_heartrate: 186, start_latlng: [1, 2], description: 'private',
    best_efforts: [{ name: '5K', elapsed_time: 1761, distance: 5000, pr_rank: 1 }], splits_metric: [{ split: 1, distance: 1000, moving_time: 360, average_heartrate: 150, elevation_difference: 2 }] })
  assert.equal(d.date, '2026-09-13'); assert.equal(d.best_efforts[0].pr_rank, 1); assert.equal(d.splits[0].pace_s, 360); assert.equal(d.url, 'https://www.strava.com/activities/20150551990')
  assert.ok(!('start_latlng' in d) && !('description' in d)); assert.equal(P.activityDetail(null), null)
})
test('refresh re-reads the activities of the saved records and keeps the records', async () => {
  await P.savePRs(TEXT, { activityFn: async () => { throw new Error('401') } })
  const r = await P.refreshActivities({ activityFn: async (id) => ({ id, name: 'Run ' + id, start_date_local: '2026-01-02T00:00:00Z' }) })
  assert.ok(r.ok >= 4 && r.failed === 0); const d = P.loadPRs(); assert.equal(d.prs.length, 7); assert.equal(d.prs[0].date, '2026-01-02'); assert.ok(d.activities['20150551990'])
})
