// Biometrics: body weight / composition, blood pressure, blood glucose and lab values. Pure functions only; the page keeps the logs
// in the synced store (server KV), never in the repo. Classifications use general reference ranges and are information, not diagnosis.
export const EMPTY_BIO = { weight: [], bp: [], glu: [], lab: [] }

const num = (x) => (x === '' || x == null ? null : Number(x))
const okDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d))
const within = (v, a, b) => v != null && Number.isFinite(v) && v >= a && v <= b

// → { ok:true, entry } | { ok:false, error }
export function validate(type, raw) {
  const d = raw.d
  if (!okDate(d)) return { ok: false, error: 'Tanggal tidak valid' }
  if (type === 'weight') {
    const kg = num(raw.kg), bf = num(raw.bf), lbm = num(raw.lbm)
    if (!within(kg, 30, 200)) return { ok: false, error: 'Berat harus 30–200 kg' }
    if (bf != null && !within(bf, 3, 60)) return { ok: false, error: 'Lemak tubuh harus 3–60 %' }
    if (lbm != null && !within(lbm, 20, 150)) return { ok: false, error: 'Massa tanpa lemak harus 20–150 kg' }
    return { ok: true, entry: { d, kg, ...(bf != null ? { bf } : {}), ...(lbm != null ? { lbm } : {}) } }
  }
  if (type === 'bp') {
    const sys = num(raw.sys), dia = num(raw.dia), pulse = num(raw.pulse)
    if (!within(sys, 70, 250)) return { ok: false, error: 'Sistolik harus 70–250 mmHg' }
    if (!within(dia, 40, 150)) return { ok: false, error: 'Diastolik harus 40–150 mmHg' }
    if (sys <= dia) return { ok: false, error: 'Sistolik harus lebih besar dari diastolik' }
    if (pulse != null && !within(pulse, 25, 220)) return { ok: false, error: 'Nadi harus 25–220 bpm' }
    return { ok: true, entry: { d, sys, dia, ...(pulse != null ? { pulse } : {}) } }
  }
  if (type === 'glu') {
    const mgdl = num(raw.mgdl), ctx = ['fasting', 'post', 'random'].includes(raw.ctx) ? raw.ctx : 'random'
    if (!within(mgdl, 30, 500)) return { ok: false, error: 'Glukosa harus 30–500 mg/dL' }
    return { ok: true, entry: { d, mgdl, ctx } }
  }
  if (type === 'lab') {
    const name = String(raw.name || '').trim().slice(0, 60), value = String(raw.value ?? '').trim().slice(0, 30), unit = String(raw.unit || '').trim().slice(0, 20), ref = String(raw.ref || '').trim().slice(0, 40)
    if (!name) return { ok: false, error: 'Nama pemeriksaan wajib diisi' }
    if (!value) return { ok: false, error: 'Nilai wajib diisi' }
    return { ok: true, entry: { d, name, value, ...(unit ? { unit } : {}), ...(ref ? { ref } : {}) } }
  }
  return { ok: false, error: 'Jenis data tidak dikenal' }
}

// ACC/AHA 2017 categories (adult). Highest of systolic / diastolic category wins.
export function classifyBP(sys, dia) {
  if (sys == null || dia == null) return null
  if (sys >= 140 || dia >= 90) return { id: 'stage2', label: 'Hipertensi tahap 2 (≥140/90)', tone: 'red' }
  if (sys >= 130 || dia >= 80) return { id: 'stage1', label: 'Hipertensi tahap 1 (130–139 / 80–89)', tone: 'yellow' }
  if (sys >= 120) return { id: 'elevated', label: 'Meningkat (120–129 / <80)', tone: 'yellow' }
  return { id: 'normal', label: 'Normal (<120/80)', tone: 'green' }
}
// Fasting reference (ADA): <100 normal, 100–125 impaired fasting range, ≥126 diabetic range (needs confirmation). Post-meal / random: <140 / <200 flags only.
export function classifyGlucose(mgdl, ctx = 'random') {
  if (mgdl == null) return null
  if (ctx === 'fasting') return mgdl < 70 ? { id: 'low', label: 'Rendah (<70)', tone: 'red' } : mgdl < 100 ? { id: 'normal', label: 'Normal puasa (70–99)', tone: 'green' } : mgdl < 126 ? { id: 'impaired', label: 'Rentang gangguan glukosa puasa (100–125)', tone: 'yellow' } : { id: 'high', label: 'Rentang diabetes (≥126) — konfirmasi ke dokter', tone: 'red' }
  if (mgdl < 70) return { id: 'low', label: 'Rendah (<70)', tone: 'red' }
  return mgdl < 140 ? { id: 'normal', label: 'Dalam rentang umum (<140)', tone: 'green' } : mgdl < 200 ? { id: 'elevated', label: 'Meningkat (140–199)', tone: 'yellow' } : { id: 'high', label: 'Tinggi (≥200) — konfirmasi ke dokter', tone: 'red' }
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
