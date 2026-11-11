// Plan helpers. Dates are local-time ISO strings (YYYY-MM-DD) — never toISOString(), which shifts to UTC
// (at 05:00 WIB that would be "yesterday").
import PLAN from '../data/plan.json'
export { PLAN }
export const BY_DATE = Object.fromEntries(PLAN.map((d) => [d.date, d]))
export const pad = (n) => String(n).padStart(2, '0')
export const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
export const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d, 12) }
export const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return iso(d) }
export const diffDays = (a, b) => Math.round((parse(a) - parse(b)) / 864e5)
export const dow = (s) => parse(s).getDay() // 0 = Sunday
export const mondayOf = (s) => addDays(s, -((dow(s) + 6) % 7))
// ?today=2027-03-23 previews any date (handy for testing)
export function today() { const q = new URLSearchParams(location.search).get('today'); return /^\d{4}-\d{2}-\d{2}$/.test(q || '') ? q : iso(new Date()) }
export const DAYS = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu']
export const DAYS3 = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab']
export const MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember']
export const MON3 = MONTHS.map((m) => m.slice(0, 3))
export const fmtLong = (s) => { const d = parse(s); return `${DAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}` }
export const fmtShort = (s) => { const d = parse(s); return `${d.getDate()} ${MON3[d.getMonth()]}` }

export const KIND = {
  easy: { label: 'Easy', short: 'E' }, social: { label: 'Social / easy', short: 'S' }, long: { label: 'Long run', short: 'L' },
  quality: { label: 'Quality', short: 'Q' }, speed: { label: 'Speed ringan', short: 'Sp' }, tt: { label: 'Time trial', short: 'TT' },
  race: { label: 'Race', short: 'R' }, rest: { label: 'Rest', short: '–' }, gym: { label: 'Gym only', short: 'G' },
}
export const RACE_DATE = '2027-10-24'
export const PLAN_START = PLAN[0].date

export { STRENGTH_TAGS, strengthOf, isLowerDay } from './strength.js'

// Weeks (W0…W52) with planned km and phase
export const WEEKS = (() => {
  const m = new Map()
  for (const d of PLAN) {
    if (!m.has(d.week)) m.set(d.week, { id: d.week, phase: d.phase, start: d.date, km: 0, days: [] })
    const w = m.get(d.week); w.km += d.km; w.days.push(d)
  }
  return [...m.values()].map((w) => ({ ...w, km: Math.round(w.km * 10) / 10 }))
})()
export const weekOf = (date) => WEEKS.find((w) => w.days.some((d) => d.date === date))
export const PHASE_NAME = { 'OFF-SEASON': 'Off-season', RAMADAN: 'Ramadan', BASE: 'Base', BUILD: 'Build', 'C-RACE': 'C-race', RECOVERY: 'Recovery', PEAK: 'Peak', TAPER: 'Taper', 'RACE WEEK': 'Race week' }
