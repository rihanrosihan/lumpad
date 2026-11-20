// Minimal JSON-schema validator (type, required, properties, items, enum, maxLength, maxItems, minItems). Provider JSON mode guarantees valid JSON, not this shape — so we check it ourselves.
export function validate(v, s, path = '$') {
  const err = []
  const t = Array.isArray(v) ? 'array' : v === null ? 'null' : Number.isInteger(v) && s.type === 'integer' ? 'integer' : typeof v
  if (s.type && !(s.type === t || (s.type === 'number' && typeof v === 'number') || (s.type === 'integer' && Number.isInteger(v)))) return [`${path}: expected ${s.type}, got ${t}`]
  if (s.enum && !s.enum.includes(v)) err.push(`${path}: must be one of ${s.enum.join('|')}`)
  if (typeof v === 'string' && s.maxLength && v.length > s.maxLength) err.push(`${path}: longer than ${s.maxLength}`)
  if (s.type === 'array') { if (s.maxItems != null && v.length > s.maxItems) err.push(`${path}: more than ${s.maxItems} items`); if (s.minItems != null && v.length < s.minItems) err.push(`${path}: fewer than ${s.minItems} items`); if (s.items) v.forEach((x, i) => err.push(...validate(x, s.items, `${path}[${i}]`))) }
  if (s.type === 'object') { for (const k of s.required || []) if (!(k in v)) err.push(`${path}: missing ${k}`); for (const [k, sub] of Object.entries(s.properties || {})) if (k in v) err.push(...validate(v[k], sub, `${path}.${k}`)) }
  return err
}

// Output contract of a coach answer (coach/1). Lives here (pure) so the Go port can be generated from and checked against it.
export const OUTPUT_SCHEMA = {
  type: 'object', required: ['summary', 'analysis_md', 'recommendations', 'flags', 'memory_writes', 'cited_ids'],
  properties: {
    summary: { type: 'string', maxLength: 900 }, analysis_md: { type: 'string', maxLength: 6000 },
    recommendations: { type: 'array', maxItems: 8, items: { type: 'object', required: ['action', 'why', 'priority'], properties: { action: { type: 'string', maxLength: 400 }, why: { type: 'string', maxLength: 500 }, priority: { type: 'string', enum: ['now', 'this_week', 'later'] }, evidence_ids: { type: 'array', items: { type: 'integer' } }, needs_athlete_ok: { type: 'boolean' } } } },
    flags: { type: 'array', maxItems: 8, items: { type: 'object', required: ['type', 'text'], properties: { type: { type: 'string', enum: ['gate', 'injury', 'load', 'heat', 'data_gap', 'rule', 'other'] }, text: { type: 'string', maxLength: 300 } } } },
    memory_writes: { type: 'array', maxItems: 5, items: { type: 'object', required: ['tier', 'title', 'body', 'cites'], properties: { tier: { type: 'string', enum: ['episodic', 'semantic', 'procedural'] }, kind: { type: 'string', maxLength: 30 }, title: { type: 'string', maxLength: 140 }, body: { type: 'string', maxLength: 900 }, cites: { type: 'array', minItems: 1, items: { type: 'integer' } }, tags: { type: 'array', maxItems: 8, items: { type: 'string', maxLength: 40 } }, confidence: { type: 'number' } } } },
    cited_ids: { type: 'array', items: { type: 'integer' } },
    // optional (blueprint §4.3): suggested twin changes — shown to the athlete, never applied automatically
    twin_state_patch: { type: 'object', properties: { current_ef_baseline: { type: 'number' }, shoe_alert: { type: 'string', maxLength: 300 }, readiness_modifier: { type: 'string', maxLength: 300 } } },
  },
}

const FLAG_TYPES = new Set(['gate', 'injury', 'load', 'heat', 'data_gap', 'rule', 'other'])
// cosmetic normalisation only (flag category labels); anything that affects advice or memory stays strictly validated
export const normalize = (j) => { if (j && Array.isArray(j.flags)) for (const f of j.flags) if (f && typeof f === 'object' && !FLAG_TYPES.has(f.type)) f.type = 'other'; return j }

// A coach answer that is only too long is not a failed answer: cut the display fields to their limit at a sentence boundary (or a space) instead of
// burning a repair call. Structure, enums and memory writes stay strictly validated. Returns the same object.
const clipText = (t, max) => {
  if (typeof t !== 'string' || t.length <= max) return t
  const cut = t.slice(0, max - 1), at = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('\n'), cut.lastIndexOf('; '))
  return (at > max * 0.6 ? cut.slice(0, at + 1) : cut.replace(/\s+\S*$/, '')) + '…'
}
export function softClamp(j, S = OUTPUT_SCHEMA) {
  if (!j || typeof j !== 'object') return j
  for (const k of ['summary', 'analysis_md']) if (typeof j[k] === 'string') j[k] = clipText(j[k], S.properties[k].maxLength)
  for (const [k, fields] of [['recommendations', ['action', 'why']], ['flags', ['text']]]) {
    const sp = S.properties[k]; if (!Array.isArray(j[k])) continue
    if (j[k].length > sp.maxItems) j[k] = j[k].slice(0, sp.maxItems)
    for (const it of j[k]) if (it && typeof it === 'object') for (const f of fields) if (typeof it[f] === 'string') it[f] = clipText(it[f], sp.items.properties[f].maxLength)
  }
  return j
}
