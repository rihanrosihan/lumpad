import test from 'node:test'
import assert from 'node:assert/strict'
import { zipSync, strToU8 } from 'fflate'
import { readXlsx, serialToISO, serialToHM } from './xlsx.js'
import { parseHealth, mergeHealth, parseLab, idDate } from './healthimport.js'
import { validate, EMPTY_BIO } from './bio.js'

// a small synthetic workbook with the same layout as the real one (no personal data)
const col = (i) => String.fromCharCode(65 + i)
const sheetXml = (rows, sst) => `<?xml version="1.0"?><worksheet><sheetData>${rows.map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => v == null ? '' : typeof v === 'number' ? `<c r="${col(ci)}${ri + 1}"><v>${v}</v></c>` : `<c r="${col(ci)}${ri + 1}" t="s"><v>${sst(v)}</v></c>`).join('')}</row>`).join('')}</sheetData></worksheet>`
function workbook(sheets) {
  const strings = [], sst = (s) => { let i = strings.indexOf(s); if (i < 0) { strings.push(s); i = strings.length - 1 } return i }, names = Object.keys(sheets)
  const files = { '[Content_Types].xml': strToU8('<Types/>'), 'xl/workbook.xml': strToU8(`<workbook><sheets>${names.map((n, i) => `<sheet name="${n.replace(/&/g, '&amp;')}" sheetId="${i + 1}" r:id="rId${i + 5}"/>`).join('')}</sheets></workbook>`),
    'xl/_rels/workbook.xml.rels': strToU8(`<Relationships>${names.map((n, i) => `<Relationship Id="rId${i + 5}" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}</Relationships>`) }
  names.forEach((n, i) => { files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(sheetXml(sheets[n], sst)) })
  files['xl/sharedStrings.xml'] = strToU8(`<sst>${strings.map((s) => `<si><t>${s.replace(/&/g, '&amp;')}</t></si>`).join('')}</sst>`)
  return zipSync(files)
}
const D = (iso) => Math.round((Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8)) - Date.UTC(1899, 11, 30)) / 864e5)
const BOOK = workbook({
  'Sleep and HRV': [['Date', 'Sleep Quality', 'Bedtime', 'Wake-up Time', 'Total Bed Time', 'Total Sleep', 'Awake time', 'REM Time', 'Light Time', 'Deep Time', 'Awake', 'REM', 'Light', 'Deep', 'Sleep HR', 'Nap Start', 'Nap End', 'Naps', 'Hrv range', 'HRV Average', 'Normal Range'],
    [D('2026-01-15'), 'Fair', 0.125, 0.3389, '5h 8min', '4h 58min', '0h 9min', '1h 1min', '2h 40min', '1h 17min', 0.03, 0.2, 0.52, 0.25, 56, 0.55, 0.58, '0h 47min', 'Calibrating', 100, 'Calibrating'],
    [D('2026-01-16'), 'Great', 0.9153, 0.2083, '7h 2min', '6h 49min', '0h 12min', '2h 15min', '3h 31min', '1h 3min', 0.03, 0.32, 0.5, 0.15, 58, null, null, '0h 0min', 'Normal', 85, '70-110']],
  'Body Composition': [['Date', 'Weight', 'Subcutaneous Whole Body ', 'Subcutaneous Trunk', 'Subcutaneous Arms ', 'Subcutaneous Legs', 'Muscle Whole Body', 'Muscle Trunk', 'Muscle Arms', 'Muscle Legs', 'Body Fat', 'Visceral Fat', 'Lean Body Mass'],
    [D('2026-01-12'), 76.2, 19.2, 17.1, 28.4, 28.5, 31.2, 23.1, 37.7, 48.5, 28.2, 8, 54.7116], [D('2026-01-19'), 75.5, 20.5, 18.3, 30.7, 30.9, 30.5, 21.9, 37.4, 47.8, 28.4, 8, 54.058]],
  'Blood Preasure': [['Tanggal', 'Jenis Pemeriksaan', 'Hasil (mmHg)', 'Catatan'], [D('2025-07-05'), 'Blood Pressure', '119 / 75', '—'], [D('2026-05-02'), 'Blood Pressure', '119/78', null]],
  Glucose: [['Tanggal', 'Jenis Pemeriksaan', 'Hasil (mg/dL)', 'Catatan'], [D('2026-03-31'), 'Glucose', 93, '—'], [D('2026-05-02'), 'Glucose', 156, null]],
  'Medical Checkup': [['Kategori', 'Detail Informasi'], ['Nama Pasien', 'Test Person'], ['Alamat', 'Somewhere 1'], ['Tanggal Pemeriksaan', '19 Januari 2026'], ['Lokasi Klinik', 'Clinic X'], [], ['Item Pemeriksaan', 'Hasil', 'Nilai Normal / Rujukan'],
    ['Berat Badan', '75.5 kg', '60 - 72 kg (Ideal)'], ['Tekanan Darah', '114/68 mmHg', '-'], ['Hemoglobin', '15.0 g/dl', '13.0 - 18.0'], ['Laju Endap Darah (ESR)', '12 mm/hour (Tinggi)', '0 - 10'], ['Eritrosit (RBC)', '5.1 juta/mm³', '4.7 - 6.1'], ['HbA1c (Gula Darah)', '5.1% (Normal)', '< 5.7%'], [],
    ['Jenis Pemeriksaan', 'Hasil / Kesimpulan'], ['EKG (Jantung)', 'Normal resting ECG; Irama sinus (Sinus Rhythm).'], [], ['Kategori', 'Keterangan'], ['Hasil Akhir MCU', 'Good (Baik)'], ['Dokter Pemeriksa', 'dr. A, MKK dan tim spesialis.']],
})

test('readXlsx: sheets, shared strings, numbers, entities', () => {
  const S = readXlsx(BOOK); assert.deepEqual(Object.keys(S), ['Sleep and HRV', 'Body Composition', 'Blood Preasure', 'Glucose', 'Medical Checkup'])
  assert.equal(S.Glucose[1][2], 93); assert.equal(S['Blood Preasure'][1][2], '119 / 75'); assert.equal(serialToISO(S.Glucose[1][0]), '2026-03-31')
  assert.equal(serialToHM(0.125), '03:00'); assert.equal(serialToHM(0.9153), '21:58'); assert.throws(() => readXlsx(zipSync({ 'a.txt': strToU8('x') })), /Not an Excel/)
})
test('parseHealth: every sheet maps to Biometrics entries; personal identifiers are not imported', () => {
  const H = parseHealth(readXlsx(BOOK))
  assert.deepEqual(H.bp, [{ d: '2025-07-05', sys: 119, dia: 75 }, { d: '2026-05-02', sys: 119, dia: 78 }, { d: '2026-01-19', sys: 114, dia: 68 }])
  assert.deepEqual(H.glu, [{ d: '2026-03-31', mgdl: 93, ctx: 'random' }, { d: '2026-05-02', mgdl: 156, ctx: 'random' }])
  assert.equal(H.weight.length, 3); assert.deepEqual(H.weight[1], { d: '2026-01-19', kg: 75.5, bf: 28.4, lbm: 54.1, bc: { sub: 20.5, subTrunk: 18.3, subArms: 30.7, subLegs: 30.9, mus: 30.5, musTrunk: 21.9, musArms: 37.4, musLegs: 47.8, visc: 8 } })
  assert.deepEqual(H.lab.map((l) => [l.name, l.value, l.unit, l.flag]), [['Hemoglobin', '15.0', 'g/dl', undefined], ['ESR', '12', 'mm/hour', 'high'], ['RBC (erythrocytes)', '5.1', 'million/mm³', undefined], ['HbA1c', '5.1', '%', 'normal']])
  assert.equal(H.sleep.length, 2); assert.deepEqual(H.sleep[0], { d: '2026-01-15', q: 'Fair', bed: '03:00', wake: '08:08', inBed: 308, sleep: 298, awake: 9, rem: 61, light: 160, deep: 77, hr: 56, nap: 47, napAt: '13:12', hrv: 100, hrvState: 'Calibrating', hrvNormal: 'Calibrating' })
  assert.deepEqual(H.mcu, { d: '2026-01-19', clinic: 'Clinic X', doctor: 'dr. A, MKK and specialist team.', result: 'Good', finding: '', advice: '', thorax: '', ecg: 'Normal resting ECG, sinus rhythm.' })
  const blob = JSON.stringify(H); assert.ok(!/Test Person|Somewhere/.test(blob))
})
test('mergeHealth: adds only what is new (importing twice changes nothing); existing day values win; manual entries stay', () => {
  const H = parseHealth(readXlsx(BOOK)), manual = { ...EMPTY_BIO, weight: [{ d: '2026-01-19', kg: 75.9 }], bp: [{ d: '2030-01-01', sys: 120, dia: 80 }] }
  const a = mergeHealth(manual, [], [], H)
  assert.deepEqual(a.added, { weight: 1, bp: 3, glu: 2, lab: 4, sleep: 2, mcu: 1 }); assert.equal(a.bio.weight.find((e) => e.d === '2026-01-19').kg, 75.9); assert.ok(a.bio.weight.find((e) => e.d === '2026-01-19').bc) // value kept, details added
  assert.equal(a.bio.bp.length, 4); assert.deepEqual(a.bio.bp.map((e) => e.d), [...a.bio.bp.map((e) => e.d)].sort())
  const b = mergeHealth(a.bio, a.sleep, a.mcu, H); assert.deepEqual(b.added, { weight: 0, bp: 0, glu: 0, lab: 0, sleep: 0, mcu: 0 }); assert.deepEqual(b.bio, a.bio)
  for (const e of a.bio.weight) assert.ok(validate('weight', e).ok, 'weight ' + e.d); for (const e of a.bio.bp) assert.ok(validate('bp', e).ok); for (const e of a.bio.glu) assert.ok(validate('glu', e).ok); for (const e of a.bio.lab) assert.ok(validate('lab', e).ok)
})
test('parseLab / idDate / validate keeps body-composition details and lab flags', () => {
  assert.deepEqual(parseLab('Asam Urat', '6.6 mg/dl', '3.4 - 7.0'), { name: 'Uric acid', value: '6.6', unit: 'mg/dl', ref: '3.4 - 7.0' }); assert.equal(parseLab('x', 'negatif', ''), null)
  assert.equal(idDate('19 Januari 2026'), '2026-01-19'); assert.equal(idDate('7 Agustus 2027'), '2027-08-07'); assert.equal(idDate('soon'), null)
  assert.deepEqual(validate('weight', { d: '2026-01-19', kg: 75.5, bc: { mus: 30.5, junk: 9, visc: 8 } }).entry.bc, { mus: 30.5, visc: 8 })
  assert.equal(validate('lab', { d: '2026-01-19', name: 'ESR', value: '12', flag: 'high' }).entry.flag, 'high'); assert.equal(validate('lab', { d: '2026-01-19', name: 'ESR', value: '12', flag: 'zzz' }).entry.flag, undefined)
})
