// The AI Coach as a constrained SELECTOR (P5). It sees the deterministic skeleton and, per key slot, at most three kernel-checked options; it answers with option ids and a short
// summary. It cannot add a template, a date or a number: unknown ids and anything that would raise load fall back to the engine's own choice, slot by slot, and numbers in its
// text must appear in the evidence or the text is dropped. Every call goes through the existing gateway (cap, guard, provider) and is logged as a coach_run row.
import crypto from 'node:crypto'
import { numbersOf } from '../intel/writeback.js'
import { numbersStrict } from '../intel/grounding.js'
import { memoryNotes } from './signals.js'

const EST = (s) => Math.ceil(String(s).length / 3.6), sha = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 32)
export const MAX_SUMMARY_WORDS = 120, WHY_WORDS = 80
export const planTokenCap = (env = process.env) => (Number(env.PLAN_TOKEN_CAP) > 0 ? Number(env.PLAN_TOKEN_CAP) : 200000)
export const coachEnabled = (env = process.env) => env.PLAN_COACH === '1'

export const SYSTEM = `You are the planning assistant of a single-athlete running coach app. A deterministic engine has already built a season plan that satisfies every safety rule.
Your only job: for each slot, pick ONE of the offered option ids (the engine ranked them; the first is its default), and write a short summary.
Rules: use only the option ids offered for that slot; never invent a session, a date, a distance or a pace; never propose more training; a memory marked HYPOTHESIS is context, not fact.
Reply with JSON only: {"picks":[{"slot":"YYYY-MM-DD","option":"<offered id>"}],"summary":"<=120 words, plain language, only numbers that appear in the input"}.`
export function buildPrompt({ slots, header, twin, memories }) {
  const body = { header, twin, memory: memoryNotes(memories), slots: slots.map((s) => ({ slot: s.date, phase: s.phase, kind: s.kind, km: s.km, options: s.options.map((o) => ({ id: o.id, name: o.name, km: o.km, hard_km: o.hi_km, score: o.total, personal: o.parts.personal })) })) }
  const user = 'INPUT JSON:\n' + JSON.stringify(body)
  return { system: SYSTEM, user, tokens_est: EST(SYSTEM) + EST(user), body }
}
// strict reply check: picks must be {slot, option} with strings; summary a string within the word limit. Anything else is dropped (reported), never repaired by guessing.
export function validateReply(json, slots) {
  const errors = [], offered = Object.fromEntries(slots.map((s) => [s.date, new Set(s.options.map((o) => o.id))]))
  if (!json || typeof json !== 'object') return { picks: [], summary: null, errors: ['reply is not a JSON object'] }
  const picks = []
  if (!Array.isArray(json.picks)) errors.push('picks is not a list')
  else for (const p of json.picks) { if (!p || typeof p.slot !== 'string' || typeof p.option !== 'string') { errors.push('malformed pick'); continue } if (!offered[p.slot]) { errors.push(`slot ${p.slot} was not offered`); continue } if (!offered[p.slot].has(p.option)) { errors.push(`option ${p.option} was not offered for ${p.slot}`); continue } picks.push({ slot: p.slot, option: p.option }) }
  let summary = null
  if (typeof json.summary === 'string') { const w = json.summary.trim().split(/\s+/).filter(Boolean).length; if (w > MAX_SUMMARY_WORDS) errors.push(`summary has ${w} words (limit ${MAX_SUMMARY_WORDS})`); else if (w) summary = json.summary.trim() }
  else if (json.summary != null) errors.push('summary is not text')
  return { picks, summary, errors }
}
// numbers in model text must be found in the evidence it was given (the prompt body plus the proposal facts); otherwise the text is dropped and the engine's own rationale stays
export function groundText(text, evidence) {
  if (!text) return { text: null, unverified: [] }
  const unverified = numbersStrict(text, numbersOf(typeof evidence === 'string' ? evidence : JSON.stringify(evidence)))
  return unverified.length ? { text: null, unverified } : { text, unverified: [] }
}
const monthStart = (now) => now.slice(0, 7) + '-01'
export function planTokensThisMonth(mdb, now = new Date().toISOString()) {
  return mdb.prepare("SELECT COALESCE(SUM(COALESCE(json_extract(usage,'$.total_tokens'), json_extract(usage,'$.prompt_tokens') + json_extract(usage,'$.completion_tokens'), 0)),0) n FROM coach_run WHERE intent LIKE 'plan_%' AND created_at >= ?").get(monthStart(now)).n
}
const ledger = (mdb, row) => Number(mdb.prepare('INSERT INTO coach_run (created_at, intent, provider, model, effort, question, context_ids, context_tokens, request, response, parsed, ok, error, usage, cost_cny, req_hash) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
  .run(row.at, row.intent, row.provider, row.model ?? null, row.effort, row.question ?? null, JSON.stringify(row.ids ?? []), row.tokens_est ?? null, JSON.stringify(row.request), row.response ?? null, row.parsed ? JSON.stringify(row.parsed) : null, row.ok ? 1 : 0, row.error ?? null, row.usage ? JSON.stringify(row.usage) : null, row.cost ?? null, row.hash).lastInsertRowid)

// One selection call. Returns { picks, summary, runId, tokens, engineOnly, reason, errors }. Never throws: every failure is "engine-only" with the reason.
export async function coachSelect({ slots, header, twin = null, memories = [], complete, mdb, intent = 'plan_macro', now = new Date().toISOString(), env = process.env }) {
  const off = (reason, extra = {}) => ({ picks: [], summary: null, runId: null, tokens: 0, engineOnly: true, reason, errors: [], ...extra })
  if (!coachEnabled(env)) return off('PLAN_COACH is off')
  if (!slots.length) return off('no slots to choose')
  const used = planTokensThisMonth(mdb, now), cap = planTokenCap(env); if (used >= cap) return off(`plan token cap reached (${used} of ${cap} this month)`)
  const prompt = buildPrompt({ slots, header, twin, memories }); if (used + prompt.tokens_est > cap) return off(`this call (~${prompt.tokens_est} tokens) would pass the plan token cap (${used} of ${cap} used)`)
  const hash = sha(prompt.system + '\u0000' + prompt.user)
  const same = mdb.prepare('SELECT id, parsed, usage FROM coach_run WHERE ok=1 AND intent=? AND req_hash=? ORDER BY id DESC LIMIT 1').get(intent, hash)
  if (same) { const v = validateReply(JSON.parse(same.parsed), slots); return { picks: v.picks, summary: v.summary, runId: same.id, tokens: 0, engineOnly: false, reused: true, reason: 'same request answered before (no new call)', errors: v.errors, evidence: prompt.body } }
  let r; try { r = await complete({ system: prompt.system, user: prompt.user, effort: 'low', intent }) }
  catch (e) { ledger(mdb, { at: now, intent, provider: 'deepseek', effort: 'low', request: { system: prompt.system, user: prompt.user }, ok: false, error: String(e.message).slice(0, 300), hash, tokens_est: prompt.tokens_est }); return off(`model call failed: ${e.message}`) }
  const v = validateReply(r.json, slots), tokens = r.usage?.total_tokens ?? ((r.usage?.prompt_tokens || 0) + (r.usage?.completion_tokens || 0))
  const runId = ledger(mdb, { at: now, intent, provider: 'deepseek', model: r.model, effort: r.effort || 'low', request: { system: prompt.system, user: prompt.user }, response: r.text, parsed: r.json, ok: !!r.json && !v.errors.some((x) => x.includes('not a JSON')), error: v.errors.length ? v.errors.slice(0, 5).join('; ') : null, usage: r.usage, cost: r.cost_cny, hash, tokens_est: prompt.tokens_est })
  return { picks: v.picks, summary: v.summary, runId, tokens, engineOnly: false, reason: null, errors: v.errors, evidence: prompt.body }
}
// "why?" for one stored adjustment (FR-AIC-4): <= 80 words, grounded in the adjustment itself
export async function explainAdjustment({ adjustment, complete, mdb, now = new Date().toISOString(), env = process.env }) {
  const fallback = (reason) => ({ text: adjustment.rationale_det, source: 'engine', reason })
  if (!coachEnabled(env)) return fallback('PLAN_COACH is off')
  const used = planTokensThisMonth(mdb, now); if (used >= planTokenCap(env)) return fallback('plan token cap reached')
  const facts = { scope: [adjustment.scope_from, adjustment.scope_to], operators: adjustment.operators, rules: adjustment.rules, rationale: adjustment.rationale_det, diff: (adjustment.diff || []).slice(0, 12) }
  const system = `Explain in at most ${WHY_WORDS} words, in plain language, why this training-plan change was made. Use only facts and numbers from the input. Reply with JSON {"text":"..."}.`, user = 'INPUT JSON:\n' + JSON.stringify(facts), hash = sha(system + user)
  const same = mdb.prepare('SELECT parsed FROM coach_run WHERE ok=1 AND intent=? AND req_hash=? ORDER BY id DESC LIMIT 1').get('plan_why', hash); let text = null, runId = null
  if (same) text = JSON.parse(same.parsed)?.text
  else { let r; try { r = await complete({ system, user, effort: 'low', intent: 'plan_why' }) } catch (e) { return fallback(`model call failed: ${e.message}`) }
    text = r.json?.text; runId = ledger(mdb, { at: now, intent: 'plan_why', provider: 'deepseek', model: r.model, effort: 'low', request: { system, user }, response: r.text, parsed: r.json, ok: typeof text === 'string', usage: r.usage, cost: r.cost_cny, hash }) }
  if (typeof text !== 'string' || text.trim().split(/\s+/).length > WHY_WORDS) return fallback('the model answer was missing or too long')
  const g = groundText(text.trim(), facts); return g.text ? { text: g.text, source: 'coach', runId } : { ...fallback(`numbers not found in the change: ${g.unverified.join(', ')}`), runId }
}
