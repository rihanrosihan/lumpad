// DeepSeek provider (OpenAI-compatible /chat/completions) behind one interface: complete({system,user,effort,maxTokens,intent}) → {text,json,usage,model,cost_cny}.
// Model = the newest "Flash" in GET /models (DEEPSEEK_MODEL=auto-flash) or an explicit id. Spend cap from the ACCOUNT balance (no price table): month spend = sum of balance drops.
import { mdb } from './db.js'
import { load, save } from '../db.js'

const BASE = () => process.env.DEEPSEEK_BASE || 'https://api.deepseek.com'
const key = () => { const k = process.env.DEEPSEEK_API_KEY; if (!k) throw Object.assign(new Error('DEEPSEEK_API_KEY not set'), { status: 503 }); return k }
const monthOf = (ms = Date.now()) => new Date(ms + 7 * 3600e3).toISOString().slice(0, 7)
const capCny = () => Number(process.env.DEEPSEEK_MONTHLY_CAP_CNY) || 15
async function api(path, { method = 'GET', body, fetchFn = fetch, timeout = 120000 } = {}) {
  const r = await fetchFn(BASE() + path, { method, headers: { authorization: 'Bearer ' + key(), 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(timeout) })
  const text = await r.text(); let j; try { j = JSON.parse(text) } catch { j = null }
  if (!r.ok) throw Object.assign(new Error(`deepseek ${r.status}: ${(j?.error?.message || text).slice(0, 200)}`), { status: r.status, body: j })
  return j
}

// ---- model resolution: highest-versioned "Flash" (name like "DeepSeek-V4.1-Flash"); cached daily; explicit DEEPSEEK_MODEL pins
export const versionOf = (name) => { const m = /V(\d+(?:\.\d+)*)/i.exec(name || ''); return m ? m[1].split('.').map(Number) : [0] }
export const cmpVer = (a, b) => { for (let i = 0; i < Math.max(a.length, b.length); i++) { const d = (a[i] || 0) - (b[i] || 0); if (d) return d } return 0 }
export function pickFlash(models) { return models.filter((m) => /flash/i.test(m.name || m.id)).sort((a, b) => cmpVer(versionOf(b.name || b.id), versionOf(a.name || a.id)))[0] || null }
export async function resolveModel({ force = false, fetchFn = fetch } = {}) {
  const pin = process.env.DEEPSEEK_MODEL; if (pin && pin !== 'auto-flash') return { id: pin, name: pin, pinned: true }
  const c = load('deepseek_model', null), fresh = c && Date.now() - c.at < 864e5
  if (c && fresh && !force) return c
  try {
    const j = await api('/models', { fetchFn }), pick = pickFlash(j.data || []); if (!pick) throw new Error('no Flash model listed')
    const out = { id: pick.id, name: pick.name || pick.id, context: pick.context_window, efforts: pick.effort?.supported_levels, at: Date.now(), changed: !!c && c.id !== pick.id }
    save('deepseek_model', out); return out
  } catch (e) { if (c) return { ...c, stale: true }; throw e }
}

// ---- spend guard
export async function snapBalance({ fetchFn = fetch } = {}) {
  const j = await api('/user/balance', { fetchFn, timeout: 20000 }), cny = j.balance_infos?.find((b) => b.currency === 'CNY'); if (!cny) throw new Error('no CNY balance')
  const v = Number(cny.total_balance); mdb.prepare('INSERT INTO balance_snap (at, month, balance_cny) VALUES (?,?,?)').run(new Date().toISOString(), monthOf(), v); return v
}
export function monthSpend(month = monthOf()) {
  const s = mdb.prepare('SELECT balance_cny b FROM balance_snap WHERE month=? ORDER BY id').all(month); let spend = 0
  for (let i = 1; i < s.length; i++) spend += Math.max(0, s[i - 1].b - s[i].b)   // drops only; top-ups (rises) are ignored
  return +spend.toFixed(4)
}
// pure decision (also the reference for the Go port): spend and the largest single call so far are inputs
export function guardDecision({ intent, spend, cap, maxCall = 0 }) {
  if (spend >= cap) return { ok: false, level: 'paused', spend, cap, reason: `monthly cap ¥${cap} reached (spent ¥${spend}) — paused until next month` }
  if (cap - spend < maxCall) return { ok: false, level: 'paused', spend, cap, reason: `remaining ¥${(cap - spend).toFixed(2)} is below the largest call this month (¥${maxCall.toFixed(2)})` }
  if (spend >= 0.8 * cap && !['daily_brief', 'question'].includes(intent)) return { ok: false, level: 'limited', spend, cap, reason: `80 % of the ¥${cap} cap used — only the daily brief and asked questions run` }
  return { ok: true, level: spend >= 0.8 * cap ? 'limited' : 'ok', spend, cap }
}
export function guard(intent, { month = monthOf() } = {}) {
  const spend = monthSpend(month), cap = capCny(), maxCall = mdb.prepare('SELECT MAX(cost_cny) m FROM coach_run WHERE created_at >= ?').get(month + '-01').m || 0
  return guardDecision({ intent, spend, cap, maxCall })
}
export const guardStatus = () => ({ month: monthOf(), cap_cny: capCny(), spend_cny: monthSpend(), level: guard('daily_brief').level === 'paused' ? 'paused' : guard('weekly_review').level })

// Cost from the call's own token usage when the owner has set the prices (CNY per million tokens: DEEPSEEK_PRICE_MISS/HIT/OUT_CNY_PER_MTOK). Never guessed:
// without prices it stays null and the balance-drop figure is used. The balance snapshots remain as the daily reconciliation.
export function costFromUsage(u, env = process.env) {
  const miss = Number(env.DEEPSEEK_PRICE_MISS_CNY_PER_MTOK), hit = Number(env.DEEPSEEK_PRICE_HIT_CNY_PER_MTOK), out = Number(env.DEEPSEEK_PRICE_OUT_CNY_PER_MTOK)
  if (!u || !(miss > 0) || !(out > 0)) return null
  const pt = u.prompt_tokens || 0, h = u.prompt_cache_hit_tokens ?? u.prompt_tokens_details?.cached_tokens ?? 0, m = u.prompt_cache_miss_tokens ?? Math.max(0, pt - h)
  return +((m * miss + h * (hit > 0 ? hit : miss) + (u.completion_tokens || 0) * out) / 1e6).toFixed(4)
}
const stripFence = (t) => String(t).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
// DeepSeek counts the model's hidden reasoning inside max_tokens, so a 'high' effort run can spend the whole budget thinking and return
// finish_reason 'length' with no answer. Budget by effort, and if it still runs out retry once at low effort (costs add up).
const BUDGET = { high: 24000, medium: 14000, low: 12000 }
export async function complete(o = {}) {
  const effort = o.effort || 'high'
  try { return await completeOnce({ ...o, effort, maxTokens: o.maxTokens ?? BUDGET[effort] ?? 14000 }) }
  catch (e) {
    if (!e.truncated) throw e
    // truncated at 'low' too (the daily brief): retry once with twice the budget; truncated at a higher effort: retry at low with twice the low budget
    const r = await completeOnce({ ...o, effort: 'low', maxTokens: o.maxTokens ? o.maxTokens * 2 : BUDGET.low * 2 })
    return { ...r, retried_low: true, cost_cny: r.cost_cny != null && e.cost_cny != null ? +(r.cost_cny + e.cost_cny).toFixed(4) : r.cost_cny }
  }
}
async function completeOnce({ system, user, messages, effort = 'high', maxTokens = 14000, intent = 'question', fetchFn = fetch, skipGuard = false } = {}) {
  const g = guard(intent); if (!skipGuard && !g.ok) throw Object.assign(new Error(g.reason), { status: 429, guard: g })
  const model = await resolveModel({ fetchFn }); let pre = null; try { pre = await snapBalance({ fetchFn }) } catch {}
  const body = { model: model.id, messages: messages || [{ role: 'system', content: system }, { role: 'user', content: user }], response_format: { type: 'json_object' }, max_tokens: maxTokens, stream: false, ...(model.efforts?.includes(effort) ? { reasoning_effort: effort } : {}) }
  let j, lastErr
  for (let a = 0; a < 3; a++) {
    try { j = await api('/chat/completions', { method: 'POST', body, fetchFn }); break }
    catch (e) { lastErr = e; if (e.status === 400 && body.reasoning_effort) { delete body.reasoning_effort; continue } if (![429, 500, 502, 503, 504].includes(e.status)) throw e; await new Promise((r) => setTimeout(r, 1500 * (a + 1))) }
  }
  if (!j) throw lastErr
  let post = null; try { post = await snapBalance({ fetchFn }) } catch {}
  const text = j.choices?.[0]?.message?.content ?? '', finish = j.choices?.[0]?.finish_reason
  if (finish === 'length') throw Object.assign(new Error('response truncated (max_tokens) — the model used its whole budget before finishing'), { status: 502, text, truncated: true, cost_cny: pre != null && post != null ? +Math.max(0, pre - post).toFixed(4) : null })
  let json = null; try { json = JSON.parse(stripFence(text)) } catch {}
  return { text, json, usage: j.usage || null, model: model.id, model_name: model.name, cost_cny: costFromUsage(j.usage) ?? (pre != null && post != null ? +Math.max(0, pre - post).toFixed(4) : null), effort }
}
