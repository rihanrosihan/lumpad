import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { gearKey, mergeGearIds } from './gearkey.js'

test('gearKey strips only the Strava API "g" prefix on numeric ids', () => {
  assert.equal(gearKey('g32277471'), '32277471'); assert.equal(gearKey('32277471'), '32277471'); assert.equal(gearKey('b123'), 'b123'); assert.equal(gearKey('gabc'), 'gabc'); assert.equal(gearKey(null), '')
})
const mk = () => { const d = new DatabaseSync(':memory:'); d.exec(`CREATE TABLE gear (id TEXT PRIMARY KEY, name TEXT, brand TEXT, model TEXT, distance_m REAL, retired INTEGER, pulled_at TEXT);
  CREATE TABLE activities (id TEXT PRIMARY KEY, gear_id TEXT);`); return d }
test('mergeGearIds folds "g<id>" duplicates into the bare id and repoints activities', () => {
  const d = mk()
  d.prepare("INSERT INTO gear VALUES ('32277471','ASICS Novablast 5','','',600000,0,'2026-11-11')").run()
  d.prepare("INSERT INTO gear VALUES ('g32277471','ASICS Novablast 5','ASICS','Novablast 5',692000,0,'2026-11-18')").run()
  d.prepare("INSERT INTO gear VALUES ('g999','Lone shoe','','',100,0,'2026-11-18')").run()
  d.prepare("INSERT INTO activities VALUES ('a','32277471'), ('b','g32277471'), ('c','g999'), ('d',NULL)").run()
  const r = mergeGearIds(d)
  assert.equal(r.merged, 2)
  assert.deepEqual(d.prepare('SELECT id, brand, distance_m FROM gear ORDER BY id').all().map((g) => ({ ...g })), [{ id: '32277471', brand: 'ASICS', distance_m: 692000 }, { id: '999', brand: '', distance_m: 100 }])
  assert.deepEqual(d.prepare('SELECT id, gear_id FROM activities ORDER BY id').all().map((x) => ({ ...x })), [{ id: 'a', gear_id: '32277471' }, { id: 'b', gear_id: '32277471' }, { id: 'c', gear_id: '999' }, { id: 'd', gear_id: null }])
  assert.equal(mergeGearIds(d).merged, 0)   // idempotent
})
