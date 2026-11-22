import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { SYS, TASKS, renderPromptPure } from './prompt.js'
const ctx = { stable: { athlete: { goal: 'g', facts: [] }, definitions: {}, rules: [{ id: 1, title: 'r', rule: 'x', locked: true }] }, volatile: { intent: 'daily_brief', as_of: '2026-11-22', query: {}, twin: {}, correlation_edges: [], episodes: [], facts: [], telemetry: [] } }
test('the coach voice is in every prompt: conclusion first, few numbers, no jargon, evidence kept out of the prose', () => {
  const { system } = renderPromptPure(ctx, TASKS.daily_brief, 'en')
  assert.ok(system.includes('COACH VOICE')); assert.match(system, /ONE overall judgement/); assert.match(system, /At most 3 in the summary and at most 6 in the whole analysis/)
  assert.match(system, /do not write TSB, CTL, ATL, ACWR, EF, GCT, Pa:HR/); assert.match(system, /exact figures, ids and metric names belong only in cited_ids/)
  assert.ok(!/Twin snapshot & anomaly check|exact deltas|Pod 2 biomechanics|keep metric names \(EF/.test(system), 'the old technical instructions are gone')
})
test('Indonesian: natural coach Bahasa with plain terms instead of English abbreviations', () => {
  const { system } = renderPromptPure(ctx, TASKS.daily_brief, 'id'); assert.match(system, /natural, warm Bahasa Indonesia/); assert.match(system, /kamu/); assert.ok(!system.includes('LANGUAGE: English'))
})
test('task texts ask for plain sections and a conclusion, not metric tables', () => {
  assert.match(TASKS.daily_brief, /## How you are today/); assert.match(TASKS.daily_brief, /## What I would do/); assert.match(TASKS.weekly_review, /verdict for next week in plain words/)
  for (const k of ['daily_brief', 'weekly_review', 'race_plan', 'question']) assert.ok(!/\b(TSB|CTL|ATL|GCT|Pa:HR)\b/.test(TASKS[k].replace(/form below -30/g, '')), k + ' must not ask for jargon')
})
test('the Go prompt text is generated from this file and is current (run: node tools/gen_go_prompt_text.mjs)', () => {
  const go = fs.readFileSync('lumpadd/internal/coach/prompt_text.go', 'utf8')
  for (const v of Object.values(SYS)) assert.ok(go.includes(v), 'Go copy is stale: ' + v.slice(0, 50))
})
