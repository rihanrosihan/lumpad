// Biometrics: body weight / composition, blood pressure, blood glucose and lab values. Pure functions only; the page keeps the logs
// in the synced store (server KV), never in the repo. Classifications use general reference ranges and are information, not diagnosis.
export const EMPTY_BIO = { weight: [], bp: [], glu: [], lab: [] }

const num = (x) => (x === '' || x == null ? null : Number(x))
const okDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d))
const within = (v, a, b) => v != null && Number.isFinite(v) && v >= a && v <= b

// optional body-composition details (percentages per segment, visceral rating) from a body-composition scale
const BC_KEYS = ['sub', 'subTrunk', 'subArms', 'subLegs', 'mus', 'musTrunk', 'musArms', 'musLegs', 'visc']
const cleanBc = (b) => { if (!b || typeof b !== 'object') return null; const o = {}; for (const k of BC_KEYS) { const v = num(b[k]); if (v != null && v >= 0 && v <= 100) o[k] = v } return Object.keys(o).length ? o : null }

// → { ok:true, entry } | { ok:false, error }
export function validate(type, raw) {
  const d = raw.d
  if (!okDate(d)) return { ok: false, error: 'Invalid date' }
  if (type === 'weight') {
    const kg = num(raw.kg), bf = num(raw.bf), lbm = num(raw.lbm)
    if (!within(kg, 30, 200)) return { ok: false, error: 'Weight must be 30–200 kg' }
    if (bf != null && !within(bf, 3, 60)) return { ok: false, error: 'Body fat must be 3–60 %' }
    if (lbm != null && !within(lbm, 20, 150)) return { ok: false, error: 'Lean mass must be 20–150 kg' }
    return { ok: true, entry: { d, kg, ...(bf != null ? { bf } : {}), ...(lbm != null ? { lbm } : {}), ...(cleanBc(raw.bc) ? { bc: cleanBc(raw.bc) } : {}) } }
  }
  if (type === 'bp') {
    const sys = num(raw.sys), dia = num(raw.dia), pulse = num(raw.pulse)
    if (!within(sys, 70, 250)) return { ok: false, error: 'Systolic must be 70–250 mmHg' }
    if (!within(dia, 40, 150)) return { ok: false, error: 'Diastolic must be 40–150 mmHg' }
    if (sys <= dia) return { ok: false, error: 'Systolic must be higher than diastolic' }
    if (pulse != null && !within(pulse, 25, 220)) return { ok: false, error: 'Pulse must be 25–220 bpm' }
    return { ok: true, entry: { d, sys, dia, ...(pulse != null ? { pulse } : {}) } }
  }
  if (type === 'glu') {
    const mgdl = num(raw.mgdl), ctx = ['fasting', 'post', 'random'].includes(raw.ctx) ? raw.ctx : 'random'
    if (!within(mgdl, 30, 500)) return { ok: false, error: 'Glucose must be 30–500 mg/dL' }
    return { ok: true, entry: { d, mgdl, ctx } }
  }
  if (type === 'lab') {
    const name = String(raw.name || '').trim().slice(0, 60), value = String(raw.value ?? '').trim().slice(0, 30), unit = String(raw.unit || '').trim().slice(0, 20), ref = String(raw.ref || '').trim().slice(0, 40)
    if (!name) return { ok: false, error: 'Test name is required' }
    if (!value) return { ok: false, error: 'Value is required' }
    return { ok: true, entry: { d, name, value, ...(unit ? { unit } : {}), ...(ref ? { ref } : {}), ...(['high', 'low', 'normal'].includes(raw.flag) ? { flag: raw.flag } : {}) } }
  }
  return { ok: false, error: 'Unknown data type' }
}

// ACC/AHA 2017 categories (adult). Highest of systolic / diastolic category wins.
export function classifyBP(sys, dia) {
  if (sys == null || dia == null) return null
  if (sys >= 140 || dia >= 90) return { id: 'stage2', label: 'Hypertension stage 2 (≥140/90)', tone: 'red' }
  if (sys >= 130 || dia >= 80) return { id: 'stage1', label: 'Hypertension stage 1 (130–139 / 80–89)', tone: 'yellow' }
  if (sys >= 120) return { id: 'elevated', label: 'Elevated (120–129 / <80)', tone: 'yellow' }
  return { id: 'normal', label: 'Normal (<120/80)', tone: 'green' }
}
// Fasting reference (ADA): <100 normal, 100–125 impaired fasting range, ≥126 diabetic range (needs confirmation). Post-meal / random: <140 / <200 flags only.
export function classifyGlucose(mgdl, ctx = 'random') {
  if (mgdl == null) return null
  if (ctx === 'fasting') return mgdl < 70 ? { id: 'low', label: 'Low (<70)', tone: 'red' } : mgdl < 100 ? { id: 'normal', label: 'Normal fasting (70–99)', tone: 'green' } : mgdl < 126 ? { id: 'impaired', label: 'Impaired fasting glucose range (100–125)', tone: 'yellow' } : { id: 'high', label: 'Diabetic range (≥126) — confirm with a doctor', tone: 'red' }
  if (mgdl < 70) return { id: 'low', label: 'Low (<70)', tone: 'red' }
  return mgdl < 140 ? { id: 'normal', label: 'Within the usual range (<140)', tone: 'green' } : mgdl < 200 ? { id: 'elevated', label: 'Elevated (140–199)', tone: 'yellow' } : { id: 'high', label: 'High (≥200) — confirm with a doctor', tone: 'red' }
}

export const byDate = (a) => [...a].sort((x, y) => x.d.localeCompare(y.d))
export const latest = (a) => byDate(a).at(-1) || null
const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null)
const r1 = (x) => (x == null ? null : Math.round(x * 10) / 10)
const addDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10)

// mean over the last `days` days up to `to`
export function windowMean(entries, key, to, days) {
  const from = addDays(to, -days + 1), xs = entries.filter((e) => e.d >= from && e.d <= to && e[key] != null).map((e) => e[key])
  return { n: xs.length, mean: r1(mean(xs)) }
}
// change between the latest weight and the value closest to `days` earlier (needs at least 2 points)
export function weightChange(weights, days = 90) {
  const s = byDate(weights); if (s.length < 2) return null
  const last = s.at(-1), target = addDays(last.d, -days), prior = s.slice(0, -1).reduce((best, e) => (Math.abs(Date.parse(e.d) - Date.parse(target)) < Math.abs(Date.parse(best.d) - Date.parse(target)) ? e : best))
  return { kg: r1(last.kg - prior.kg), since: prior.d }
}
// light touch only: at this body mass, 1 kg ≈ 2–3 s/km in marathon-distance running is a commonly quoted rule of thumb — shown as a rule of thumb, not a prediction
export const paceHintPerKg = 2.5
