// COROS training-plan overlay. COROS only exposes the *scheduled runs* (date, distance, estimated time, load) — no names,
// no strength, no rest markers — so everything else here is derived and labelled as such.
// Rows: { date:'YYYY-MM-DD', km:number|null, sec:number|null, tl:number|null, code?:string }
import { addDays, diffDays, mondayOf } from './dates.js'

// Plan windows as reported by COROS (the three active execution plans). Windows overlap by design of the templates.
export const COROS_PLANS = [
  { id: 'A', label: 'Plan A · 20 weeks', from: '2026-11-23', to: '2027-04-18' },
  { id: 'B', label: 'Plan B · 12 weeks', from: '2027-04-12', to: '2027-07-11' },
  { id: 'C', label: 'Plan C · 12 weeks', from: '2027-07-05', to: '2027-10-02' },
  { id: 'D', label: 'Plan D · 12 weeks', from: '2027-09-27', to: '2027-12-25' },
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
    if (!r.km) type = r.sec ? 'strength' : 'free' // no distance but a duration = a non-running session; neither = free-mode run
    else if (r.km >= 40) type = 'race'
    else if (r.km >= 12 && r.km === byWeek[mondayOf(r.date)]) type = 'long'
    else if (hard) type = 'quality'
    return { ...r, type, hard, tlph: tlph != null ? Math.round(tlph) : null }
  })
}
export const TYPE_LABEL = { easy: 'Easy run', long: 'Long run', quality: 'Quality run', race: 'Marathon distance', free: 'Free run', strength: 'Strength / cross-training' }
export const TYPE_KIND = { easy: 'easy', long: 'long', quality: 'quality', race: 'race', free: 'easy', strength: 'gym' }
export const labelOf = (r) => r.type === 'long' && r.hard ? 'Long run · quality' : TYPE_LABEL[r.type]
export const fmtHM = (sec) => { if (sec == null) return '—'; const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60); return h ? `${h}:${String(m).padStart(2, '0')}` : `${m} min` }
// A date can hold several COROS sessions (a run + a strength session). byDate = the run (else the first session); allByDate = every session.
export const allByDate = (rows) => { const m = {}; for (const r of rows) (m[r.date] ||= []).push(r); return m }
export const byDate = (rows) => Object.fromEntries(Object.entries(allByDate(rows)).map(([d, l]) => [d, l.find((r) => r.km) || l[0]]))

// Weekly (Mon–Sun) km of both plans for the table + findings.
export function weekly(plan, coros) {
  const m = new Map(), get = (mon) => m.get(mon) || m.set(mon, { mon, lumpad: 0, coros: 0, lumpadDays: 0, corosDays: 0, phase: null, id: null }).get(mon)
  for (const d of plan) { const w = get(mondayOf(d.date)); w.lumpad += d.km; if (d.km > 0) w.lumpadDays++; w.phase ??= d.phase; w.id ??= d.week }
  for (const r of coros) { const w = get(mondayOf(r.date)); w.coros += r.km || 0; if (r.km) w.corosDays++ }
  return [...m.values()].sort((a, b) => a.mon.localeCompare(b.mon)).map((w) => ({ ...w, lumpad: Math.round(w.lumpad * 10) / 10, coros: Math.round(w.coros * 10) / 10, delta: Math.round((w.coros - w.lumpad) * 10) / 10 }))
}

// What the COROS watch plan and the season plan disagree about. Pure → unit-tested.
// `actualAvg4` = mean weekly run km of the last 4 full weeks (optional).
export function findings(plan, coros, { actualAvg4 = null } = {}) {
  const out = [], C = byDate(coros), W = weekly(plan, coros), P = Object.fromEntries(plan.map((d) => [d.date, d]))
  const first = W.find((w) => w.coros > 0)
  if (actualAvg4 != null && first) {
    const second = W.find((w) => w.mon > first.mon && w.coros > 0), pct = actualAvg4 > 0 ? Math.round((first.coros / actualAvg4 - 1) * 100) : null
    out.push({ id: 'ramp', tone: first.coros > actualAvg4 * 1.3 ? 'yellow' : 'green', title: 'Opening weeks vs your recent running',
      body: `Your last 4 weeks averaged ${actualAvg4.toFixed(0)} km/week. The first week is ${first.coros} km${pct != null ? ` (${pct >= 0 ? '+' : ''}${pct}%)` : ''}${second?.coros > actualAvg4 * 2 ? ` and the next is ${second.coros} km` : ''}. The 72 h auto-scaler and the gate trim sessions, but the planned ramp is steeper than the +10% rule.` })
  }
  // the watch still has the old marathon dates
  const races = plan.filter((d) => d.kind === 'race' && d.km >= 40), raceDates = races.map((d) => d.date)
  const stray = coros.filter((r) => r.km >= 40 && !raceDates.includes(r.date))
  if (stray.length) out.push({ id: 'fm-stray', tone: 'red', title: 'COROS marathon dates are wrong', body: `The COROS plans have a marathon-distance day on ${stray.map((r) => r.date).join(', ')} (${stray[0].km} km each). The real races are ${races.map((d) => `${d.label.replace(/ ·.*/, '')} ${d.date.slice(5)}`).join(', ')}. The season plan here is already re-timed; the watch keeps the old dates until the plans are recreated in COROS.` })
  const missing = raceDates.filter((d) => !C[d] || C[d].km < 40)
  if (missing.length) out.push({ id: 'fm-missing', tone: 'yellow', title: 'Races the watch does not know', body: `${missing.join(', ')} — COROS has ordinary training days there (${missing.map((d) => (C[d]?.km ?? 0) + ' km').join(' / ')}).` })
  for (let i = 0; i < COROS_PLANS.length - 1; i++) { const a = COROS_PLANS[i], b = COROS_PLANS[i + 1]; if (b.from <= a.to) out.push({ id: 'overlap' + i, tone: 'yellow', title: `${a.id} and ${b.id} overlap`, body: `${a.label} runs until ${a.to}, ${b.label} starts ${b.from} — ${diffDays(a.to, b.from) + 1} days are scheduled by both; COROS keeps one workout per day, so check those weeks on the watch.` }) }
  // how far the watch is from the season plan
  const days = plan.filter((d) => C[d.date] || d.km > 0), differ = days.filter((d) => Math.abs((C[d.date]?.km || 0) - d.km) > 0.5)
  if (differ.length) { const aw = W.filter((w) => w.coros > 0 || w.lumpad > 0), sum = aw.reduce((s, w) => s + w.delta, 0)
    out.push({ id: 'differ', tone: 'yellow', title: `${differ.length} days differ between the season plan and the watch`, body: `Over the whole season COROS has ${Math.abs(Math.round(sum))} km ${sum < 0 ? 'less' : 'more'} than the season plan. Most differences are the re-timed cycles (Mar → Oct).` }) }
  // Ramadan
  const ram = W.filter((w) => w.phase === 'RAMADAN' && w.lumpad >= 80)
  if (ram.length) out.push({ id: 'ramadan', tone: 'yellow', title: `${ram.length} weeks of ≥80 km fall in Ramadan`, body: `${ram.map((w) => `${w.mon.slice(5)}: ${w.lumpad} km`).join(', ')}. The COROS plan does not know about fasting; plan fuel, hydration and the gate for those weeks.` })
  // checkpoints sitting on hard COROS days
  const cps = plan.filter((d) => d.tags.some((t) => /^CP\d+$/.test(t)) && d.src === 'coros' && (d.kind === 'long' || d.kind === 'quality') && d.km > 0)
  if (cps.length) out.push({ id: 'cp-collide', tone: 'yellow', title: `${cps.length} checkpoints sit on long or quality COROS days`, body: `${cps.slice(0, 4).map((d) => `${d.tags.find((t) => /^CP\d+$/.test(t))} on ${d.date.slice(5)} (${d.km} km ${d.kind})`).join(', ')}${cps.length > 4 ? ', …' : ''}. Checkpoints keep their original dates for now; they were set for the lower-volume plan.` })
  // last long run before the A race
  const a = plan.find((d) => d.kind === 'race' && /A-RACE/.test(d.label))
  if (a) { const lr = plan.filter((d) => d.date < a.date && d.date >= addDays(a.date, -28) && d.km >= 25).at(-1)
    if (lr) out.push({ id: 'lr-before-a', tone: diffDays(a.date, lr.date) < 14 ? 'yellow' : 'green', title: 'Last long run before the A race', body: `${lr.km} km on ${lr.date.slice(5)}, ${diffDays(a.date, lr.date)} days before ${a.label.replace(/ ·.*/, '')}.` }) }
  return out
}
