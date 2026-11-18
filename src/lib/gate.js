// Daily gate engine. green = go, yellow = scale down, red = swap to easy / rest.
import { isLowerDay } from './strength.js'
export const EMPTY_DAY = { sleepHR: '', hrv: '', pain: '', painSites: {}, energy: '', tibia: false, te: '', mealBufferMin: '', plannedMin: '', fasted: false, override: '' }
export const HARD = new Set(['quality', 'tt', 'long', 'race'])
export const hasInput = (f) => f.sleepHR !== '' || f.hrv !== '' || f.pain !== '' || f.te !== '' || f.tibia || f.mealBufferMin !== ''
const ORDER = { green: 0, yellow: 1, red: 2 }

// sess = plan day ({kind, tags}) or null when no plan for that date
export function evaluate(f, sess) {
  const kind = sess?.kind || 'easy', hard = HARD.has(kind), reasons = []
  let level = 'green'
  const bump = (l, msg) => { reasons.push({ level: l, msg }); if (ORDER[l] > ORDER[level]) level = l }
  if (f.sleepHR !== '' && f.sleepHR > 67) hard ? bump('red', `Sleep HR ${f.sleepHR} > 67 → no hard running`) : bump('yellow', `Sleep HR ${f.sleepHR} > 67 — easy is still fine, keep watching`)
  if (f.hrv === 'reduced' && (kind === 'quality' || kind === 'tt')) bump('yellow', 'HRV Reduced + quality session → drop to easy')
  if (f.te !== '' && f.te >= 5 && f.hrv === 'reduced') bump('red', 'TE ≥5.0 and HRV Reduced → cancel the hard session')
  if (f.pain !== '' && f.pain >= 2) bump('red', `Pain ${f.pain}/10 ≥2 → durability event: short strides / run-walk / finish-first`)
  if (f.tibia && isLowerDay(sess)) bump('yellow', 'Tibia tender → postpone/reduce Lower; tibialis stays position 1')
  if (f.mealBufferMin !== '' && f.mealBufferMin < 90 && hard) bump('yellow', `Meal buffer ${f.mealBufferMin} min < 90 → snack must be low-fibre`)
  if (f.fasted && f.plannedMin !== '' && f.plannedMin > 45) bump('red', 'Fasted only for easy ≤45 min / 5–6 km')
  if (f.plannedMin !== '' && f.plannedMin > 90) reasons.push({ level: 'info', msg: 'Run >90 min: CHO 30–60 g/h from minute 45' })
  return { level, reasons }
}
// Weekly ◇ tempo gate from the last 7 days of records
export function weeklyGate(records) {
  const bad = records.filter((r) => (r.sleepHR !== '' && r.sleepHR > 67) || r.hrv === 'reduced').length
  const pain = records.some((r) => (r.pain !== '' && r.pain >= 2) || r.tibia)
  return { bad, pain, blocked: bad >= 2 || pain }
}
