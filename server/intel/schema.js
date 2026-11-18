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
