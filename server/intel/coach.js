// Orchestrates one coach run: context → provider → schema validation (+1 repair) → write-back → coach_run row.
import { mdb, idb } from './db.js'
import { retrieveRunnerContext, renderPrompt, TASKS, OUTPUT_SCHEMA } from './context.js'
import { validate, normalize as norm0, softClamp } from './schema.js'
const normalize = (j) => softClamp(norm0(j))
import { complete as deepseek } from './llm.js'
import * as claude from './anthropic.js'
import { applyWriteback } from './writeback.js'
import { audit } from './memory.js'
import { redFlags, checkinFlags, referralFor, gateFromTwin, gateCheck, diagnosisWording } from './safety.js'

const EFFORT = { daily_brief: 'low', question: 'high', session_review: 'high', weekly_review: 'high', race_plan: 'high' }
const now = () => new Date().toISOString()
// Per-intent routing. Off by default: set COACH_CLAUDE_INTENTS=race_plan,session_review (after the eval) to send those to Anthropic.
// An intent routed to Claude whose provider is not fully configured (key, model, prices) or is over its cap falls back to DeepSeek.
export function pickProvider(intent) {
  const want = (process.env.COACH_CLAUDE_INTENTS || '').split(',').map((x) => x.trim()).filter(Boolean)
  return want.includes(intent) && claude.configured().ok && claude.guard().ok ? 'anthropic' : 'deepseek'
}
export function newRun({ intent, provider, ctx, prompt, question }) {
  return Number(mdb.prepare('INSERT INTO coach_run (created_at, intent, provider, effort, question, context_ids, context_tokens, request, ok) VALUES (?,?,?,?,?,?,?,?,0)').run(now(), intent, provider, EFFORT[intent], question || null, JSON.stringify(ctx.item_ids), ctx.tokens_est, JSON.stringify(prompt)).lastInsertRowid)
}
export const corpusOf = (ctx) => JSON.stringify({ twin: ctx.volatile.twin, edges: ctx.volatile.correlation_edges, items: [...ctx.volatile.episodes, ...ctx.volatile.facts] })

// finalize a run given a parsed answer (used by DeepSeek and by the Claude Code CLI write-back)
export function finishRun(runId, parsed, { provider, usage = null, model = null, cost = null, raw = null } = {}) {
  const row = mdb.prepare('SELECT context_ids, request FROM coach_run WHERE id=?').get(runId), ids = JSON.parse(row.context_ids), req = JSON.parse(row.request)
  const errs = validate(parsed, OUTPUT_SCHEMA); if (errs.length) { mdb.prepare('UPDATE coach_run SET ok=0, error=?, response=?, model=? WHERE id=?').run('schema: ' + errs.slice(0, 5).join('; '), raw, model, runId); return { ok: false, errors: errs } }
  const wb = applyWriteback(parsed, { runId, itemIds: ids, corpus: req.user + '\n' + req.system, provider })
  mdb.prepare('UPDATE coach_run SET ok=1, response=?, parsed=?, usage=?, cost_cny=?, model=?, error=NULL WHERE id=?').run(raw, JSON.stringify({ ...parsed, _writeback: wb }), usage ? JSON.stringify(usage) : null, cost, model, runId)
  return { ok: true, parsed, writeback: wb }
}
export { normalize } from './schema.js'
// Safety pre-check: a reported red-flag symptom (in the question, or severe pain in the last two check-ins) gets a referral and NO model call.
function safetyPre(question) {
  const flags = redFlags(question), log = idb.prepare("SELECT pain FROM daily_log WHERE pain IS NOT NULL ORDER BY date DESC LIMIT 2").all()
  for (const l of log) { const w = Math.max(0, ...Object.values(JSON.parse(l.pain || '{}'))); flags.push(...checkinFlags({ pain: w })) }
  return [...new Map(flags.map((f) => [f.id, f])).values()]
}
export async function runCoach({ intent = 'daily_brief', question = '', date, activityId = null, fetchFn } = {}) {
  const red = safetyPre(question)
  if (red.length) {
    const parsed = referralFor(red), id = Number(mdb.prepare('INSERT INTO coach_run (created_at, intent, provider, effort, question, context_ids, context_tokens, request, response, parsed, model, cost_cny, ok) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1)')
      .run(now(), intent, 'safety', null, question || null, '[]', 0, JSON.stringify({ system: 'safety rules', user: '' }), JSON.stringify(parsed), JSON.stringify(parsed), 'safety-rules', 0).lastInsertRowid)
    audit('safety:referral', null, { ids: red.map((f) => f.id) }, id)
    return { runId: id, ok: true, parsed, model: 'safety-rules', cost_cny: 0, safety: true }
  }
  const ctx = retrieveRunnerContext({ intent, question, date, activityId }), prompt = renderPrompt(ctx, TASKS[intent] || TASKS.question), provider = pickProvider(intent), llm = provider === 'anthropic' ? claude.complete : deepseek, runId = newRun({ intent, provider, ctx, prompt, question })
  try {
    let r = await llm({ ...prompt, effort: EFFORT[intent], intent, fetchFn }), errs = r.json ? validate(normalize(r.json), OUTPUT_SCHEMA) : ['not valid JSON']
    if (errs.length) { // one repair attempt, with the validator's own message
      const msgs = [{ role: 'system', content: prompt.system }, { role: 'user', content: prompt.user }, { role: 'assistant', content: r.text.slice(0, 4000) }, { role: 'user', content: 'Your reply did not match the required JSON shape: ' + errs.slice(0, 6).join('; ') + '. Reply again with ONE corrected JSON object only.' }]
      const r2 = await llm({ messages: msgs, effort: 'low', intent, fetchFn }); r = { ...r2, cost_cny: (r.cost_cny || 0) + (r2.cost_cny || 0) }; errs = r.json ? validate(normalize(r.json), OUTPUT_SCHEMA) : ['not valid JSON']
    }
    if (errs.length) { mdb.prepare('UPDATE coach_run SET ok=0, error=?, response=?, usage=?, cost_cny=?, model=? WHERE id=?').run('schema after repair: ' + errs.slice(0, 5).join('; ') + ' — memory writes dropped', r.text, JSON.stringify(r.usage), r.cost_cny, r.model, runId); return { runId, ok: false, text: r.text, errors: errs } }
    // gate check: while a validated gate is active no hard session may be recommended; diagnosis / clearance wording is flagged
    const gc = gateCheck(r.json, gateFromTwin(ctx.volatile.twin)), dx = diagnosisWording(gc.parsed)
    if (dx.length) gc.parsed = { ...gc.parsed, flags: [...(gc.parsed.flags || []), { type: 'rule', text: 'The coach does not diagnose or clear you to train; treat "' + dx[0] + '" as a question for a clinician.' }] }
    if (gc.removed.length || dx.length) audit('safety:answer-adjusted', null, { removed: gc.removed.map((x) => x.action), diagnosis: dx }, runId)
    const fin = finishRun(runId, gc.parsed, { provider, usage: r.usage, model: r.model, cost: r.cost_cny, raw: r.text })
    return { runId, ok: fin.ok, model: r.model, cost_cny: r.cost_cny, ...fin }
  } catch (e) { mdb.prepare('UPDATE coach_run SET ok=0, error=? WHERE id=?').run(String(e.message).slice(0, 300), runId); throw e }
}
export const recentRuns = (n = 10) => mdb.prepare('SELECT id, created_at, intent, provider, model, effort, ok, error, cost_cny, context_tokens FROM coach_run ORDER BY id DESC LIMIT ?').all(n)
export const getRun = (id) => { const r = mdb.prepare('SELECT * FROM coach_run WHERE id=?').get(id); return r ? { ...r, parsed: r.parsed ? JSON.parse(r.parsed) : null, usage: r.usage ? JSON.parse(r.usage) : null, context_ids: JSON.parse(r.context_ids || '[]'), request: undefined } : null }
