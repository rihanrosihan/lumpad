import test from 'node:test'
import assert from 'node:assert/strict'
import { scoreAnswer, countNumbers, summarize, JARGON } from './quality.js'

const good = { summary: "You can run tomorrow, but keep it easy: 8 km with your heart rate under 148. Today's run was hard work in the heat, so the week is catching up with you.",
  analysis_md: "## How you are today\nYour sleep and recovery are fine, but today's run cost a lot in the heat.\n\n## What I would do\nRun 8 km easy tomorrow, heart rate under 148, walk when it climbs.\n\n## Keep an eye on\n- Any pain of 2 out of 10 means shorten the run.",
  recommendations: [{ action: 'Run 8 km easy tomorrow, heart rate under 148', why: 'Your legs need an easy day after today.' }], flags: [], grounding: { unverified: [], bad_ids: [] } }
const bad = { summary: 'TSB -30.3 with CTL 76.1 and ATL 106.4; EF 1.52, GCT +12 ms, Pa:HR 6.2 %, WBGT 30.4, HR@8:00 160.9 (z=3.6, n=3). ' + 'x'.repeat(300),
  analysis_md: '## Twin snapshot\n' + Array.from({ length: 20 }, (_, i) => `Metric ${i}: ${i * 3.1}`).join('\n'), recommendations: [{ action: 'Monitor the situation', why: 'because' }], flags: [], grounding: { unverified: ['138.2'], bad_ids: [512] } }

test('a plain-language answer in the coach voice passes every check', () => { const q = scoreAnswer(good, { intent: 'daily_brief' }); assert.deepEqual(q.failed, []); assert.equal(q.pass, true); assert.equal(q.score, 1) })
test('a jargon-and-numbers answer fails the voice, structure, actionability and grounding checks', () => {
  const q = scoreAnswer(bad, { intent: 'daily_brief' })
  for (const c of ['plain_words', 'summary_numbers', 'analysis_numbers', 'summary_length', 'structure', 'actionable', 'grounded']) assert.ok(q.failed.includes(c), c + ' should fail: ' + JSON.stringify(q.checks[c]))
  assert.equal(q.pass, false); assert.ok(q.checks.plain_words.value.includes('TSB'))
})
test('numbers: dates, citations, headings and list numbers are not counted; distances and limits are', () => {
  assert.equal(countNumbers('On 2026-11-22 run 8 km under 148 [12]\n## 3. Plan\n1. Easy'), 2); assert.equal(countNumbers('pace 6:30 per km'), 1)
})
test('language: an Indonesian answer passes for id and fails for en; an English answer the reverse', () => {
  const id = { ...good, summary: 'Kamu bisa lari besok, tapi santai saja: 8 km dengan detak jantung di bawah 148, karena lari hari ini berat dan kamu perlu istirahat.',
    analysis_md: '## How you are today\nTidur kamu bagus, tapi lari hari ini berat karena panas dan kamu perlu istirahat.\n\n## What I would do\nLari 8 km santai besok dengan detak jantung di bawah 148, dan jalan kaki kalau naik.', recommendations: [{ action: 'Lari 8 km santai besok', why: 'Kaki kamu perlu hari yang ringan dan tidak terlalu berat.' }] }
  assert.equal(scoreAnswer(id, { intent: 'daily_brief', lang: 'id' }).checks.language.pass, true); assert.equal(scoreAnswer(id, { intent: 'daily_brief', lang: 'en' }).checks.language.pass, false)
  assert.equal(scoreAnswer(good, { intent: 'daily_brief', lang: 'id' }).checks.language.pass, false); assert.equal(scoreAnswer(good, { intent: 'daily_brief', lang: 'en' }).checks.language.pass, true)
})
test('summarize: pass rate per check and per intent', () => {
  const rows = [{ intent: 'daily_brief', quality: scoreAnswer(good, { intent: 'daily_brief' }) }, { intent: 'daily_brief', quality: scoreAnswer(bad, { intent: 'daily_brief' }) }]
  const s = summarize(rows); assert.equal(s.daily_brief.n, 2); assert.equal(s.daily_brief.pass, 1); assert.equal(s.daily_brief.checks.plain_words.pass, 1); assert.ok(JARGON.length > 10)
})
