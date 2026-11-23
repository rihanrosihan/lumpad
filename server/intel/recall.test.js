import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { expandTerms, stem, buildIndex, tfidfRank, planRows, journalRows, dailyRows, priorAnswers, recallCount } from './recall.js'

test('expandTerms: Indonesian and English meet, existing words are not repeated', () => {
  const e = expandTerms('kenapa kontak tanah naik di lari panjang saat panas')
  assert.ok(e.includes('gct') && e.includes('wbgt') && e.includes('heat'))
  assert.ok(!e.includes('panas'))
  assert.deepEqual(expandTerms('xyzzy'), [])
})
test('expandTerms: topic ids reach their synonym group', () => assert.ok(expandTerms('why', ['sleep_min']).includes('tidur')))
test('stem keeps short words and strips common suffixes', () => { assert.equal(stem('run'), 'run'); assert.equal(stem('walking'), 'walk'); assert.equal(stem('shoes'), 'shoe') })
test('tfidfRank finds a paraphrase that shares no exact phrase and ignores noise', () => {
  const idx = buildIndex([{ id: 1, title: 'Late-run walking in heat', body: 'run share fell once WBGT passed 26 in long runs' }, { id: 2, title: 'Shoe stack heights', body: 'foam and plate notes for the new pair' }, { id: 3, title: 'Sleep', body: 'sleep heart rate above 67 means no hard running' }])
  const r = tfidfRank(idx, 'long runs walking when hot WBGT')
  assert.equal(r[0].id, 1); assert.ok(!r.some((x) => x.id === 2))
  assert.deepEqual(tfidfRank(idx, 'zzz qqq'), [])
})
test('planRows pairs plan with done km inside the window', () => {
  const r = planRows([{ date: '2026-10-01', kind: 'easy', km: 8 }, { date: '2026-10-09', kind: 'long', km: 20, label: 'LR' }], [{ date: '2026-10-09', run_km: 19.2 }], { from: '2026-10-05', to: '2026-10-12' })
  assert.deepEqual(r, [{ date: '2026-10-09', kind: 'long', label: 'LR', km: 20, done_km: 19.2 }]); assert.deepEqual(planRows([], [], {}), [])
})
test('journal, daily and prior answers read their tables and survive missing ones', () => {
  const idb = new DatabaseSync(':memory:'); idb.exec("CREATE TABLE daily_log (date TEXT PRIMARY KEY, feel INTEGER, pain TEXT, gi INTEGER, strength TEXT, fuel TEXT, updated_at TEXT); CREATE TABLE daily_feat (date TEXT PRIMARY KEY, run_km REAL, tl REAL, sleep_min REAL, hrv_dev REAL, rhr REAL, wbgt REAL, pain_max REAL, strength_lower INTEGER);")
  idb.exec("INSERT INTO daily_log VALUES ('2026-10-20',3,'left VMO 2/10',1,NULL,'gel at km 8','x'); INSERT INTO daily_feat (date, run_km, wbgt) VALUES ('2026-10-20', 12.34, 27.5)")
  assert.equal(journalRows(idb, { from: '2026-10-19', to: '2026-10-21', today: '2026-10-22' })[0].pain, 'left VMO 2/10')
  assert.equal(journalRows(idb, { today: '2026-10-22', wantsRecent: false }).length, 0)
  assert.deepEqual(dailyRows(idb, { from: '2026-10-20', to: '2026-10-20' }), [{ date: '2026-10-20', run_km: 12.3, wbgt: 27.5 }])
  const empty = new DatabaseSync(':memory:'); assert.deepEqual(journalRows(empty, { from: '2026-01-01', today: '2026-01-02' }), []); assert.deepEqual(priorAnswers(empty, 'heat'), [])
  const mdb = new DatabaseSync(':memory:'); mdb.exec('CREATE TABLE coach_run (id INTEGER PRIMARY KEY, created_at TEXT, intent TEXT, question TEXT, parsed TEXT, ok INTEGER)')
  mdb.prepare('INSERT INTO coach_run VALUES (?,?,?,?,?,1)').run(1, '2026-10-01T00:00:00Z', 'question', 'heat plan for the marathon', JSON.stringify({ summary: 'Open the marathon at +10 s/km in heat and cap HR at 160.' }))
  mdb.prepare('INSERT INTO coach_run VALUES (?,?,?,?,?,1)').run(2, '2026-10-02T00:00:00Z', 'weekly_review', '', JSON.stringify({ summary: 'Hold volume next week.' }))
  const p = priorAnswers(mdb, 'marathon heat opening pace'); assert.equal(p[0].run, 1); assert.equal(priorAnswers(mdb, 'marathon heat opening pace', { excludeQuestion: 'heat plan for the marathon' }).length, 0); assert.equal(recallCount({ a: p, b: 1 }), 1)
})

import { weeklyRows } from './recall.js'
import { decompose } from './query.js'
test('weeklyRows: Monday-start totals reach back one window so "vs the week before" has numbers', () => {
  const idb = new DatabaseSync(':memory:'); idb.exec('CREATE TABLE daily_feat (date TEXT PRIMARY KEY, run_km REAL, tl REAL, strength INTEGER, sleep_min REAL, hrv_dev REAL)')
  const ins = idb.prepare('INSERT INTO daily_feat (date, run_km, tl) VALUES (?,?,?)'); ins.run('2026-11-02', 4, 40); ins.run('2026-11-09', 43, 300); ins.run('2026-11-10', 0, 0); ins.run('2026-11-16', 16.4, 120)
  const r = weeklyRows(idb, { from: '2026-10-26', to: '2026-11-23', today: '2026-11-23' })
  assert.deepEqual(r.map((x) => [x.week_start, x.run_km]), [['2026-11-16', 16.4], ['2026-11-09', 43], ['2026-11-02', 4]])
  assert.deepEqual(weeklyRows(idb, { from: '2026-11-20', to: '2026-11-22' }), []); assert.deepEqual(dailyRows(idb, { from: '2026-10-26', to: '2026-11-23' }), [])
})
test('decompose: one-sided distance bounds and "this year"', () => {
  const d = decompose('Show my long runs above 30 km this year', { today: '2026-11-23' })
  assert.deepEqual(d.filters.dist_km, [30, 500]); assert.equal(d.filters.from, '2026-01-01'); assert.equal(d.filters.to, '2026-11-23')
  assert.deepEqual(decompose('runs under 10 km', { today: '2026-11-23' }).filters.dist_km, [0, 10])
})

test('decompose: two named races keep both dates', () => {
  const f = decompose('Bandingkan Borobudur 2026 dengan JRF FM 2026', { today: '2026-11-23' }).filters
  assert.deepEqual([...f.race_dates].sort(), ['2026-10-25', '2026-11-15'])
})

test('decompose: a shoe is not matched by an ordinary word of its name', () => {
  const gear = [{ id: 'p', name: 'PUMA Deviate Nitro Elite 2' }, { id: 'a', name: 'ASICS Novablast 5' }]
  assert.deepEqual(decompose('Did I follow the plan? Where did I deviate?', { today: '2026-11-23', gear }).filters.shoes ?? [], [])
  assert.deepEqual(decompose('how did the Deviate Nitro shoes do', { today: '2026-11-23', gear }).filters.shoes.map((s) => s.id), ['p'])
  assert.deepEqual(decompose('long runs in my Novablast', { today: '2026-11-23', gear }).filters.shoes.map((s) => s.id), ['a'])
})

import { countBlock, placesIn } from './recall.js'
test('countBlock counts runs by place text, only for counting questions, runs only and one source', () => {
  const app = new DatabaseSync(':memory:'); app.exec('CREATE TABLE activities (id TEXT, source TEXT, date TEXT, sport TEXT, name TEXT, location TEXT, distance_m REAL)')
  const ins = app.prepare('INSERT INTO activities VALUES (?,?,?,?,?,?,?)')
  ins.run('1', 'strava', '2026-11-06', 'Run', 'Afternoon Run', 'Taman Mini Indonesia Indah (TMII), Indonesia', 5000); ins.run('2', 'coros', '2026-11-06', 'Walk', 'Afternoon Walk', 'Taman Mini Indonesia Indah (TMII), Indonesia', 2000)
  ins.run('1c', 'coros', '2026-11-06', 'Run', 'Outdoor Run', 'East Jakarta Run', 4990); ins.run('3', 'coros', '2024-10-14', 'Run', 'First 10K TMII', 'Jakarta', 10000); ins.run('3s', 'strava', '2024-10-14', 'Run', 'First 10K TMII', 'Jakarta', 10000); ins.run('4', 'coros', '2026-01-02', 'Run', 'Morning Run', 'East Jakarta Run', 8000)
  const c = countBlock(app, 'berapa banyak lari yang saya lakukan di tmii?', {})[0]
  assert.equal(c.places.tmii.runs, 2); assert.equal(c.places.tmii.km, 15); assert.deepEqual(c.places.tmii.by_year, { 2024: 1, 2026: 1 }); assert.equal(c.all_runs_in_window.runs, 3) // the 2026 run is found through its Strava twin, and counted once; assert.match(c.place_note, /11 km/)
  assert.equal(countBlock(app, 'ceritakan lari di tmii', {}).length, 0); assert.equal(countBlock(app, 'berapa lari tahun ini', { from: '2026-01-01', to: '2026-12-31' })[0].all_runs_in_window.runs, 2)
  assert.deepEqual([decompose('berapa kali saya lari tahun 2026?', { today: '2026-11-23' }).filters.from, decompose('Borobudur 2026', { today: '2026-11-23' }).filters.from], ['2026-01-01', '2026-11-15'])
  assert.deepEqual(placesIn('lari di GBK dan Taman Mini'), ['tmii', 'gbk'])
})

test('priorAnswers never recalls brief answers or refusals; countBlock counts the athlete race record', () => {
  const m = new DatabaseSync(':memory:'); m.exec('CREATE TABLE coach_run (id INTEGER PRIMARY KEY, created_at TEXT, intent TEXT, question TEXT, parsed TEXT, ok INTEGER)')
  const add = (id, intent, summary) => m.prepare('INSERT INTO coach_run VALUES (?,?,?,?,?,1)').run(id, '2026-11-01T00:00:00Z', intent, 'q', JSON.stringify({ summary }))
  add(1, 'daily_brief', 'TMII race plan easy run today'); add(2, 'question', 'Belum bisa dihitung: jumlah lari di TMII belum ditarik.'); add(3, 'question', 'TMII runs: 4 runs at TMII')
  assert.deepEqual(priorAnswers(m, 'tmii runs', { limit: 5 }).map((x) => x.run), [3])
  const app = new DatabaseSync(':memory:'); app.exec('CREATE TABLE activities (id TEXT, source TEXT, date TEXT, sport TEXT, name TEXT, location TEXT, distance_m REAL)')
  const races = [{ date: '2025-01-12', name: 'A' }, { date: '2025-06-15', name: 'B' }, { date: '2026-05-24', name: 'C' }]
  const c = countBlock(app, 'berapa kali total race yang gue lakukan', {}, races)[0]
  assert.equal(c.races.total, 3); assert.deepEqual(c.races.by_year, { 2025: 2, 2026: 1 }); assert.equal(countBlock(app, 'berapa race 2025', { from: '2025-01-01', to: '2025-12-31' }, races)[0].races.total, 2)
  assert.equal(decompose('kapan pertama kali half marathon', { today: '2026-11-23' }).filters.oldest, true)
})

import { rankBlock, distanceOf } from './recall.js'
test('rankBlock ranks every run by time scaled to the distance, and finds the best stretch inside longer runs', () => {
  const app = new DatabaseSync(':memory:'); app.exec('CREATE TABLE activities (id TEXT, source TEXT, date TEXT, sport TEXT, name TEXT, location TEXT, distance_m REAL, duration_s REAL)')
  const add = app.prepare('INSERT INTO activities VALUES (?,?,?,?,?,?,?,?)'); add.run('a', 'coros', '2026-07-26', 'Run', 'Race', null, 9980, 3661); add.run('b', 'coros', '2026-09-13', 'Run', 'Race2', null, 10250, 3681); add.run('c', 'coros', '2025-12-07', 'Run', 'Slow', null, 10140, 4364); add.run('d', 'strava', '2026-01-01', 'Run', 'twin', null, 10000, 3000); add.run('e', 'coros', '2026-02-01', 'Run', 'long', null, 21000, 9000)
  const idb = new DatabaseSync(':memory:'); idb.exec('CREATE TABLE fit_session (date TEXT, distance_m REAL, km TEXT)')
  idb.prepare('INSERT INTO fit_session VALUES (?,?,?)').run('2026-09-13', 10250, JSON.stringify(Array.from({ length: 11 }, (_, i) => ({ km: i + 1, pace: i === 0 ? 400 : 355 }))))
  const r = rankBlock(app, idb, 'sebutkan 10k tercepat saya sepanjang waktu', [{ date: '2026-07-26', name: 'H&S 10K — net 1:00:55 (10K PB, official)' }, { date: '2026-05-24', name: 'Starbucks 5K' }])[0]
  assert.deepEqual(r.whole_runs.map((x) => x.date), ['2026-09-13', '2026-07-26', '2025-12-07']) // Strava twin and the 21 km run are excluded
  assert.equal(r.best_inside_runs[0].time, '0:59:10'); assert.equal(r.best_inside_runs[0].from_km, 2); assert.deepEqual(r.official_races, ['2026-07-26 H&S 10K — net 1:00:55 (10K PB, official)'])
  assert.equal(r.pb.official.time, '1:00:55'); assert.equal(r.pb.watch.time, '0:59:55'); assert.match(r.pb.note, /BOTH/)
  assert.deepEqual(rankBlock(app, idb, 'half marathon tercepat', [{ date: '1', name: 'LPS Half Marathon' }, { date: '2', name: 'Jakim (FM)' }, { date: '3', name: 'Borobudur Marathon (FM)' }])[0].official_races, ['1 LPS Half Marathon']); assert.deepEqual(rankBlock(app, idb, 'marathon tercepat', [{ date: '1', name: 'LPS Half Marathon' }, { date: '2', name: 'Jakim (FM)' }])[0].official_races, ['1 LPS Half Marathon', '2 Jakim (FM)'].slice(1)); assert.deepEqual(rankBlock(app, idb, 'ceritakan lari saya', []), []); assert.equal(distanceOf('half marathon tercepat'), 21.0975); assert.equal(rankBlock(app, idb, 'lari terpanjang saya', [])[0].runs[0].watch_km, 21)
})

test('expandTerms: "back to back" and "survive" reach the vocabulary the notes use, without generic filler words', () => {
  const e = expandTerms('How to survive back to back FM from Jakim to MJM')
  for (const w of ['back-to-back', 'brick', 'beruntun', 'cut-off', 'finish']) assert.ok(e.includes(w), w)
  for (const w of ['back', 'day', 'after']) assert.ok(!e.includes(w), 'generic: ' + w)
})

import { backToBack } from './recall.js'
test('backToBack finds consecutive-day efforts only for back-to-back questions', () => {
  const idb = new DatabaseSync(':memory:'); idb.exec('CREATE TABLE fit_session (date TEXT, distance_m REAL, run_share REAL, run_hr REAL, onset_km REAL)')
  const a = idb.prepare('INSERT INTO fit_session VALUES (?,?,?,?,?)'); a.run('2026-10-24', 21600, 0.74, 161, 5); a.run('2026-10-25', 9200, 0.94, 167, 5); a.run('2026-10-27', 20000, 0.8, 150, 9); a.run('2026-10-29', 9000, 0.9, 150, 9)
  const r = backToBack(idb, 'how to survive back to back FM')[0]
  assert.equal(r.pairs.length, 1); assert.equal(r.pairs[0].day1.date, '2026-10-24'); assert.equal(r.pairs[0].day2.km, 9.2)
  assert.deepEqual(backToBack(idb, 'my longest run'), [])
})

import { athleteContextBlock } from './recall.js'
test('athleteContextBlock: the athlete\'s own words, with the rule for reading them; empty when there are none', () => {
  const m = new DatabaseSync(':memory:'); m.exec('CREATE TABLE session_context (id INTEGER PRIMARY KEY, date TEXT, purpose TEXT, note TEXT, intentional_walking INTEGER, counts_for_fitness INTEGER, run_km REAL, walk_km REAL, km_from REAL, km_to REAL, kind TEXT)')
  m.prepare('INSERT INTO session_context VALUES (1,?,?,?,1,0,8,3,NULL,NULL,NULL)').run('2026-11-22', 'social_walk', 'ran 8 km and walked 3 km with partner'); m.prepare('INSERT INTO session_context VALUES (2,?,?,?,1,1,NULL,NULL,9,12,?)').run('2026-11-22', 'social_walk', 'walked with partner', 'walk')
  const b = athleteContextBlock(m, { dates: ['2026-11-22'], today: '2026-11-23' })[0]
  assert.equal(b.sessions.length, 2); assert.equal(b.sessions[1].km, '9–12'); assert.equal(b.sessions[1].found, 'walk'); assert.equal(b.sessions[0].counts_for_fitness, false); assert.equal(b.sessions[0].walking_by_choice, true); assert.match(b.how_to_read, /NOT fatigue/)
  assert.deepEqual(athleteContextBlock(m, { dates: ['2026-01-01'], from: '2026-01-01', to: '2026-01-02', today: '2026-11-23' }), [])
})

import { goalGapBlock } from './recall.js'
test('goalGapBlock gives the actual scenario odds, pace and VDOT gap, only for goal questions', () => {
  const state = { projection: { vdot0: 31.7, months_to_race: 11, required_gain_per_month: { 'ratio 0.95': 0.74 }, label: '[MODEL]', scenarios: [{ name: 'observed', gain_per_month: 0.6, ratio: [0.7, 0.9, 0.97], fm_time_p10_p50_p90: [14693, 16190, 18042], p_sub4: 0.057 }, { name: 'plan', gain_per_month: 1.02, ratio: [0.9, 0.95, 0.98], fm_time_p10_p50_p90: [12694, 13620, 14656], p_sub4: 0.832 }] } }
  const g = goalGapBlock('Bagaimana panduan mencapai sub 4 pada JRF 2027', state, { goal: 'Sub-4:00 FM', mp: '5:41', vdotNeeded: 39.9, baseline: 31.7 })[0]
  assert.equal(g.required.vdot_gap, 8.2); assert.equal(g.required.marathon_pace_per_km, '5:41'); assert.deepEqual(g.scenarios.map((x) => x.chance_of_sub4_percent), [5.7, 83.2]); assert.equal(g.scenarios[0].median_finish, '4:29:50')
  assert.deepEqual(goalGapBlock('apa kabar hari ini', state, { goal: 'x' }), []); assert.deepEqual(goalGapBlock('chance of sub 4', {}, { goal: 'x' }), [])
  assert.equal(goalGapBlock('what is my chance at JRF', state, { goal: 'x', mp: '5:41', vdotNeeded: 39.9 }).length, 1)
})
