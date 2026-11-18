// "Health Dictionary" workbook → entries for the Biometrics store. Sheets (matched by name): Sleep and HRV · Body Composition ·
// Blood Pressure · Glucose · Medical Checkup. Pure: takes readXlsx() output. Personal identifiers (name, birth date, address, record
// numbers) are deliberately NOT imported. Data is merged into the synced store (server KV), never written into the repository.
import { serialToISO, serialToHM } from './serial.js'

const num = (x) => (typeof x === 'number' ? x : x == null || x === '' ? null : Number(String(x).replace(',', '.').replace(/[^\d.+-]/g, '')) || null)
const r1 = (x) => (x == null ? null : Math.round(x * 10) / 10)
const sheet = (S, re) => { const k = Object.keys(S).find((n) => re.test(n)); return k ? S[k] : null }
const head = (rows) => { const h = (rows[0] || []).map((x) => String(x ?? '').trim().toLowerCase()); return (n) => h.indexOf(n.toLowerCase()) }
const dur = (s) => { const m = String(s ?? '').match(/(\d+)\s*h\s*(\d+)\s*min/i); return m ? +m[1] * 60 + +m[2] : null }
const ID_MONTH = { januari: 1, februari: 2, maret: 3, april: 4, mei: 5, juni: 6, juli: 7, agustus: 8, september: 9, oktober: 10, november: 11, desember: 12 }
export const idDate = (s) => { const m = String(s || '').match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/); const mo = m && ID_MONTH[m[2].toLowerCase()]; return mo ? `${m[3]}-${String(mo).padStart(2, '0')}-${String(+m[1]).padStart(2, '0')}` : null }

const LAB_EN = { 'tinggi badan': 'Height', 'indeks massa tubuh (bmi)': 'BMI', hemoglobin: 'Hemoglobin', 'leukosit (wbc)': 'WBC (leukocytes)', 'eritrosit (rbc)': 'RBC (erythrocytes)', 'laju endap darah (esr)': 'ESR', eosinofil: 'Eosinophils',
  'kolesterol total': 'Total cholesterol', 'ldl (kolesterol jahat)': 'LDL cholesterol', 'hdl (kolesterol baik)': 'HDL cholesterol', trigliserida: 'Triglycerides', 'asam urat': 'Uric acid', creatinine: 'Creatinine', 'hba1c (gula darah)': 'HbA1c' }
const FLAG = { tinggi: 'high', rendah: 'low', normal: 'normal', overweight: 'high', ideal: 'normal' }
const UNIT_EN = (u) => u.replace(/^juta/, 'million')
export function parseLab(name, result, ref) {
  const m = String(result ?? '').trim().match(/^([<>]?\s*[\d.,]+)\s*(%|[^\s(%]+)?\s*(?:\(([^)]+)\))?\s*$/)
  if (!m) return null
  const flag = m[3] ? FLAG[m[3].trim().toLowerCase()] : null, ref0 = ref && ref !== '-' ? String(ref).replace(/\s*\(Ideal\)/i, '').trim() : ''
  return { name: LAB_EN[String(name).trim().toLowerCase()] || String(name).trim(), value: m[1].replace(/\s/g, ''), ...(m[2] ? { unit: UNIT_EN(m[2]) } : {}), ...(ref0 ? { ref: ref0 } : {}), ...(flag ? { flag } : {}) }
}
const NARR_EN = { 'Dalam batas normal; tidak ada tanda penyakit paru aktif atau pembesaran jantung.': 'Normal chest X-ray: no sign of active lung disease or an enlarged heart.', 'Normal resting ECG; Irama sinus (Sinus Rhythm).': 'Normal resting ECG, sinus rhythm.',
  'Good (Baik)': 'Good', 'Kelebihan berat badan (Overweight) berdasarkan BMI 24.14.': 'Overweight by BMI (24.14).',
  'Menurunkan berat badan dengan olahraga rutin (3-4 kali/minggu, 30-45 menit) dan konsumsi makanan rendah lemak/kalori.': 'Lose weight with regular exercise (3–4 times a week, 30–45 minutes) and a low-fat, low-calorie diet.' }
const en = (s) => NARR_EN[String(s).trim()] || String(s).trim()

export function parseHealth(S) {
  const out = { weight: [], bp: [], glu: [], lab: [], sleep: [], mcu: null, notes: [] }
  // Body composition
  const bc = sheet(S, /body/i)
  if (bc) { const ix = head(bc), c = (r, n) => num(r[ix(n)]); for (const r of bc.slice(1)) { const d = serialToISO(r[ix('date')]); if (!d || c(r, 'weight') == null) continue
    const o = { d, kg: c(r, 'weight'), bf: c(r, 'body fat'), lbm: r1(c(r, 'lean body mass')) }
    const det = { sub: c(r, 'subcutaneous whole body'), subTrunk: c(r, 'subcutaneous trunk'), subArms: c(r, 'subcutaneous arms'), subLegs: c(r, 'subcutaneous legs'), mus: c(r, 'muscle whole body'), musTrunk: c(r, 'muscle trunk'), musArms: c(r, 'muscle arms'), musLegs: c(r, 'muscle legs'), visc: c(r, 'visceral fat') }
    for (const k of Object.keys(det)) if (det[k] == null) delete det[k]
    out.weight.push({ ...o, ...(Object.keys(det).length ? { bc: det } : {}) }) } }
  // Blood pressure ("119 / 75" or "119/78")
  const bp = sheet(S, /blood|pressure|preasure|tekanan/i)
  if (bp) for (const r of bp.slice(1)) { const d = serialToISO(r[0]), m = String(r[2] ?? '').match(/(\d{2,3})\s*\/\s*(\d{2,3})/); if (d && m) out.bp.push({ d, sys: +m[1], dia: +m[2] }) }
  // Glucose (mg/dL; the sheet does not say fasting or not → "random")
  const gl = sheet(S, /gluc/i)
  if (gl) for (const r of gl.slice(1)) { const d = serialToISO(r[0]), v = num(r[2]); if (d && v != null) out.glu.push({ d, mgdl: v, ctx: 'random' }) }
  // Sleep and HRV
  const sl = sheet(S, /sleep/i)
  if (sl) { const ix = head(sl), g = (r, n) => r[ix(n)]; for (const r of sl.slice(1)) { const d = serialToISO(g(r, 'date')); if (!d) continue
    const e = { d, q: g(r, 'sleep quality') || undefined, bed: serialToHM(g(r, 'bedtime')) || undefined, wake: serialToHM(g(r, 'wake-up time')) || undefined, inBed: dur(g(r, 'total bed time')), sleep: dur(g(r, 'total sleep')), awake: dur(g(r, 'awake time')), rem: dur(g(r, 'rem time')), light: dur(g(r, 'light time')), deep: dur(g(r, 'deep time')),
      hr: num(g(r, 'sleep hr')), nap: dur(g(r, 'naps')) || undefined, napAt: serialToHM(g(r, 'nap start')) || undefined, hrv: num(g(r, 'hrv average')), hrvState: typeof g(r, 'hrv range') === 'string' ? g(r, 'hrv range') : undefined, hrvNormal: typeof g(r, 'normal range') === 'string' ? g(r, 'normal range') : undefined }
    for (const k of Object.keys(e)) if (e[k] == null || e[k] === '') delete e[k]
    out.sleep.push(e) } }
  // Medical checkup
  const mc = sheet(S, /medical|checkup|mcu/i)
  if (mc) {
    const kv = {}; let section = ''
    for (const r of mc) { const a = r[0] == null ? '' : String(r[0]).trim(), b = r[1], c = r[2]
      if (!a) continue
      if (/item pemeriksaan/i.test(a)) { section = 'items'; continue }
      if (/jenis pemeriksaan/i.test(a)) { section = 'imaging'; continue }
      if (/^kategori$/i.test(a)) { section = 'summary'; continue }
      if (section === 'items' && b != null) { const l = parseLab(a, b, c); kv[a] = { raw: String(b), ...(l ? { l } : {}), item: true } }
      else if (b != null) kv[a] = { raw: String(b) } }
    const d = idDate(kv['Tanggal Pemeriksaan']?.raw)
    if (d) {
      for (const [k, v] of Object.entries(kv).filter(([, x]) => x.item)) {
        if (/tekanan darah/i.test(k)) { const m = v.raw.match(/(\d{2,3})\s*\/\s*(\d{2,3})/); if (m) out.bp.push({ d, sys: +m[1], dia: +m[2] }); continue }
        if (!v.l) continue
        if (/berat badan/i.test(k)) { const kg = num(v.l.value); if (kg) out.weight.push({ d, kg }); continue }
        out.lab.push({ d, ...v.l })
      }
      const s = (k) => (kv[k]?.raw ? { en: en(kv[k].raw), orig: kv[k].raw } : null)
      out.mcu = { d, clinic: kv['Lokasi Klinik']?.raw || '', doctor: String(kv['Dokter Pemeriksa']?.raw || '').replace(/\s+dan tim spesialis/i, ' and specialist team'), result: s('Hasil Akhir MCU')?.en || '', finding: s('Temuan Utama')?.en || '', advice: s('Saran Dokter')?.en || '', thorax: s('Thorax (Rontgen Dada)')?.en || '', ecg: s('EKG (Jantung)')?.en || '' }
    } else out.notes.push('Medical Checkup sheet: examination date not found — skipped')
  }
  return out
}

// merge into the stored logs; returns { bio, sleep, mcu, added: {weight,bp,glu,lab,sleep,mcu} }
const byD = (a) => [...a].sort((x, y) => x.d.localeCompare(y.d))
export function mergeHealth(bio, sleepLog, mcuLog, inc) {
  const B = { weight: [], bp: [], glu: [], lab: [], ...bio }, added = { weight: 0, bp: 0, glu: 0, lab: 0, sleep: 0, mcu: 0 }
  const w = new Map(B.weight.map((e) => [e.d, e]))
  for (const e of inc.weight) { const o = w.get(e.d); if (!o) { added.weight++; w.set(e.d, e) } else w.set(e.d, { ...e, ...o, ...(e.bc ? { bc: e.bc } : {}) }) } // an existing value for the day wins, composition details are added
  const key = { bp: (e) => `${e.d}|${e.sys}|${e.dia}`, glu: (e) => `${e.d}|${e.mgdl}`, lab: (e) => `${e.d}|${e.name}` }
  const res = { weight: byD([...w.values()]) }
  for (const t of ['bp', 'glu', 'lab']) { const seen = new Set(B[t].map(key[t])), add = inc[t].filter((e) => !seen.has(key[t](e)) && seen.add(key[t](e))); added[t] = add.length; res[t] = byD([...B[t], ...add]) }
  const sl = new Map((sleepLog || []).map((e) => [e.d, e])); for (const e of inc.sleep) { if (!sl.has(e.d)) added.sleep++; sl.set(e.d, { ...sl.get(e.d), ...e }) }
  const mc = new Map((mcuLog || []).map((e) => [e.d, e])); if (inc.mcu) { if (!mc.has(inc.mcu.d)) added.mcu++; mc.set(inc.mcu.d, inc.mcu) }
  return { bio: { ...B, ...res }, sleep: byD([...sl.values()]), mcu: byD([...mc.values()]), added }
}
