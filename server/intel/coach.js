// Orchestrates one coach run: context → provider → schema validation (+1 repair) → write-back → coach_run row.
import { mdb } from './db.js'
import { retrieveRunnerContext, renderPrompt, TASKS, OUTPUT_SCHEMA } from './context.js'
import { validate } from './schema.js'
import { complete as deepseek } from './llm.js'
import { applyWriteback } from './writeback.js'

const EFFORT = { daily_brief: 'low', question: 'high', session_review: 'high', weekly_review: 'high', race_plan: 'high' }
const now = () => new Date().toISOString()
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
const FLAG_TYPES = new Set(['gate', 'injury', 'load', 'heat', 'data_gap', 'rule', 'other'])
// cosmetic normalisation only (flag category labels); anything that affects advice or memory stays strictly validated
export const normalize = (j) => { if (j && Array.isArray(j.flags)) for (const f of j.flags) if (f && typeof f === 'object' && !FLAG_TYPES.has(f.type)) f.type = 'other'; return j }
export async function runCoach({ intent = 'daily_brief', question = '', date, activityId = null, fetchFn } = {}) {
  const ctx = retrieveRunnerContext({ intent, question, date, activityId }), prompt = renderPrompt(ctx, TASKS[intent] || TASKS.question), runId = newRun({ intent, provider: 'deepseek', ctx, prompt, question })
  try {
    let r = await deepseek({ ...prompt, effort: EFFORT[intent], intent, fetchFn }), errs = r.json ? validate(normalize(r.json), OUTPUT_SCHEMA) : ['not valid JSON']
    if (errs.length) { // one repair attempt, with the validator's own message
      const msgs = [{ role: 'system', content: prompt.system }, { role: 'user', content: prompt.user }, { role: 'assistant', content: r.text.slice(0, 4000) }, { role: 'user', content: 'Your reply did not match the required JSON shape: ' + errs.slice(0, 6).join('; ') + '. Reply again with ONE corrected JSON object only.' }]
      const r2 = await deepseek({ messages: msgs, effort: 'low', intent, fetchFn }); r = { ...r2, cost_cny: (r.cost_cny || 0) + (r2.cost_cny || 0) }; errs = r.json ? validate(normalize(r.json), OUTPUT_SCHEMA) : ['not valid JSON']
    }
    if (errs.length) { mdb.prepare('UPDATE coach_run SET ok=0, error=?, response=?, usage=?, cost_cny=?, model=? WHERE id=?').run('schema after repair: ' + errs.slice(0, 5).join('; ') + ' — memory writes dropped', r.text, JSON.stringify(r.usage), r.cost_cny, r.model, runId); return { runId, ok: false, text: r.text, errors: errs } }
    const fin = finishRun(runId, r.json, { provider: 'deepseek', usage: r.usage, model: r.model, cost: r.cost_cny, raw: r.text })
    return { runId, ok: fin.ok, model: r.model, cost_cny: r.cost_cny, ...fin }
  } catch (e) { mdb.prepare('UPDATE coach_run SET ok=0, error=? WHERE id=?').run(String(e.message).slice(0, 300), runId); throw e }
}
export const recentRuns = (n = 10) => mdb.prepare('SELECT id, created_at, intent, provider, model, effort, ok, error, cost_cny, context_tokens FROM coach_run ORDER BY id DESC LIMIT ?').all(n)
export const getRun = (id) => { const r = mdb.prepare('SELECT * FROM coach_run WHERE id=?').get(id); return r ? { ...r, parsed: r.parsed ? JSON.parse(r.parsed) : null, usage: r.usage ? JSON.parse(r.usage) : null, context_ids: JSON.parse(r.context_ids || '[]'), request: undefined } : null }
