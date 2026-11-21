// Anthropic Messages API provider, same contract as llm.js complete(): {text,json,usage,model,cost_cny}.
// Cost comes from env prices (never guessed): ANTHROPIC_PRICE_IN/OUT_USD_PER_MTOK and USD_CNY. Unset → refuses to run, so the monthly cap stays meaningful.
// Own monthly cap (ANTHROPIC_MONTHLY_CAP_CNY, default 15) over this provider's coach_run.cost_cny. JSON is requested in the instructions and parsed.
import { mdb } from './db.js'

const monthOf = (ms = Date.now()) => new Date(ms + 7 * 3600e3).toISOString().slice(0, 7)
const num = (v) => { const n = Number(v); return v !== undefined && v !== '' && Number.isFinite(n) && n > 0 ? n : null }
export const prices = () => ({ inUsd: num(process.env.ANTHROPIC_PRICE_IN_USD_PER_MTOK), outUsd: num(process.env.ANTHROPIC_PRICE_OUT_USD_PER_MTOK), fx: num(process.env.USD_CNY) })
export function configured() {
  const p = prices(), miss = []
  if (!process.env.ANTHROPIC_API_KEY) miss.push('ANTHROPIC_API_KEY'); if (!process.env.ANTHROPIC_MODEL) miss.push('ANTHROPIC_MODEL')
  if (!p.inUsd) miss.push('ANTHROPIC_PRICE_IN_USD_PER_MTOK'); if (!p.outUsd) miss.push('ANTHROPIC_PRICE_OUT_USD_PER_MTOK'); if (!p.fx) miss.push('USD_CNY')
  return { ok: !miss.length, missing: miss }
}
export const costCny = (usage) => { const p = prices(); return +(((usage?.input_tokens || 0) * p.inUsd + (usage?.output_tokens || 0) * p.outUsd) / 1e6 * p.fx).toFixed(4) }
export const capCny = () => num(process.env.ANTHROPIC_MONTHLY_CAP_CNY) || 15
export const monthSpend = (month = monthOf()) => +(mdb.prepare("SELECT COALESCE(SUM(cost_cny),0) s FROM coach_run WHERE provider='anthropic' AND created_at >= ? AND created_at < ?").get(month + '-01', month + '-32').s).toFixed(4)
export function guard({ month } = {}) {
  const spend = monthSpend(month), cap = capCny()
  return spend >= cap ? { ok: false, level: 'paused', spend, cap, reason: `Anthropic monthly cap ¥${cap} reached (spent ¥${spend})` } : { ok: true, level: 'ok', spend, cap }
}
const stripFence = (t) => String(t).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
const JSON_RULE = '\n\nReply with ONE JSON object only: no prose before or after it and no code fence.'

export async function complete({ system, user, messages, maxTokens = 8000, fetchFn = fetch, skipGuard = false } = {}) {
  const c = configured(); if (!c.ok) throw Object.assign(new Error('Anthropic provider not configured: ' + c.missing.join(', ')), { status: 503 })
  const g = guard(); if (!skipGuard && !g.ok) throw Object.assign(new Error(g.reason), { status: 429, guard: g })
  // messages form (repair call): system turn is folded into `system`; the rest are user/assistant turns
  const sys = (messages ? messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n') : system) + JSON_RULE
  const turns = messages ? messages.filter((m) => m.role !== 'system') : [{ role: 'user', content: user }]
  const body = { model: process.env.ANTHROPIC_MODEL, max_tokens: maxTokens, system: sys, messages: turns }
  let j, lastErr
  for (let a = 0; a < 3; a++) {
    const r = await fetchFn((process.env.ANTHROPIC_BASE || 'https://api.anthropic.com') + '/v1/messages', { method: 'POST', headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(120000) })
    const t = await r.text(); let p; try { p = JSON.parse(t) } catch { p = null }
    if (r.ok) { j = p; break }
    lastErr = Object.assign(new Error(`anthropic ${r.status}: ${(p?.error?.message || t).slice(0, 200)}`), { status: r.status })
    if (![429, 500, 502, 503, 529].includes(r.status)) throw lastErr
    await new Promise((res) => setTimeout(res, 1500 * (a + 1)))
  }
  if (!j) throw lastErr
  const text = (j.content || []).filter((b) => b.type === 'text').map((b) => b.text).join(''), cost = costCny(j.usage)
  if (j.stop_reason === 'max_tokens') throw Object.assign(new Error('response truncated (max_tokens)'), { status: 502, text, truncated: true, cost_cny: cost })
  let json = null; try { json = JSON.parse(stripFence(text)) } catch {}
  return { text, json, usage: j.usage || null, model: j.model || body.model, model_name: body.model, cost_cny: cost }
}
