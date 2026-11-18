import test from 'node:test'
import assert from 'node:assert'
process.env.LUMPAD_DB = ':memory:'; process.env.DATA_DIR = '/tmp/lumpad-test-data'; process.env.LUMPAD_TOKEN_KEY = 'ab'.repeat(32)
const { db } = await import('./store.js')
const { applyIngest } = await import('./ingest.js')
const strava = await import('./strava.js')

test('shoe backfill matches Strava runs to COROS by start time (±3 min), skips non-runs and runs without gear', async () => {
  const t = Date.parse('2026-11-10T21:00:00Z') / 1000
  applyIngest({ activities: [{ source: 'coros', source_id: 'c1', date: '2026-11-11', sport: 'Run', start_ts: t + 60, distance_m: 6000 }, { source: 'coros', source_id: 'c2', date: '2026-11-12', sport: 'Run', start_ts: t + 90000, distance_m: 5000 }] })
  const pages = [{ data: [{ id: 1, sport_type: 'Run', gear_id: 'g1', start_date: new Date(t * 1000).toISOString() }, { id: 2, sport_type: 'Run', start_date: new Date((t + 90000) * 1000).toISOString() }, { id: 3, sport_type: 'Ride', gear_id: 'b1', start_date: new Date(t * 1000).toISOString() }] }, { data: { shoes: [{ id: 'g1', name: 'Clifton 10', brand_name: 'HOKA', distance: 313400 }] } }]
  const out = await strava.syncShoes({ fetchFn: async () => pages.shift() })
  assert.equal(out.matched, 1); assert.equal(out.noGear, 1); assert.equal(out.shoes, 1)
  assert.equal(db.prepare("SELECT gear_id FROM activities WHERE id='coros:c1'").get().gear_id, 'g1')
  assert.equal(db.prepare("SELECT gear_id FROM activities WHERE id='coros:c2'").get().gear_id, null)
  assert.equal(db.prepare("SELECT name, distance_m FROM gear WHERE id='g1'").get().distance_m, 313400)
})
test('status() never throws and reports not connected without a token', () => { assert.deepEqual(strava.status(), { configured: false, connected: false }) })
