// Daily gate engine. Levels: green (jalankan) / yellow (turunkan) / red (ganti easy/istirahat).
import { TEMPLATE } from './plan.js'
export function evaluate({ sleepHR, hrv, pain, tibia, te, mealBufferMin, plannedMin, fasted }, day) {
  const t = TEMPLATE[day], reasons = []
  let level = 'green'
  const bump = (l, msg) => { reasons.push(msg); if (l === 'red' || level === 'green') level = l === 'red' ? 'red' : level === 'red' ? 'red' : 'yellow' }
  const hard = t.quality || t.long
  if (sleepHR !== '' && sleepHR > 67) hard ? bump('red', `Sleep HR ${sleepHR} > 67 → tidak ada lari keras`) : bump('yellow', `Sleep HR ${sleepHR} > 67 (sesi easy tetap boleh, pantau)`)
  if (hrv === 'reduced' && t.quality) bump('yellow', 'HRV Reduced + sesi quality → turunkan ke easy')
  if (te !== '' && te >= 5 && hrv === 'reduced') bump('red', 'TE ≥5,0 dan HRV Reduced → batalkan sesi keras')
  if (pain !== '' && pain >= 2) bump('red', `Nyeri ${pain}/10 ≥2 → durability event: stride pendek / run-walk / finish-first`)
  if (tibia && (day === 2 || day === 4)) bump('yellow', 'Tibia nyeri tekan → tunda/kurangi Lower; tibialis tetap posisi 1')
  if (mealBufferMin !== '' && mealBufferMin < 90 && hard) bump('yellow', `Buffer makan ${mealBufferMin} mnt < 90 → snack harus low-fiber`)
  if (fasted && plannedMin !== '' && plannedMin > 45) bump('red', 'Fasted hanya easy ≤45 menit / 5–6 km')
  if (plannedMin !== '' && plannedMin > 90) reasons.push('Run >90 menit: CHO 30–60 g/jam mulai menit 45')
  return { level, reasons }
}
