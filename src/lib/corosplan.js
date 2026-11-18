// COROS training-plan overlay. COROS only exposes the *scheduled runs* (date, distance, estimated time, load) — no names,
// no strength, no rest markers — so everything else here is derived and labelled as such.
// Rows: { date:'YYYY-MM-DD', km:number|null, sec:number|null, tl:number|null, code?:string }
import { diffDays, mondayOf } from './dates.js'

// Plan windows as reported by COROS (the three active execution plans). Windows overlap by design of the templates.
export const COROS_PLANS = [
  { id: 'A', label: 'Plan A · 20 weeks', from: '2026-11-23', to: '2027-04-18' },
  { id: 'B', label: 'Plan B · 12 weeks', from: '2027-04-12', to: '2027-07-11' },
  { id: 'C', label: 'Plan C · 12 weeks', from: '2027-07-05', to: '2027-10-02' },
]

export const parseSnapshot = (txt) => String(txt).split('\n').filter((l) => l.trim() && !l.startsWith('#')).map((l) => {
  const [date, code, km, t, tl] = l.trim().split(/\s+/), n = (v) => (v === '-' || v == null ? null : Number(v))
  const sec = t && t !== '-' ? t.split(':').reduce((a, x) => a * 60 + Number(x), 0) : null
  return { date, code, km: n(km), sec, tl: n(tl) }
})

// Type from distance + load density (TL per hour). COROS hides the workout structure, so this is a heuristic:
//  ≥40 km = marathon-distance day · longest run of its week (≥12 km) = long · TL/h ≥ 110 = quality · otherwise easy.
export function classify(rows) {
  const byWeek = {}; for (const r of rows) if (r.km) { const w = mondayOf(r.date); byWeek[w] = Math.max(byWeek[w] || 0, r.km) }
  return rows.map((r) => {
    const tlph = r.tl && r.sec ? r.tl / (r.sec / 3600) : null, hard = tlph != null && tlph >= 110
    let type = 'easy'
    if (!r.km) type = 'free'
    else if (r.km >= 40) type = 'race'
    else if (r.km >= 12 && r.km === byWeek[mondayOf(r.date)]) type = 'long'
    else if (hard) type = 'quality'
    return { ...r, type, hard, tlph: tlph != null ? Math.round(tlph) : null }
  })
}
export const TYPE_LABEL = { easy: 'Easy run', long: 'Long run', quality: 'Quality run', race: 'Marathon distance', free: 'Free run' }
export const TYPE_KIND = { easy: 'easy', long: 'long', quality: 'quality', race: 'race', free: 'easy' }
export const labelOf = (r) => r.type === 'long' && r.hard ? 'Long run · quality' : TYPE_LABEL[r.type]
export const fmtHM = (sec) => { if (sec == null) return '—'; const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60); return h ? `${h}:${String(m).padStart(2, '0')}` : `${m} min` }
export const byDate = (rows) => Object.fromEntries(rows.map((r) => [r.date, r]))

// Weekly (Mon–Sun) km of both plans for the table + findings.
export function weekly(plan, coros) {
  const m = new Map(), get = (mon) => m.get(mon) || m.set(mon, { mon, lumpad: 0, coros: 0, lumpadDays: 0, corosDays: 0, phase: null, id: null }).get(mon)
  for (const d of plan) { const w = get(mondayOf(d.date)); w.lumpad += d.km; if (d.km > 0) w.lumpadDays++; w.phase ??= d.phase; w.id ??= d.week }
  for (const r of coros) { const w = get(mondayOf(r.date)); w.coros += r.km || 0; if (r.km) w.corosDays++ }
  return [...m.values()].sort((a, b) => a.mon.localeCompare(b.mon)).map((w) => ({ ...w, lumpad: Math.round(w.lumpad * 10) / 10, coros: Math.round(w.coros * 10) / 10, delta: Math.round((w.coros - w.lumpad) * 10) / 10 }))
}

// What the two plans disagree about. Pure → unit-tested. `actualAvg4` = mean weekly run km of the last 4 full weeks (optional).
export function findings(plan, coros, { actualAvg4 = null, T = null } = {}) {
  const out = [], P = Object.fromEntries(plan.map((d) => [d.date, d])), C = byDate(coros), W = weekly(plan, coros)
  const first = W.find((w) => w.coros > 0)
  if (actualAvg4 != null && first) {
    const pct = actualAvg4 > 0 ? Math.round((first.coros / actualAvg4 - 1) * 100) : null
    out.push({ id: 'ramp', tone: first.coros > actualAvg4 * 1.3 ? 'yellow' : 'green', title: 'Opening weeks vs your recent running',
      body: `Your last 4 weeks averaged ${actualAvg4.toFixed(0)} km/week. The first COROS week is ${first.coros} km${pct != null ? ` (${pct >= 0 ? '+' : ''}${pct}%)` : ''}${W.find((w) => w.mon > first.mon && w.coros > 0)?.coros > actualAvg4 * 2 ? ` and the next is ${W.find((w) => w.mon > first.mon)?.coros} km` : ''}. The 72 h auto-scaler and the gate will trim sessions, but the planned ramp is steeper than the +10% rule.` })
  }
  // overlapping COROS plan windows
  for (let i = 0; i < COROS_PLANS.length - 1; i++) { const a = COROS_PLANS[i], b = COROS_PLANS[i + 1]; if (b.from <= a.to) out.push({ id: 'overlap' + i, tone: 'yellow', title: `${a.id} and ${b.id} overlap`, body: `${a.label} runs until ${a.to}, ${b.label} starts ${b.from} — ${diffDays(a.to, b.from) + 1} days are scheduled by both; COROS keeps one workout per day, so check those weeks on the watch.` }) }
  // marathon-distance days COROS schedules that Lumpad doesn't race
  const lumpadRaces = new Set(plan.filter((d) => d.kind === 'race' && d.km >= 21).map((d) => d.date))
  const corosFM = coros.filter((r) => r.km >= 40)
  const stray = corosFM.filter((r) => !lumpadRaces.has(r.date)), missing = [...lumpadRaces].filter((d) => !C[d] || C[d].km < 40)
  if (stray.length) out.push({ id: 'fm-stray', tone: 'yellow', title: 'COROS has marathon-distance days Lumpad does not', body: `${stray.map((r) => r.date).join(', ')} — a ${stray[0].km} km day each. These are the plan templates' own "race day" placeholders; Lumpad's races are ${[...lumpadRaces].join(', ')}.` })
  if (missing.length) out.push({ id: 'fm-missing', tone: 'yellow', title: 'Lumpad races that COROS does not know', body: `${missing.join(', ')} — the COROS plans treat these as ordinary training days (${missing.map((d) => (C[d]?.km ?? 0) + ' km').join(' / ')}).` })
  // after the last COROS workout
  const last = coros.at(-1)?.date
  if (last) { const rest = plan.filter((d) => d.date > last && d.date <= '2027-10-24' && d.km > 0); if (rest.length) out.push({ id: 'tail', tone: 'yellow', title: 'COROS stops before the taper', body: `Last COROS workout: ${last}. ${rest.length} Lumpad running days (${Math.round(rest.reduce((s, d) => s + d.km, 0))} km, incl. taper, race week and JRF) have no COROS workout on the watch.` }) }
  // big volume gaps
  const big = W.filter((w) => w.coros > 0 && w.lumpad > 0 && w.mon >= '2027-01-01' && w.coros >= w.lumpad * 1.5)
  if (big.length) out.push({ id: 'vol-high', tone: 'red', title: `COROS volume ≥1.5× Lumpad in ${big.length} weeks`, body: `${big[0].mon} → ${big.at(-1).mon}: e.g. week of ${big[0].mon} COROS ${big[0].coros} km vs Lumpad ${big[0].lumpad} km. Lumpad's Jan–Mar is the post-injury return (B0 baseline); the COROS template assumes a normal marathon build.` })
  const low = W.filter((w) => w.coros > 0 && w.lumpad > 0 && w.mon >= '2027-04-01' && w.coros <= w.lumpad * 0.7)
  if (low.length) out.push({ id: 'vol-low', tone: 'yellow', title: `COROS volume ≤70% of Lumpad in ${low.length} weeks`, body: `Mostly Apr–Aug (peak of Lumpad's build). Lumpad's 70–86 km weeks are not on the watch for those dates.` })
  void T; void P
  return out
}
