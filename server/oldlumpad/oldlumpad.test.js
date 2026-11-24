import test from 'node:test'
import assert from 'node:assert/strict'
import { classify, textual } from './classify.js'
import { redactX, leaks } from './redact.js'
import { verify, chunkText, norm, extractable } from './extract.js'
import { csv } from './parse.js'
import { parseVerdicts, jaccard, ftsQuery, words } from './judge.js'
import { docDate, clampHorizon } from './stage.js'
import { openDb } from './db.js'

test('classifier: keep / transform / skip and quarantine classes', () => {
  assert.equal(classify('training/context-enrichment/2026-07-08-run-context-enrichment.md').decision, 'keep')
  assert.equal(classify('races/race-history.md').rule, 'K4')
  assert.equal(classify('races/events/2026-jakim/analysis/bib-1/data/stop_segments.csv').rule, 'T2')
  assert.equal(classify('races/events/2026-jakim/analysis/bib-1/data/strava_stream_1s.csv').decision, 'skip')
  assert.equal(classify('races/events/2026-jakim/results/jakim-2026-day2.sqlite').rule, 'T7')
  assert.equal(classify('races/events/2026-jakim/results/participants.csv').sensitivity, 'S3')
  assert.equal(classify('archive/deprecated/legacy_scripts/ingest_garmin_full.py').sensitivity, 'S4')
  assert.equal(classify('exports/running-workspace-context.md').sensitivity, 'S4')
  assert.equal(classify('references/ai_conversation_history.md').decision, 'skip')
  assert.equal(textual(classify('races/events/2026-jakim/results/jakim-2026-day2.sqlite')), false)   // aggregates only, never read as text
  assert.equal(textual(classify('health/injuries/injury-log.md')), true)
})
test('redactor: clinicians, clinics, areas, birth date, connection strings and e-mail never survive (fake values)', () => {
  const t = redactX('Dr. Test Person, Sp.KO at Brawijaya Hospital - Taman Mini; Bebas Cedera Jatibening; Rihan Rosihan at Pizza Hut Indonesia born January 19, 1995 postgresql://u:pw@h/db mail a.b@example.com')
  assert.deepEqual(leaks(t), []); for (const w of ['Test Person', 'Brawijaya', 'Jatibening', 'Taman Mini', '1995', 'postgresql', 'example.com', 'Rosihan', 'Pizza']) assert.ok(!t.includes(w), w)
  assert.match(t, /sports-medicine physician/)
})
test('verify(): a claim survives only with a verbatim quote; dates are bounded by the horizon; health text is S2', () => {
  const chunk = { chunk_id: 'c1', doc_id: 'd1', text: 'On 2025-10-25 the JRF half marathon: diarrhea began on Wednesday (H-3), 21.66 km in 3:05:34.' }
  const r = verify({ claims: [
    { kind: 'episode', title: 'JRF 2025 GI illness', body: 'Diarrhea began 3 days before the race.', quote: 'diarrhea began on Wednesday (H-3)', event_date: '2025-10-25', subject: 'JRF HM 2025', sensitivity: 'S0', confidence: 0.9 },
    { kind: 'fact', title: 'invented', body: 'x', quote: 'never said this', confidence: 0.9 },
    { kind: 'fact', title: 'future', body: 'a thing', quote: '21.66 km in 3:05:34', event_date: '2026-12-01' }] },
  { chunk, docDate: '2026-05-17', docSens: 'S0', pass: 'p1', model: 'm' })
  assert.equal(r.claims.length, 2); assert.equal(r.dropped['quote-not-in-text'], 1)
  assert.equal(r.claims[0].sensitivity, 'S2'); assert.equal(r.claims[0].valid_to, '2025-10-25')
  assert.equal(r.claims[1].event_date, null); assert.equal(r.claims[1].valid_to, '2026-05-17')   // an out-of-horizon event date falls back to the document date
  assert.ok(r.claims.every((c) => c.valid_to <= '2026-08-12'))
})
test('chunker splits at headings and never exceeds ~1.5x the size', () => {
  const body = '# A\n' + 'x'.repeat(100) + '\n## B\n' + ('para one. '.repeat(40) + '\n\n').repeat(8)
  const c = chunkText(body, 300); assert.ok(c.length >= 3); assert.ok(c.every((x) => x.length <= 450))
})
test('csv parser handles quotes, commas and CRLF', () => {
  const r = csv('time,km,reason\r\n05:06,7.2,"urination, brief"\r\n07:02,20.68,"met ""family"""\r\n')
  assert.equal(r.length, 2); assert.equal(r[0].reason, 'urination, brief'); assert.equal(r[1].reason, 'met "family"')
})
test('judge: verdicts must reference shown ids; unknown or invalid verdicts are ignored', () => {
  const batch = [{ claim: { claim_id: 'a' }, cands: [{ id: 5 }, { id: 6 }] }, { claim: { claim_id: 'b' }, cands: [{ id: 9 }] }]
  const m = parseVerdicts({ verdicts: [{ id: 'a', verdict: 'duplicate', matched: 5, note: 'same' }, { id: 'a', verdict: 'new' }, { id: 'b', verdict: 'refines', matched: 77 }, { id: 'zzz', verdict: 'new' }, { id: 'b', verdict: 'bogus' }] }, batch)
  assert.equal(m.size, 2); assert.equal(m.get('a').novelty, 'duplicate'); assert.equal(m.get('b').novelty, 'new')   // refines pointing at an id it was not shown -> new
  assert.ok(jaccard(words('JRF half marathon 2025 diarrhea'), words('diarrhea at JRF half marathon')) > 0.5)
  assert.ok(ftsQuery('Jakim 2026 marathon 6:53:03 plantar').includes('"6:53:03"'))
})
test('doc dates: filename date, then "Last updated", clamped to the horizon', () => {
  assert.equal(docDate('obsidian/Decisions/Decision-2026-06-24.md', '', '2026-01-01'), '2026-06-24')
  assert.equal(docDate('x.md', '*Last updated: May 17, 2026*', '2026-01-01'), '2026-05-17')
  assert.equal(clampHorizon('2026-11-24'), '2026-08-12')
})
test('staging db is created in memory under test and is idempotent', () => { const d = openDb(':memory:'); d.exec("INSERT INTO ol_kv VALUES ('a','1')"); assert.equal(d.prepare('SELECT count(*) c FROM ol_kv').get().c, 1); assert.ok(typeof norm('A *b*') === 'string'); assert.equal(extractable({ rule_id: 'K1', entry: 'a/b.md' }), true); assert.equal(extractable({ rule_id: 'T6', entry: 'a/b.md' }), false) })

import { DatabaseSync } from 'node:sqlite'
import { toMemory, toSessionContext } from './promote.js'
import { deterministic, numbersOf, parseReviews, needsReview, windowAround } from './qa.js'
import { plan as graphPlan, stopClass, clean } from './graph.js'
import { historyLane } from './lane.js'

const claim = (o = {}) => ({ claim_id: 'c1', doc_id: 'ol/x.md', chunk_id: 'k', quote: 'diarrhea began on Wednesday (H-3)', title: 'JRF 2025 GI illness', text: 'Diarrhea began 3 days before the race.', kind: 'episode', event_date: '2025-10-25',
  valid_from: '2025-10-25', valid_to: '2025-10-25', subject_key: 'JRF HM 2025', sensitivity: 'S2', models: '["m"]', confidence: 0.9, novelty: 'new', matched_memory_id: null, judge_note: '', qa_status: 'pass', ...o })
test('promotion mapping: EVERYTHING is archived (both engines merge into candidate/proposal rows), always bounded, role kept in the kind', () => {
  const doc = { rule_id: 'K4', doc_date: '2026-05-17' }, m = (o) => toMemory(claim(o), { doc, batch: 'b' })
  assert.deepEqual([m().tier, m().kind, m().status], ['episodic', 'old_episode', 'archived'])
  assert.deepEqual([m({ kind: 'hypothesis', sensitivity: 'S0', title: 'x', text: 'y' }).kind, m({ kind: 'hypothesis', sensitivity: 'S0', title: 'x', text: 'y' }).evidence_tag], ['old_hypothesis', 'HYPOTHESIS'])
  assert.deepEqual([m({ kind: 'rule', title: 'r', text: 't', sensitivity: 'S0' }).tier, m({ kind: 'rule', title: 'r', text: 't', sensitivity: 'S0' }).kind], ['procedural', 'old_rule'])
  assert.equal(m({ novelty: 'contradicts', matched_memory_id: 7 }).kind, 'old_conflict')
  assert.equal(m({ novelty: 'duplicate' }), null); assert.equal(m({ qa_status: 'needs_human' }), null); assert.equal(m({ valid_to: '2026-09-01' }), null)
  for (const k of ['episode', 'lesson', 'fact', 'rule', 'hypothesis', 'plan', 'decision', 'constraint']) { const r = m({ kind: k, sensitivity: 'S0', title: 't', text: 'u' }); assert.equal(r.status, 'archived'); assert.ok(r.valid_to <= '2026-08-12'); assert.equal(r.source, 'old_lumpad'); assert.equal(r.source_ref, 'old:c1'); assert.ok(r.kind.startsWith('old_')) }
  assert.match(m().title, /^\[old notes 2025-10-25\]/)
})
test('session_context mapping redacts and carries no clinician names', () => {
  const s = toSessionContext({ kind: 'run_context', event_date: '2026-06-24', label_id: 'L1', event_id: 'e', payload: JSON.stringify({ activity: '7.5 km easy run', score_updated: 93, reason: 'saw Dr. Test Person, plantar spike at km 5.6' }) })
  assert.equal(s.label, 'L1'); assert.ok(!s.note.includes('Test Person')); assert.match(s.note, /plantar spike/)
})
test('QA: numbers must come from the source; horizon and review routing', () => {
  assert.deepEqual(numbersOf('21.66 km in 3:05:34 on day 3'), ['21.66', '3:05:34'])
  assert.equal(deterministic(claim({ text: 'It took 3:05:34.' }), 'a 3:05:34 finish').status, 'ok')
  assert.equal(deterministic(claim({ text: 'It took 3:15:34.', quote: 'x' }), 'a 3:05:34 finish').status, 'fail')
  assert.equal(deterministic(claim({ valid_to: '2026-10-01' }), diarrheaText()).status, 'fail')
  assert.equal(deterministic(claim({ text: 'On 2026-05-27 the run was 8 km.', valid_from: '2026-05-27', valid_to: '2026-05-27', event_date: '2026-05-27', quote: 'x' }), 'family run, 8 km').status, 'ok')   // ISO-date parts are not source numbers
  assert.ok(needsReview(claim())); assert.ok(needsReview(claim({ sensitivity: 'S0', kind: 'rule' })))
  const r = parseReviews({ reviews: [{ id: 'a', supported: 'yes', overreach: false, current_tense: false, advice: false }, { id: 'b', supported: 'yes', overreach: true }, { id: 'c', supported: 'no' }, { id: 'zzz', supported: 'yes' }] }, ['a', 'b', 'c'])
  assert.deepEqual([r.get('a').status, r.get('b').status, r.get('c').status, r.size], ['pass', 'needs_human', 'fail', 3])
})
const diarrheaText = () => 'diarrhea began on Wednesday (H-3)'
test('graph plan: sync-safe vocabulary only, S2 nodes carry no summary, stops are classified, km_index is a property', () => {
  const db = new DatabaseSync(':memory:'); db.exec(`CREATE TABLE ol_claim (claim_id,doc_id,chunk_id,quote,text,title,kind,event_date,valid_from,valid_to,subject_key,sensitivity,models,confidence,novelty,matched_memory_id,judge_note,qa_status,promoted_memory_id,batch_id);
    CREATE TABLE ol_doc (doc_id, doc_date); CREATE TABLE ol_event (event_id, kind, event_date, label_id, payload, doc_id, batch_id); CREATE TABLE ol_field_stat (event, scope, band, metric, value, n);`)
  db.prepare("INSERT INTO ol_doc VALUES ('ol/x.md','2026-05-17')").run()
  const ins = db.prepare("INSERT INTO ol_claim VALUES (?,'ol/x.md','k','q',?,?,?,?,?,?,?,?,'[]',0.9,?,?,'', 'pass', 5, 'b')")
  ins.run('c1', 'Diarrhea began 3 days before the race.', 'JRF 2025 GI illness', 'episode', '2025-10-25', '2025-10-25', '2025-10-25', 'JRF HM 2025', 'S2', 'new', null)
  ins.run('c2', 'Started the half marathon too fast.', 'LPS HM pacing error', 'episode', '2025-06-15', '2025-06-15', '2025-06-15', 'LPS HM 2025', 'S0', 'refines', 9)
  db.prepare("INSERT INTO ol_event VALUES ('s1','jakim_stop_labelled','2026-06-14','L','{\"time\":\"05:06:02-05:06:43\",\"km\":\"7.2\",\"duration_s\":\"42\",\"reason\":\"urination\"}','d',NULL)").run()
  const P = graphPlan({ db, races: [{ race_id: 'jrf-hm-2025', date: '2025-10-25' }, { race_id: 'lps-hm-2025', date: '2025-06-15' }, { race_id: 'jakim-fm-2026', date: '2026-06-14' }], sessionsByDate: new Map([['2025-10-25', ['S1']]]) })
  const e1 = P.episodes.find((e) => e.id === 'olx:c1'), e2 = P.episodes.find((e) => e.id === 'olx:c2')
  assert.equal(e1.props.summary, null); assert.equal(e1.props.kind, 'illness'); assert.ok(e2.props.summary); assert.equal(e2.props.kind, 'race_reflection')
  assert.ok(P.links.some((l) => l.id === 'olx:c1' && l.to === 'Race' && l.key === 'jrf-hm-2025')); assert.ok(P.links.some((l) => l.id === 'olx:c1' && l.to === 'Session' && l.key === 'S1'))
  assert.deepEqual(P.memLinks, [{ id: 'olx:c2', mid: 9, rel: 'REFINES_MEMORY' }])
  assert.equal(P.stops[0].props.class, 'toilet'); assert.equal(P.stops[0].props.km_index, 8); assert.equal(P.stops[0].race_id, 'jakim-fm-2026'); assert.equal(stopClass('met wife and child; carried child'), 'family')
  const src = ['ABOUT', 'PRECEDED', 'CONTRADICTS', 'RELATED_TO', 'SIMILAR_TO', 'IN_BAND', 'COMPARED_TO'], used = JSON.stringify(Object.values(Q_USED()))
  for (const bad of src) assert.ok(!new RegExp(`\\[l?:${bad}\\b`).test(used), bad + ' is deleted by the Go sync')
  assert.ok(clean([{ props: { a: 1, b: null, c: undefined } }])[0].props.b === undefined)
})
import * as G from './graph.js'
import fs from 'node:fs'
const Q_USED = () => [fs.readFileSync(new URL('./graph.js', import.meta.url), 'utf8').split('const Q = {')[1].split('export async function snapshot')[0]]
test('history lane: nothing for current intents, nothing without rows, labelled notes for retrospective questions', () => {
  const m = new DatabaseSync(':memory:'); m.exec("CREATE TABLE memory (id INTEGER PRIMARY KEY, tier, kind, evidence_tag, valid_from, title, body, source, status); CREATE VIRTUAL TABLE memory_fts USING fts5(title, body, content='memory', content_rowid='id');")
  assert.deepEqual(historyLane({ mdb: m, question: 'what happened at JRF 2025', retroQ: true }), [])
  m.prepare("INSERT INTO memory VALUES (1,'episodic','old_episode','REPORTED','2025-10-25','[old] JRF GI','Diarrhea began 3 days before JRF half marathon','old_lumpad','archived')").run()
  m.exec("INSERT INTO memory_fts(rowid,title,body) SELECT id,title,body FROM memory")
  assert.deepEqual(historyLane({ mdb: m, question: 'what happened at JRF 2025', retroQ: false }), [])
  assert.deepEqual(historyLane({ mdb: m, question: 'what happened at JRF 2025', retroQ: true, intent: 'daily_brief' }), [])
  const r = historyLane({ mdb: m, question: 'what happened at JRF 2025', retroQ: true, filters: { race_dates: ['2025-10-25'] } })
  assert.equal(r.length, 1); assert.match(r[0].label, /never a current/)
})

test('QA window is centred on the quote, not cut from the head of the chunk', () => { const text = 'a'.repeat(5000) + ' THE QUOTE IS HERE ' + 'b'.repeat(900); const w = windowAround(text, 'THE QUOTE IS HERE'); assert.ok(w.includes('THE QUOTE IS HERE')); assert.ok(w.length <= 2800); assert.ok(windowAround('short', 'x').length === 5) })

test('write-back never merges a fresh coach finding into an old_lumpad row (re-observation would age a 2026-05 hypothesis into a current one)', () => { const src = fs.readFileSync(new URL('../intel/writeback.js', import.meta.url), 'utf8'); assert.match(src, /x\.source !== 'old_lumpad'/) })

test('history lane ranks the race day first and never offers old plans', () => {
  const m = new DatabaseSync(':memory:'); m.exec("CREATE TABLE memory (id INTEGER PRIMARY KEY, tier, kind, evidence_tag, valid_from, title, body, source, status); CREATE VIRTUAL TABLE memory_fts USING fts5(title, body, content='memory', content_rowid='id');")
  const ins = m.prepare("INSERT INTO memory VALUES (?,'episodic',?,'REPORTED',?,'t','b','old_lumpad','archived')"); ins.run(1, 'old_reflection', '2026-06-12'); ins.run(2, 'old_plan', '2026-06-14'); ins.run(3, 'old_episode', '2026-06-14'); ins.run(4, 'old_reflection', '2026-06-13')
  const r = historyLane({ mdb: m, question: 'x', retroQ: true, filters: { race_dates: ['2026-06-14'] } })
  assert.equal(r[0].date, '2026-06-14'); assert.ok(!r.some((x) => x.kind === 'old_plan')); assert.equal(r.length, 3)
})
