// Official race results: built-in data + user edits (store key 'lumpad.official'). An edit overrides the built-in record field by field;
// an empty string clears a field; removing the edit restores the built-in values.
const FIELDS = ['event', 'bib', 'status', 'net', 'gun', 'rank', 'provider', 'url', 'splits']
export function mergeOfficial(base = {}, stored = {}) {
  const out = { ...base }
  for (const [date, e] of Object.entries(stored || {})) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !e || typeof e !== 'object') continue
    const m = { ...(base[date] || {}) }
    for (const k of FIELDS) if (k in e) { if (k === 'splits') { if (Array.isArray(e.splits)) m.splits = e.splits } else if (typeof e[k] === 'string') m[k] = e[k] }
    out[date] = m
  }
  return out
}
// "10K | 1:18:59 | 7:54/km" per line  <->  [['10K','1:18:59','7:54/km'], …]
export const splitsToText = (sp) => (sp || []).map((r) => r.join(' | ')).join('\n')
export const parseSplits = (text) => String(text || '').split('\n').map((l) => l.split('|').map((x) => x.trim())).filter((r) => r[0] && r[1]).map((r) => [r[0], r[1], r[2] || ''])
// only http(s) links are kept (the field is rendered as a link)
export const safeUrl = (u) => { try { const x = new URL(u); return x.protocol === 'https:' || x.protocol === 'http:' ? x.href : '' } catch { return '' } }
