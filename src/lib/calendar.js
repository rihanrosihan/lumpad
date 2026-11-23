// Plan helpers. Dates are local-time ISO strings (YYYY-MM-DD) — never toISOString(), which shifts to UTC
// (at 05:00 WIB that would be "yesterday").
import BUNDLED from '../data/plan.json' with { type: 'json' }
import { planApiEnabled, choosePlan } from './planapi.js'
// The plan is the bundled file unless the opt-in server path is on and a valid cached server plan exists (see planapi.js). Chosen once at import time,
// so every module sees the same plan; the exported containers are filled in place by derive().
const store = (() => { try { return typeof localStorage !== 'undefined' ? localStorage : null } catch { return null } })()
export const PLAN_ENABLED = planApiEnabled(import.meta.env || {}, store, typeof location !== 'undefined' ? location.search : '')
const CHOSEN = choosePlan(BUNDLED, { enabled: PLAN_ENABLED, storage: store })
export const PLAN_SOURCE = CHOSEN.source
export const PLAN = [...CHOSEN.days]
export const BY_DATE = {}
export const pad = (n) => String(n).padStart(2, '0')
export const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
export const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d, 12) }
export const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return iso(d) }
export const diffDays = (a, b) => Math.round((parse(a) - parse(b)) / 864e5)
export const dow = (s) => parse(s).getDay() // 0 = Sunday
export const mondayOf = (s) => addDays(s, -((dow(s) + 6) % 7))
// ?today=2027-03-23 previews any date (handy for testing)
export function today() { const q = new URLSearchParams(location.search).get('today'); return /^\d{4}-\d{2}-\d{2}$/.test(q || '') ? q : iso(new Date()) }
export const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
export const DAYS3 = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
export const MON3 = MONTHS.map((m) => m.slice(0, 3))
export const fmtLong = (s) => { const d = parse(s); return `${DAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}` }
export const fmtShort = (s) => { const d = parse(s); return `${MON3[d.getMonth()]} ${d.getDate()}` }

export const KIND = {
  easy: { label: 'Easy', short: 'E' }, social: { label: 'Social / easy', short: 'S' }, long: { label: 'Long run', short: 'L' },
  quality: { label: 'Quality', short: 'Q' }, speed: { label: 'Light speed', short: 'Sp' }, tt: { label: 'Time trial', short: 'TT' },
  race: { label: 'Race', short: 'R' }, rest: { label: 'Rest', short: '–' }, gym: { label: 'Gym only', short: 'G' },
}
export const RACE_DATE = '2027-10-24'

export { STRENGTH_TAGS, strengthOf, isLowerDay } from './strength.js'

// Weeks (W0…W52) with planned km and phase
export const WEEKS = []
export const weekOf = (date) => WEEKS.find((w) => w.days.some((d) => d.date === date))
export const PHASE_NAME = { 'PRE-SEASON': 'Pre-season', 'OFF-SEASON': 'Off-season', RAMADAN: 'Ramadan', BASE: 'Base', BUILD: 'Build', 'C-RACE': 'C-race', RECOVERY: 'Recovery', PEAK: 'Peak', TAPER: 'Taper', 'RACE WEEK': 'Race week' }

// Calendar months covered by the plan (Nov 2026 → Dec 2027): [{ key:'2026-11', y, m (0–11) }]
export const PLAN_MONTHS = []
export const monthLabel = (mo) => `${MONTHS[mo.m]} ${mo.y}`
export let PLAN_START, PLAN_END, PLAN_KM
// derive everything from PLAN (runs once at import; live bindings and in-place containers keep importers consistent)
function derive() {
  for (const k of Object.keys(BY_DATE)) delete BY_DATE[k]
  for (const d of PLAN) BY_DATE[d.date] = d
  const m = new Map()
  for (const d of PLAN) { if (!m.has(d.week)) m.set(d.week, { id: d.week, phase: d.phase, start: d.date, km: 0, days: [] }); const w = m.get(d.week); w.km += d.km; w.days.push(d) }
  WEEKS.length = 0; WEEKS.push(...[...m.values()].map((w) => ({ ...w, km: Math.round(w.km * 10) / 10 })))
  const seen = new Set(); PLAN_MONTHS.length = 0
  for (const d of PLAN) { const key = d.date.slice(0, 7); if (!seen.has(key)) { seen.add(key); PLAN_MONTHS.push({ key, y: +key.slice(0, 4), m: +key.slice(5, 7) - 1 }) } }
  PLAN_START = PLAN[0].date; PLAN_END = PLAN.at(-1).date; PLAN_KM = Math.round(PLAN.reduce((a, d) => a + d.km, 0))
}
derive()
