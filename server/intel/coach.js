// Orchestrates one coach run: context → provider → schema validation (+1 repair) → write-back → coach_run row.
import crypto from 'node:crypto'
import { mdb, idb } from './db.js'
import { retrieveRunnerContext, renderPrompt, TASKS, OUTPUT_SCHEMA, coachLang } from './context.js'
import { validate, normalize as norm0, softClamp } from './schema.js'
const normalize = (j) => softClamp(norm0(j))
import { complete as deepseek } from './llm.js'
import * as claude from './anthropic.js'
import { applyWriteback } from './writeback.js'
import { verifyAnswer, measuredBase } from './grounding.js'
import { audit, getMemory } from './memory.js'
import { scoreAnswer } from './eval/quality.js'
import { recordAdvice } from './advice.js'
import { load } from '../db.js'
import { redFlags, checkinFlags, referralFor, gateFromTwin, gateCheck, diagnosisWording } from './safety.js'

const EFFORT = { daily_brief: 'low', question: 'high', session_review: 'high', weekly_review: 'high', race_plan: 'high' }
const now = () => new Date().toISOString()
// Per-intent routing. Off by default: set COACH_CLAUDE_INTENTS=race_plan,session_review (after the eval) to send those to Anthropic.
// An intent routed to Claude whose provider is not fully configured (key, model, prices) or is over its cap falls back to DeepSeek.
export function pickProvider(intent) {
  const want = (process.env.COACH_CLAUDE_INTENTS || '').split(',').map((x) => x.trim()).filter(Boolean)
  return want.includes(intent) && claude.configured().ok && claude.guard().ok ? 'anthropic' : 'deepseek'
}
// Fingerprint of everything the model would be shown (system + user text: the session's metrics, your check-in, recovery data, the twin, today's date).
// Same fingerprint = nothing it could base a different answer on has changed, so the saved analysis is reused and no model call is made. A new metric,
// a new check-in, new recovery data or a new day changes the text and therefore the fingerprint, which unlocks a new analysis.
export const promptHash = (prompt) => crypto.createHash('sha256').update(String(prompt.system || '') + '\u0000' + String(prompt.user || '')).digest('hex').slice(0, 32)
export const savedRun = (intent, hash) => mdb.prepare('SELECT id, created_at, model, cost_cny FROM coach_run WHERE ok=1 AND intent=? AND req_hash=? ORDER BY id DESC LIMIT 1').get(intent, hash) || null
// is the newest saved analysis of this question still current? (no model call, no cost)
// A per-session review needs that session's FIT metrics. Without them the retrieval silently fell back to the latest sessions and
// reviewed a different run, so refuse instead.
export const hasFit = (activityId) => !activityId || !!idb.prepare('SELECT 1 FROM fit_session WHERE activity_id=? OR label_id=?').get(activityId, String(activityId).replace(/^coros:/, ''))
const NO_FIT = 'The FIT file of this run is not imported yet, so it cannot be analysed. Weather, air quality, route and the coach review appear after the next COROS sync.'
export function coachStatus({ intent = 'daily_brief', question = '', date, activityId = null } = {}) {
  if (intent === 'session_review' && !hasFit(activityId)) return { up_to_date: false, no_fit: true, reason: NO_FIT, run_id: null, last_run_id: null, last_at: null }
  const ctx = retrieveRunnerContext({ intent, question, date, activityId }), hash = promptHash(renderPrompt(ctx, TASKS[intent] || TASKS.question))
  const same = savedRun(intent, hash)
  const last = question ? mdb.prepare('SELECT id, created_at FROM coach_run WHERE ok=1 AND intent=? AND question=? ORDER BY id DESC LIMIT 1').get(intent, question) : mdb.prepare('SELECT id, created_at FROM coach_run WHERE ok=1 AND intent=? ORDER BY id DESC LIMIT 1').get(intent)
  return { up_to_date: !!same, run_id: same?.id ?? null, last_run_id: last?.id ?? null, last_at: last?.created_at ?? null, hash }
}
// runs saved before fingerprints existed: compute theirs from the stored prompt, so an old analysis also counts as "already done"
export function backfillHashes() {
  try { for (const r of mdb.prepare("SELECT id, request FROM coach_run WHERE req_hash IS NULL AND request IS NOT NULL AND provider != 'safety'").all()) { let q; try { q = JSON.parse(r.request) } catch { continue } if (q?.system != null) mdb.prepare('UPDATE coach_run SET req_hash=? WHERE id=?').run(promptHash(q), r.id) } } catch {}
}
backfillHashes()
export function newRun({ intent, provider, ctx, prompt, question }) {
  return Number(mdb.prepare('INSERT INTO coach_run (created_at, intent, provider, effort, question, context_ids, context_tokens, request, ok, req_hash) VALUES (?,?,?,?,?,?,?,?,0,?)').run(now(), intent, provider, EFFORT[intent], question || null, JSON.stringify(ctx.item_ids), ctx.tokens_est, JSON.stringify(prompt), promptHash(prompt)).lastInsertRowid)
}
export const corpusOf = (ctx) => JSON.stringify({ twin: ctx.volatile.twin, edges: ctx.volatile.correlation_edges, items: [...ctx.volatile.episodes, ...ctx.volatile.facts] })

// finalize a run given a parsed answer (used by DeepSeek and by the Claude Code CLI write-back)
export function finishRun(runId, parsed0, { provider, usage = null, model = null, cost = null, raw = null } = {}) {
  let parsed = parsed0
  const row = mdb.prepare('SELECT context_ids, request FROM coach_run WHERE id=?').get(runId), ids = JSON.parse(row.context_ids), req = JSON.parse(row.request)
  const errs = validate(softClamp(normalize(parsed)), OUTPUT_SCHEMA); if (errs.length) { mdb.prepare('UPDATE coach_run SET ok=0, error=?, response=?, model=? WHERE id=?').run('schema: ' + errs.slice(0, 5).join('; '), raw, model, runId); return { ok: false, errors: errs } }
  const base = measuredBase(req.user), wb = applyWriteback(parsed, { runId, itemIds: ids, corpus: req.user + '\n' + req.system, provider, base })
  // grounding of the athlete-facing text: unknown ids / numbers not found in the cited items or the twin are reported (and shown as a badge), never silently trusted
  const items = (() => { try { return ids.map((i) => getMemory(i)).filter(Boolean) } catch { return [] } })(), grounding = verifyAnswer(parsed, { itemIds: ids, items, base })
  if (grounding.bad_ids.length || grounding.unverified.length) audit('grounding:flagged', null, { bad_ids: grounding.bad_ids, unverified: grounding.unverified.slice(0, 10) }, runId)
  parsed = { ...parsed, grounding }
  // quality of what the athlete will read (voice, numbers, structure, grounding): recorded on every answer, never blocks it
  const intentRow = mdb.prepare('SELECT intent FROM coach_run WHERE id=?').get(runId); parsed.quality = scoreAnswer(parsed, { intent: intentRow?.intent || 'question', lang: coachLang() })
  try { recordAdvice(runId, parsed) } catch (e) { console.error('advice ledger', e.message) }   // the ledger must never break an answer
  mdb.prepare('UPDATE coach_run SET ok=1, response=?, parsed=?, usage=?, cost_cny=?, model=?, error=NULL WHERE id=?').run(raw, JSON.stringify({ ...parsed, _writeback: wb }), usage ? JSON.stringify(usage) : null, cost, model, runId)
  return { ok: true, parsed, writeback: wb }
}
export { normalize } from './schema.js'
// Safety pre-check: a reported red-flag symptom (in the question, or severe pain in the last two check-ins) gets a referral and NO model call.
function safetyPre(question) {
  const flags = redFlags(question), log = idb.prepare("SELECT date, pain FROM daily_log WHERE pain IS NOT NULL ORDER BY date DESC LIMIT 2").all()
  // pain ever recorded for those dates (append-only kv_history), so overwriting a severe entry with 0 cannot suppress the referral
  let hist = []; try { hist = load('kv_history', []) } catch {}
  for (const l of log) {
    const prior = hist.filter((h) => h.key === 'lumpad.daily.' + l.date).flatMap((h) => { const v = h.prev || {}; return v.painSites ? Object.values(v.painSites) : v.pain !== '' && v.pain != null ? [Number(v.pain)] : [] }).filter(Number.isFinite)
    const w = Math.max(0, ...Object.values(JSON.parse(l.pain || '{}')), ...prior); flags.push(...checkinFlags({ pain: w }))
  }
  return [...new Map(flags.map((f) => [f.id, f])).values()]
}
export async function runCoach({ intent = 'daily_brief', question = '', date, activityId = null, fetchFn, force = false } = {}) {
  const red = safetyPre(question)
  if (red.length) {
    const parsed = referralFor(red), id = Number(mdb.prepare('INSERT INTO coach_run (created_at, intent, provider, effort, question, context_ids, context_tokens, request, response, parsed, model, cost_cny, ok) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1)')
      .run(now(), intent, 'safety', null, question || null, '[]', 0, JSON.stringify({ system: 'safety rules', user: '' }), JSON.stringify(parsed), JSON.stringify(parsed), 'safety-rules', 0).lastInsertRowid)
    audit('safety:referral', null, { ids: red.map((f) => f.id) }, id)
    return { runId: id, ok: true, parsed, model: 'safety-rules', cost_cny: 0, safety: true }
  }
  if (intent === 'session_review' && !hasFit(activityId)) throw Object.assign(new Error(NO_FIT), { status: 409 })
  const ctx = retrieveRunnerContext({ intent, question, date, activityId }), prompt = renderPrompt(ctx, TASKS[intent] || TASKS.question), reqHash = promptHash(prompt)
  if (!force) { const hit = savedRun(intent, reqHash); if (hit) { const row = getRun(hit.id); return { runId: hit.id, ok: true, cached: true, saved_at: hit.created_at, parsed: row.parsed, model: hit.model, cost_cny: 0 } } }
  const provider = pickProvider(intent), llm = provider === 'anthropic' ? claude.complete : deepseek, runId = newRun({ intent, provider, ctx, prompt, question })
  try {
    let r = await llm({ ...prompt, effort: EFFORT[intent], intent, fetchFn }), errs = r.json ? validate(normalize(r.json), OUTPUT_SCHEMA) : ['not valid JSON']
    if (errs.length) { // one repair attempt, with the validator's own message
      const msgs = [{ role: 'system', content: prompt.system }, { role: 'user', content: prompt.user }, { role: 'assistant', content: r.text.slice(0, 4000) }, { role: 'user', content: 'Your reply did not match the required JSON shape: ' + errs.slice(0, 6).join('; ') + '. Reply again with ONE corrected JSON object only.' }]
      const r2 = await llm({ messages: msgs, effort: 'low', intent, fetchFn }); r = { ...r2, cost_cny: (r.cost_cny || 0) + (r2.cost_cny || 0) }; errs = r.json ? validate(normalize(r.json), OUTPUT_SCHEMA) : ['not valid JSON']
    }
    if (errs.length) { mdb.prepare('UPDATE coach_run SET ok=0, error=?, response=?, usage=?, cost_cny=?, model=? WHERE id=?').run('schema after repair: ' + errs.slice(0, 5).join('; ') + ' — memory writes dropped', r.text, JSON.stringify(r.usage), r.cost_cny, r.model, runId); return { runId, ok: false, text: r.text, errors: errs } }
    // gate check: while a validated gate is active no hard session may be recommended; diagnosis / clearance wording is flagged
    const gc = gateCheck(r.json, gateFromTwin(ctx.volatile.twin)), dx = diagnosisWording(gc.parsed)
    if (dx.length) gc.parsed = { ...gc.parsed, flags: [{ type: 'rule', text: 'The coach does not diagnose or clear you to train; treat "' + dx[0] + '" as a question for a clinician.' }, ...(gc.parsed.flags || [])].slice(0, 8) }
    if (gc.removed.length || dx.length) audit('safety:answer-adjusted', null, { removed: gc.removed.map((x) => x.action), diagnosis: dx }, runId)
    const fin = finishRun(runId, gc.parsed, { provider, usage: r.usage, model: r.model, cost: r.cost_cny, raw: r.text })
    return { runId, ok: fin.ok, model: r.model, cost_cny: r.cost_cny, ...fin }
  } catch (e) { mdb.prepare('UPDATE coach_run SET ok=0, error=? WHERE id=?').run(String(e.message).slice(0, 300), runId); throw e }
}
export const recentRuns = (n = 10) => mdb.prepare('SELECT id, created_at, intent, provider, model, effort, ok, error, cost_cny, context_tokens FROM coach_run ORDER BY id DESC LIMIT ?').all(n)
export const getRun = (id) => { const r = mdb.prepare('SELECT * FROM coach_run WHERE id=?').get(id); return r ? { ...r, parsed: r.parsed ? JSON.parse(r.parsed) : null, usage: r.usage ? JSON.parse(r.usage) : null, context_ids: JSON.parse(r.context_ids || '[]'), request: undefined } : null }
