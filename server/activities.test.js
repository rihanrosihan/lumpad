import test from 'node:test'
import assert from 'node:assert'
process.env.LUMPAD_DB = ':memory:'; process.env.DATA_DIR = (await import('node:fs')).mkdtempSync((await import('node:path')).join((await import('node:os')).tmpdir(), 'lumpad-test-data-'))
const { mergeActivities, readinessData } = await import('./activities.js'), { applyIngest } = await import('./ingest.js')
const run = (source, id, extra = {}) => ({ source, id: `${source}:${id}`, date: '2027-01-05', sport: 'Run', distance_m: 6060, duration_s: 2693, start_ts: 1800000000, ...extra })

test('COROS + Strava copies of one run merge into one; COROS metrics win, Strava adds shoe/weather/name', () => {
  const out = mergeActivities([run('coros', '1', { training_load: 158, power: 177 }), run('strava', '9', { distance_m: 6058.9, name: 'Morning Run', gear_id: 'g1', temp_c: 27 })])
  assert.equal(out.length, 1); assert.deepEqual(out[0].sources, ['coros', 'strava']); assert.equal(out[0].training_load, 158); assert.equal(out[0].gear_id, 'g1'); assert.equal(out[0].name, 'Morning Run'); assert.equal(out[0].temp_c, 27)
})
test('different distance or sport class stays separate; two runs same day pair correctly', () => {
  assert.equal(mergeActivities([run('coros', '1'), run('strava', '9', { distance_m: 9000 })]).length, 2)
  assert.equal(mergeActivities([run('coros', '1'), run('strava', '9', { sport: 'Walk' })]).length, 2)
  const two = mergeActivities([run('coros', '1', { distance_m: 4250, start_ts: 1 }), run('coros', '2', { distance_m: 9160, start_ts: 2 }), run('strava', '8', { distance_m: 9161 }), run('strava', '7', { distance_m: 4249 })])
  assert.equal(two.length, 2); assert.ok(two.every((x) => x.sources.length === 2)); assert.equal(two.find((x) => x.id === 'coros:2').ids[1], 'strava:8')
})
test('strength: COROS "Strength" pairs with Strava "WeightTraining" by duration', () => {
  const out = mergeActivities([{ source: 'coros', id: 'coros:5', date: '2027-01-05', sport: 'Strength', duration_s: 1771, distance_m: null }, { source: 'strava', id: 'strava:5', date: '2027-01-05', sport: 'WeightTraining', duration_s: 2069 * 0 + 1800, distance_m: 0 }])
  assert.equal(out.length, 1)
})
test('readiness data: load per day sums COROS training load only (no double counting with Strava copies)', () => {
  applyIngest({ health: [{ date: '2027-01-05', load_short: 40, load_long: 60, load_ratio: 0.67, load_comment: 'Maintaining', sleep_score: 84 }],
    activities: [{ source: 'coros', source_id: 'a', date: '2027-01-05', distance_m: 5000, training_load: 100 }, { source: 'coros', source_id: 'b', date: '2027-01-05', distance_m: 1000, training_load: 20 }, { source: 'strava', source_id: 'c', date: '2027-01-05', distance_m: 5000 }],
    fitness: [{ date: '2027-01-05', vo2max: 47, pred_m_s: 17584 }] })
  const r = readinessData('2027-01-01', '2027-01-31'); assert.equal(r.loads[0].load, 120); assert.equal(r.health[0].load_ratio, 0.67); assert.equal(r.fitness.vo2max, 47)
})

test('Garmin-only history rows are listed as their own activity (not dropped)', async () => {
  const { mergeActivities } = await import('./activities.js')
  const rows = [{ id: 'coros:1', source: 'coros', sport: 'Run', date: '2025-05-01', distance_m: 5000, duration_s: 1500, start_ts: 1 }, { id: 'garmin:9', source: 'garmin', sport: 'Walk', date: '2025-05-01', distance_m: 2000, duration_s: 900, start_ts: 2 }]
  const m = mergeActivities(rows); assert.equal(m.length, 2); assert.deepEqual(m.find((x) => x.id === 'garmin:9').sources, ['garmin'])
})
