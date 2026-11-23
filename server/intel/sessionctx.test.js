import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
process.env.INTEL_DB = ':memory:'; process.env.MEMORY_DB = ':memory:'; process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lumpad-sc-'))
const { addContext, listContext, removeContext, excludedDates, addFact, listFacts, sessionAnomalies, sessionBackground } = await import('./sessionctx.js')
const { mdb, idb } = await import('./db.js')

test('addContext validates, applies the athlete-choice defaults and upserts by date + purpose', () => {
  assert.throws(() => addContext({ date: 'yesterday', note: 'ran with a friend' }), /YYYY-MM-DD/)
  assert.throws(() => addContext({ date: '2026-11-22', note: 'no' }), /sentence/)
  const a = addContext({ date: '2026-11-22', purpose: 'social_walk', note: 'ran 8 km and walked 3 km with my partner', run_km: '8', walk_km: 3 })
  assert.equal(a.intentional_walking, 1); assert.equal(a.counts_for_fitness, 0); assert.equal(a.run_km, 8); assert.equal(a.walk_km, 3)
  const b = addContext({ date: '2026-11-22', purpose: 'social_walk', note: 'corrected: 8.5 km running, 2.5 km walking', run_km: 8.5, walk_km: 2.5 })
  assert.equal(b.id, a.id); assert.equal(listContext().length, 1); assert.equal(b.run_km, 8.5)
  const c = addContext({ date: '2026-11-15', purpose: 'planned_run_walk', note: 'my run-walk strategy', counts_for_fitness: true })
  assert.equal(c.counts_for_fitness, 1); assert.equal(addContext({ date: '2026-11-01', note: 'something unusual happened' }).intentional_walking, 0)
})
test('excludedDates only holds sessions the athlete said are not a fitness test; a note can be removed', () => {
  assert.deepEqual([...excludedDates()], ['2026-11-22'])
  const id = listContext({ from: '2026-11-22', to: '2026-11-22' })[0].id; assert.equal(removeContext(id).ok, true); assert.equal(excludedDates().size, 0); assert.equal(removeContext(id).ok, false)
})
test('addFact stores an active REPORTED note the athlete can see and that is not duplicated', () => {
  assert.throws(() => addFact('short'), /sentence/)
  const r = addFact('At events I often stop to cheer and film content; walking there is a choice.'); assert.equal(r.created, true)
  assert.equal(addFact('At events I often stop to cheer and film content; walking there is a choice.').created, false)
  const m = mdb.prepare('SELECT tier, evidence_tag, status, source FROM memory WHERE id=?').get(r.id); assert.deepEqual({ ...m }, { tier: 'semantic', evidence_tag: 'REPORTED', status: 'active', source: 'athlete' })
  assert.equal(listFacts().length, 1)
})

test('a note on a stretch of one run never takes the whole session out of fitness stats, and re-saving the same stretch replaces it', () => {
  const a = addContext({ date: '2026-11-22', km_from: 9, km_to: 12, kind: 'walk', purpose: 'social_walk', counts_for_fitness: false })
  assert.equal(a.km_from, 9); assert.equal(a.kind, 'walk'); assert.equal(a.counts_for_fitness, 1); assert.equal(a.intentional_walking, 1); assert.match(a.note, /km 9–12/)
  assert.equal(excludedDates().size, 0)
  const b = addContext({ date: '2026-11-22', km_from: 9, km_to: 12, kind: 'walk', purpose: 'felt_tired', note: 'my legs were done' })
  assert.equal(b.id, a.id); assert.equal(b.purpose, 'felt_tired'); assert.equal(b.intentional_walking, 0)
  assert.throws(() => addContext({ date: '2026-11-22', km_from: 3, km_to: 3, purpose: 'other' }), /reason/)
  addContext({ date: '2026-11-22', purpose: 'social_walk', note: 'whole session was an easy outing', counts_for_fitness: false }); assert.deepEqual([...excludedDates()], ['2026-11-22'])
})
test('sessionAnomalies reads the kilometre rows of a run by id or by date and reports saved notes; unknown runs say so', () => {
  const km = [1, 2, 3, 4, 5, 6].map((k) => ({ km: k, sec: 360, pace: 360, runPace: 360, hr: 150, gain: 2, walk: k === 5 ? 200 : 0, stop: 0, runShare: k === 5 ? 0.4 : 1 }))
  idb.prepare('INSERT INTO fit_session (label_id, activity_id, date, parser_version, distance_m, metrics, km, processed_at) VALUES (?,?,?,?,?,?,?,?)').run('L1', 'coros:99', '2026-11-22', 1, 6000, '{}', JSON.stringify(km), 'x')
  const a = sessionAnomalies({ id: 'coros:99' }), b = sessionAnomalies({ date: '2026-11-22' })
  assert.equal(a.found, true); assert.deepEqual(a.anomalies.map((x) => [x.kind, x.km_from]), [['walk', 5]]); assert.equal(b.label_id, 'L1'); assert.ok(a.saved.length >= 1); assert.equal(a.series.length, 6)
  assert.equal(sessionAnomalies({ date: '2020-01-01' }).found, false); assert.equal(sessionAnomalies({}).found, false)
})

test('addContext can edit a note by id, including its date and reason, without creating a second one', () => {
  const a = addContext({ date: '2026-12-01', purpose: 'social_walk', note: 'easy outing with a friend' })
  const b = addContext({ id: a.id, date: '2026-12-02', purpose: 'cheering_content', note: 'actually it was a cheering zone', intentional_walking: true })
  assert.equal(b.id, a.id); assert.equal(b.date, '2026-12-02'); assert.equal(b.purpose, 'cheering_content'); assert.equal(listContext({ from: '2026-12-01', to: '2026-12-02' }).length, 1)
})
test('sessionBackground collects weather, body, pain, injury and earlier notes for a day, and tolerates missing sources', () => {
  idb.prepare('INSERT INTO fit_session (label_id, activity_id, date, parser_version, distance_m, metrics, km, processed_at) VALUES (?,?,?,?,?,?,?,?)').run('B1', 'coros:7', '2026-10-01', 1, 10000, '{}', '[]', 'x')
  idb.prepare('INSERT INTO run_weather (label_id, indoor, temp_c, rh, wind_ms, wbgt, fetched_at) VALUES (?,?,?,?,?,?,?)').run('B1', 0, 29.4, 88, 1.2, 30.1, 'x')
  idb.prepare('INSERT INTO daily_feat (date, run_km, tl, sleep_min, sleep_hr, hrv_dev, rhr, feel) VALUES (?,?,?,?,?,?,?,?)').run('2026-10-01', 10, 180, 400, 62, -0.12, 60, 4)
  idb.prepare('INSERT INTO daily_log (date, feel, pain, updated_at) VALUES (?,?,?,?)').run('2026-10-02', 3, JSON.stringify({ all: 2, thigh: 2 }), 'x')
  mdb.prepare("INSERT INTO memory (tier, kind, title, body, evidence_tag, status, created_by, hash, created_at, updated_at, valid_from) VALUES ('semantic','fact','Thigh pain started in September','x','KB','active','t','h-inj','x','x','2026-09-20')").run()
  addContext({ date: '2026-09-15', purpose: 'planned_run_walk', note: 'planned run-walk for the long run' })
  const b = sessionBackground({ date: '2026-10-01' })
  assert.equal(b.weather.wbgt, 30.1); assert.equal(b.weather.hot_for_running, true); assert.equal(b.weather.humidity_pct, 88); assert.equal(b.body.that_morning.sleep_h, 6.7); assert.equal(b.pain_log[0].pain, 'all 2/10, thigh 2/10')
  assert.ok(b.injury.notes.some((n) => /Thigh pain/.test(n.title))); assert.deepEqual(b.previous_context.map((x) => x.date), ['2026-09-15'])
  const none = sessionBackground({ date: '2019-01-01' }); assert.equal(none.weather, null); assert.equal(none.body, null); assert.deepEqual(none.pain_log, [])
  assert.throws(() => sessionBackground({ date: 'x' }), /YYYY-MM-DD/)
})
