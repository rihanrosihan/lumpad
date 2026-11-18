import test from 'node:test'
import assert from 'node:assert/strict'
import { decompose, filterSql } from './query.js'

const gear = [{ id: 'g1', name: 'HOKA Mach X2' }, { id: 'g2', name: 'ASICS Novablast 5' }, { id: 'g3', name: 'HOKA Clifton 10' }]
const T = '2026-11-18'
test('dates: relative, named month, ISO, race name', () => {
  assert.deepEqual(decompose('how was my sleep last week', { today: T }).filters, { from: '2026-11-11', to: T })
  assert.deepEqual(decompose('runs in October 2026 above 160 bpm', { today: T }).filters, { from: '2026-10-01', to: '2026-10-31', hr_min: 160 })
  assert.equal(decompose('what happened on 2026-11-10', { today: T }).filters.from, '2026-11-10')
  const b = decompose('compare Borobudur 2026 with the long runs', { today: T }).filters; assert.equal(b.from, '2026-11-15'); assert.equal(b.race_date, '2026-11-15'); assert.match(b.race, /Borobudur/)
  const o = decompose('long runs in October 2026 vs Borobudur 2026', { today: T }).filters; assert.equal(o.from, '2026-10-01'); assert.equal(o.race_date, '2026-11-15')
})
test('no false month matches ("marathon", "may")', () => {
  const d = decompose('may I run a marathon pace session?', { today: T }); assert.equal(d.filters.from, undefined); assert.deepEqual(d.filters.dist_km, [35, 50])
})
test('distance, type, shoe, indoor, topics', () => {
  const d = decompose('GCT drift on long runs in the Mach X2 after leg day', { today: T, gear })
  assert.deepEqual(d.filters.kinds, ['long']); assert.deepEqual(d.filters.dist_km, [16, 50]); assert.deepEqual(d.filters.shoes.map((s) => s.id), ['g1'])
  assert.ok(d.topics.includes('gct_fade') && d.topics.includes('drift') && d.topics.includes('strength_lower') && d.topics.includes('shoes'))
  assert.deepEqual(decompose('10k on the treadmill', { today: T }).filters, { dist_km: [8.5, 11.5], indoor: true })
  assert.deepEqual(decompose('kapan lari santai pakai novablast 3 minggu terakhir', { today: T, gear }).filters.shoes.map((s) => s.id), ['g2'])
})
test('filterSql is parameterised', () => {
  const { where, params } = filterSql({ from: '2026-10-01', to: '2026-10-31', hr_min: 160, shoes: [{ id: 'g1' }] })
  assert.equal(where, 'WHERE s.date >= ? AND s.date <= ? AND s.run_hr >= ? AND s.shoe_id IN (?)'); assert.deepEqual(params, ['2026-10-01', '2026-10-31', 160, 'g1'])
})
