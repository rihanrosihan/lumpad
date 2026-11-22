// Answer grounding (audit H1/H2): every id the model cites must be in the context it was shown, and every non-trivial number it writes must equal
// (at the precision written) a number in the cited items, the twin, the telemetry or the correlation edges. Pure functions; no DB access.
import { numbersOf, timesOf } from './writeback.js'

const roundTo = (x, d) => Math.round(x * 10 ** d) / 10 ** d
const TRIVIAL = (x) => Number.isInteger(x) && Math.abs(x) <= 12
// dates, clock/pace tokens (8:00, 5:45/km: derived values) and [id] citations are not numbers to verify here
const stripText = (t) => String(t || '').replace(/\d{4}-\d{2}-\d{2}/g, ' ').replace(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g, ' ').replace(/\[\d+\]/g, ' ')

// the measured part of a rendered prompt: twin + telemetry + correlation edges (parsed back out of the "CONTEXT JSON:" line)
export function measuredBase(userPrompt) {
  const m = /CONTEXT JSON:\n(\{.*\})/.exec(String(userPrompt || ''))
  if (!m) return ''
  try { const c = JSON.parse(m[1]); return JSON.stringify({ twin: c.twin, telemetry: c.telemetry, correlation_edges: c.correlation_edges }) } catch { return '' }
}
const numbersStrict = (text, have) => {
  const bad = []
  for (const raw of stripText(text).match(/-?\d+(?:[.,]\d+)?/g) || []) {
    const n = parseFloat(raw.replace(',', '.')); if (!isFinite(n) || TRIVIAL(n) || (n >= 2024 && n <= 2030)) continue
    const d = (raw.split(/[.,]/)[1] || '').length
    if (!have.some((h) => roundTo(h, d) === n)) bad.push(raw)
  }
  return bad
}
// ctx = { item_ids, items: [{id, body}], base } (base = measuredBase(prompt.user))
export function verifyAnswer(parsed, { itemIds = [], items = [], base = '' } = {}) {
  const allowed = new Set(itemIds)
  const ids = [...(parsed?.cited_ids || []), ...(parsed?.recommendations || []).flatMap((r) => r?.evidence_ids || [])].filter(Number.isInteger)
  const bad_ids = [...new Set(ids.filter((i) => !allowed.has(i)))]
  const cited = items.filter((i) => ids.includes(i.id)).map((i) => `${i.title || ''} ${i.body || ''}`)
  const evidence = [base, ...cited].join('\n'), have = numbersOf(evidence)
  const unverified = []
  for (const t of [parsed?.summary, parsed?.analysis_md, ...(parsed?.recommendations || []).map((r) => r?.why)]) {
    unverified.push(...numbersStrict(t, have))
  }
  return { checked: true, bad_ids, unverified: [...new Set(unverified)].slice(0, 50) }
}
export { numbersStrict }
