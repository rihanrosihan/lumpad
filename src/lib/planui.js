// Pure helpers for the Plan engine screen (tested in planui.test.js). No React, no fetch.
const DOW = [1, 2, 3, 4, 5, 6, 0] // Monday first
export const DOW_NAMES = { 0: 'Sunday', 1: 'Monday', 2: 'Tuesday', 3: 'Wednesday', 4: 'Thursday', 5: 'Friday', 6: 'Saturday' }
export const PREFS = [['', 'No preference'], ['long', 'Long run'], ['quality', 'Quality'], ['rest', 'Rest']]
const r1 = (x) => Math.round(x * 10) / 10

// macro proposal summary -> bars for the weekly km chart (old vs new), weeks from the proposal's start on
export function weeklySeries(summary) {
  if (!summary?.weeks_after) return []
  const b = summary.weeks_before || {}, a = summary.weeks_after, from = summary.start || '0000'
  return Object.keys(a).filter((m) => m >= from).sort().map((m) => ({ monday: m, before: r1(b[m] ?? 0), after: r1(a[m]) }))
}
// diff rows -> groups by ISO week (Monday), for a readable list
export function diffGroups(diff = []) {
  const mon = (d) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7)); return x.toISOString().slice(0, 10) }
  const g = new Map(); for (const r of [...diff].sort((a, b) => a.date.localeCompare(b.date))) { const m = mon(r.date); if (!g.has(m)) g.set(m, []); g.get(m).push(r) }
  return [...g].map(([monday, days]) => ({ monday, days, delta: r1(days.reduce((s, d) => s + ((d.after?.km ?? 0) - (d.before?.km ?? 0)), 0)) }))
}
export const dayText = (x) => (!x ? '—' : x.kind === 'rest' ? 'Rest' : `${x.label || x.kind}${x.km ? ` · ${x.km} km` : ''}`)

// availability: API {rules:[{dow,windows,pref}], exceptions:{date:windows}} <-> form rows
export function availabilityToForm(data) {
  const by = Object.fromEntries((data?.rules || []).map((r) => [r.dow, r]))
  const rows = DOW.map((dow) => { const r = by[dow]; return { dow, minutes: !r ? '' : r.windows.length === 0 ? '0' : String(Math.max(...r.windows.map((w) => w.max_min ?? 600))), pref: r ? Object.keys(r.pref || {}).find((k) => r.pref[k]) || '' : '' } })
  const ex = Object.entries(data?.exceptions || {}).map(([date, w]) => ({ date, minutes: w.length === 0 ? '0' : String(Math.max(...w.map((x) => x.max_min ?? 600))) })).sort((a, b) => a.date.localeCompare(b.date))
  return { rows, exceptions: ex }
}
const win = (m) => (m === '0' || m === 0 ? [] : [{ max_min: +m }])
export function availabilityToPayload({ rows, exceptions }) {
  const errs = [], bad = (m) => m !== '' && m !== '0' && !(Number.isInteger(+m) && +m >= 10 && +m <= 600)
  const rules = []
  for (const r of rows) { if (bad(r.minutes)) errs.push(`${DOW_NAMES[r.dow]}: minutes must be 0 (closed) or 10–600`); if (r.minutes === '' && !r.pref) continue
    rules.push({ dow: r.dow, windows: r.minutes === '' ? [{ max_min: 600 }] : win(r.minutes), pref: r.pref ? { [r.pref]: true } : {} }) }
  const exc = {}
  for (const e of exceptions) { if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date || '')) { errs.push(`exception "${e.date || ''}": pick a date`); continue } if (e.minutes === '' || bad(e.minutes)) { errs.push(`${e.date}: minutes must be 0 (closed) or 10–600`); continue } exc[e.date] = win(e.minutes) }
  return { errors: errs, payload: { rules, exceptions: exc } }
}
// goals
export const GOAL_CLASSES = [['A', 'A · goal race'], ['B', 'B · target race'], ['C', 'C · for experience'], ['D', 'D · no target']]
export const fmtTarget = (s) => (s == null ? 'finish' : `sub ${Math.floor((s + 1) / 3600)}:${String(Math.round(((s + 1) % 3600) / 60)).padStart(2, '0')}`)
export const fmtDist = (m) => (m >= 42000 ? 'Marathon' : m >= 21000 && m < 22000 ? 'Half' : `${r1(m / 1000)} km`)
export function goalToPayload(f) {
  const errs = [], dist = +f.distance_km * 1000
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.race_date || '')) errs.push('date is required'); if (!String(f.name || '').trim()) errs.push('name is required'); if (!(dist >= 1000)) errs.push('distance must be at least 1 km')
  let target = null; if (String(f.target_h ?? '').trim() !== '') { const h = +f.target_h; if (!(h >= 0.2 && h <= 24)) errs.push('target must be between 0.2 and 24 hours'); else target = Math.round(h * 3600) }
  const params = {}; if (String(f.peak_cap_km ?? '').trim() !== '') params.peak_cap_km = +f.peak_cap_km; if (f.guard_baseline) params.guard_baseline = f.guard_baseline; if (String(f.cutback_ratio ?? '').trim() !== '') params.cutback_ratio = +f.cutback_ratio
  return { errors: errs, payload: { ...(f.id ? { id: f.id } : {}), race_date: f.race_date, name: String(f.name || '').trim(), cls: f.cls, distance_m: dist, target_s: target, params, status: f.status || 'active' } }
}
export const goalToForm = (g) => ({ id: g.id, race_date: g.race_date, name: g.name, cls: g.cls, distance_km: String(r1(g.distance_m / 1000)), target_h: g.target_s == null ? '' : String(r1(g.target_s / 3600)), peak_cap_km: g.params?.peak_cap_km ?? '', guard_baseline: g.params?.guard_baseline ?? '', cutback_ratio: g.params?.cutback_ratio ?? '', status: g.status })
export const blankGoal = () => ({ race_date: '', name: '', cls: 'C', distance_km: '42.2', target_h: '', peak_cap_km: '', guard_baseline: '', cutback_ratio: '', status: 'active' })
// proposal chip text
export const proposalKind = (p) => (p.loop === 'macro' ? 'Season plan' : (p.operators || []).join(' + ') || p.loop)
