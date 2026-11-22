import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
process.env.INTEL_DB = ':memory:'; process.env.MEMORY_DB = ':memory:'; process.env.DATA_DIR = fs.mkdtempSync((await import('node:path')).join((await import('node:os')).tmpdir(), 'lumpad-adv-'))
const { mdb, idb } = await import('./db.js'), A = await import('./advice.js'), { db: app } = await import('../store.js'), { cleanTarget } = await import('./schema.js')
const ASOF = '2026-11-22'
const act = (date, km, hr, min = 60) => app.prepare("INSERT INTO activities (id, source, source_id, date, sport, distance_m, duration_s, avg_hr, pulled_at) VALUES (?,?,?,?,?,?,?,?,?)").run('coros:' + date + km, 'coros', date + km, date, 'Run', km * 1000, min * 60, hr, 'x')

test('reading advice: distance, heart-rate limit, day and kind come from the text when the model left them out', () => {
  assert.deepEqual(A.inferTarget('Run 8 km easy tomorrow at dawn, heart rate under 148', ASOF), { km: 8, hr_cap_bpm: 148, for_date: '2026-11-23', kind: 'session' })
  assert.equal(A.inferTarget('Take a rest day tomorrow', ASOF).kind, 'rest'); assert.equal(A.inferTarget('Take a rest day tomorrow', ASOF).for_date, '2026-11-23')
  assert.deepEqual(A.inferTarget('Keep your heart rate below 150 on easy runs', ASOF), { hr_cap_bpm: 150, kind: 'cap' })
  assert.equal(A.inferTarget('Saturday long run of 22 km', ASOF).for_date, '2026-11-28'); assert.equal(A.inferTarget('Lari 6 km santai besok', ASOF).for_date, '2026-11-23')
  assert.equal(A.inferTarget('Drink to thirst and eat carbs tonight', ASOF).kind, 'fuel')
  assert.equal(A.inferTarget('Run 5 km', ASOF, { for_date: '2026-12-01', km: 7 }).km, 7)   // the answer's own target wins
})
test('target cleaning keeps only well-formed fields', () => {
  assert.deepEqual(cleanTarget({ for_date: '2026-11-23', kind: 'Session', km: '8,5', hr_cap_bpm: '148', junk: 1 }), { for_date: '2026-11-23', kind: 'session', km: 8.5, hr_cap_bpm: 148 })
  assert.deepEqual(cleanTarget({ for_date: 'tomorrow', kind: 'weird', km: -3, hr_cap_bpm: 20 }), { kind: 'other' }); assert.equal(cleanTarget('x'), undefined); assert.equal(cleanTarget({}), undefined)
})
test('judging: followed / partly / not followed for sessions, caps and rest days', () => {
  const s = { kind: 'session', km: 8, hr_cap_bpm: 148 }
  assert.equal(A.judge(s, { runs: 1, km: 8.2, avg_hr: 146 }), 'followed'); assert.equal(A.judge(s, { runs: 1, km: 7.9, avg_hr: 155 }), 'partly')
  assert.equal(A.judge(s, { runs: 1, km: 11.2, avg_hr: 146 }), 'partly'); assert.equal(A.judge(s, { runs: 1, km: 8, avg_hr: 162 }), 'not_followed')
  assert.equal(A.judge(s, { runs: 0, km: 0, avg_hr: null }), 'not_followed'); assert.equal(A.judge(s, { runs: 1, km: 3, avg_hr: 140 }), 'not_followed')
  assert.equal(A.judge({ kind: 'cap', hr_cap_bpm: 148 }, { runs: 1, km: 5, avg_hr: 149 }), 'followed'); assert.equal(A.judge({ kind: 'cap', hr_cap_bpm: 148 }, { runs: 0, km: 0 }), 'void')
  assert.equal(A.judge({ kind: 'rest' }, { runs: 0, km: 0 }), 'followed'); assert.equal(A.judge({ kind: 'rest' }, { runs: 1, km: 2, avg_hr: 120 }), 'partly'); assert.equal(A.judge({ kind: 'rest' }, { runs: 1, km: 9 }), 'not_followed')
  assert.equal(A.judge({ kind: 'fuel' }, { runs: 1, km: 9 }), 'void')
})
test('ledger: recorded once per run, open until the day has evidence, then resolved; a hand-set status is never overwritten', () => {
  const run = Number(mdb.prepare("INSERT INTO coach_run (created_at, intent, provider, ok) VALUES ('2026-11-22T08:00:00Z','daily_brief','deepseek',1)").run().lastInsertRowid)
  const parsed = { recommendations: [{ action: 'Run 8 km easy tomorrow, heart rate under 148', why: 'w', priority: 'now' }, { action: 'Take a rest day on Wednesday', why: 'w', priority: 'later' }, { action: 'Think about your goals', why: 'w', priority: 'later' }] }
  assert.equal(A.recordAdvice(run, parsed, { asOf: ASOF }), 3); assert.equal(A.recordAdvice(run, parsed, { asOf: ASOF }), 0)   // idempotent
  assert.deepEqual(mdb.prepare('SELECT idx, kind, status, for_date FROM coach_advice ORDER BY idx').all().map((r) => [r.kind, r.status, r.for_date]), [['session', 'open', '2026-11-23'], ['rest', 'open', '2026-11-25'], ['other', 'unknown', null]])
  assert.deepEqual(A.resolveAdvice('2026-11-23'), { resolved: 0, open: 1 })   // the day has started, no run yet: open
  act('2026-11-23', 7.9, 155); A.resolveAdvice('2026-11-23')
  const r = mdb.prepare("SELECT status, evidence FROM coach_advice WHERE idx=0").get(); assert.equal(r.status, 'partly'); assert.equal(JSON.parse(r.evidence).km, 7.9); assert.equal(JSON.parse(r.evidence).avg_hr, 155)
  A.setStatus(mdb.prepare("SELECT id FROM coach_advice WHERE idx=0").get().id, 'followed'); A.resolveAdvice('2026-11-24')
  assert.equal(mdb.prepare("SELECT status, manual FROM coach_advice WHERE idx=0").get().status, 'followed')   // the athlete's word stands
  assert.throws(() => A.setStatus(999, 'followed'), /not found/); assert.throws(() => A.setStatus(1, 'maybe'), /bad status/)
})
test('rest day: broken as soon as a run happens; kept only once the day is over; FIT run heart rate is preferred over the watch average', () => {
  const run = Number(mdb.prepare("INSERT INTO coach_run (created_at, intent, provider, ok) VALUES ('2026-11-24T08:00:00Z','daily_brief','deepseek',1)").run().lastInsertRowid)
  A.recordAdvice(run, { recommendations: [{ action: 'Take a rest day tomorrow', why: 'w', priority: 'now' }] }, { asOf: '2026-11-25' })   // for 2026-11-26
  A.resolveAdvice('2026-11-26'); assert.equal(mdb.prepare("SELECT status FROM coach_advice WHERE run_id=? AND idx=0").get(run).status, 'open')   // no run yet and the day is not over: still open
  act('2026-11-26', 10, 150); A.resolveAdvice('2026-11-26')
  assert.equal(mdb.prepare("SELECT status FROM coach_advice WHERE run_id=? AND idx=0").get(run).status, 'not_followed')   // he ran: already broken
  const run2 = Number(mdb.prepare("INSERT INTO coach_run (created_at, intent, provider, ok) VALUES ('2026-11-27T08:00:00Z','daily_brief','deepseek',1)").run().lastInsertRowid)
  A.recordAdvice(run2, { recommendations: [{ action: 'Take a rest day tomorrow', why: 'w', priority: 'now' }] }, { asOf: '2026-11-28' })   // for 2026-11-29, nothing done
  A.resolveAdvice('2026-11-29'); assert.equal(mdb.prepare("SELECT status FROM coach_advice WHERE run_id=? AND idx=0").get(run2).status, 'open'); A.resolveAdvice('2026-11-30')
  assert.equal(mdb.prepare("SELECT status FROM coach_advice WHERE run_id=? AND idx=0").get(run2).status, 'followed')   // the day passed without a run
  idb.prepare("INSERT INTO fit_session (label_id, date, parser_version, run_hr, distance_m, metrics, km, processed_at) VALUES ('L','2026-11-26',1,141,10000,'{}','[]','x')").run()
  assert.equal(A.actualsOn('2026-11-26').avg_hr, 141); assert.equal(A.actualsOn('2026-11-26').hr_source, 'fit')
})
test('the loop closes: repeated misses become a memory CANDIDATE with the real counts, and it is archived when the pattern is gone', () => {
  for (let i = 0; i < 5; i++) { const d = `2026-11-${10 + i}`, run = Number(mdb.prepare("INSERT INTO coach_run (created_at, intent, provider, ok) VALUES (?,?,?,1)").run(d + 'T08:00:00Z', 'daily_brief', 'deepseek').lastInsertRowid)
    mdb.prepare('INSERT INTO coach_advice (run_id, idx, created_at, for_date, kind, text, target, status, evidence) VALUES (?,?,?,?,?,?,?,?,?)').run(run, 9, 'x', d, 'cap', 'Keep HR under 148', '{"kind":"cap","hr_cap_bpm":148}', i === 0 ? 'followed' : 'not_followed', '{}') }
  const made = A.adherenceMemory('2026-11-20'); assert.equal(made.length >= 1, true)
  const m = mdb.prepare("SELECT title, body, status, source FROM memory WHERE source='ledger' AND source_ref='adherence:cap'").get()
  assert.equal(m.status, 'candidate'); assert.match(m.body, /5 checkable instructions.*1 were followed, 0 partly and 4 not/)
  mdb.prepare("UPDATE coach_advice SET status='followed' WHERE kind='cap'").run(); A.adherenceMemory('2026-11-20')
  assert.equal(mdb.prepare("SELECT status FROM memory WHERE source='ledger' AND source_ref='adherence:cap'").get().status, 'archived')
})

test('real sentences from the first backfill: "rest of today" is not a rest day; "no second run" is; durations and "or rest" are read correctly', () => {
  assert.equal(A.inferTarget('Fuel and rehydrate properly for the rest of today and aim for a long night of sleep', ASOF).kind, 'fuel')
  assert.equal(A.inferTarget('Rest of today: no second run and no gym session; fluids with salt', ASOF).kind, 'rest')
  const d = A.inferTarget('Run 30–40 min easy today (or rest if sleep is the limiter)', ASOF); assert.deepEqual([d.kind, d.min, d.alt_rest, d.for_date], ['session', 35, true, ASOF])
  assert.equal(A.inferTarget('Take a full rest day on Wednesday', ASOF).kind, 'rest')
  assert.equal(A.judge(d, { runs: 0, km: 0, minutes: 0 }), 'void'); assert.equal(A.judge(d, { runs: 1, km: 5, minutes: 36, avg_hr: 140 }), 'followed'); assert.equal(A.judge(d, { runs: 1, km: 12, minutes: 110, avg_hr: 140 }), 'not_followed')
})
test('advice written AFTER a morning run is judged only by what happens after it', () => {
  const day = '2026-12-05', run = Number(mdb.prepare("INSERT INTO coach_run (created_at, intent, provider, ok) VALUES (?,?,?,1)").run('2026-12-05T08:30:00Z', 'daily_brief', 'deepseek').lastInsertRowid)   // 15:30 WIB
  app.prepare("INSERT INTO activities (id, source, source_id, date, sport, distance_m, duration_s, avg_hr, start_ts, pulled_at) VALUES ('coros:am','coros','am',?,'Run',11000,5400,150,?,'x')").run(day, Math.floor(Date.parse('2026-12-04T22:00:00Z') / 1000))   // 05:00 WIB, before the advice
  A.recordAdvice(run, { recommendations: [{ action: 'No second run today; fluids and sleep', why: 'w', priority: 'now' }] }, { asOf: day })
  A.resolveAdvice('2026-12-06'); assert.equal(mdb.prepare('SELECT status FROM coach_advice WHERE run_id=?').get(run).status, 'followed')   // the morning run does not count against it
})
