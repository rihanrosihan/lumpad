// Guardrail Kernel (P0 subset): locked rules compiled to executable constraints. Pure: no IO.
//   R-LOAD-10  week run km <= 1.10 x previous 4-week average   (Load guard; replan.go rule 2)
//   R-LR-110   long run <= 1.10 x longest run in previous 30 d  (Load guard; replan.go rule 3)
//   R-48H      no two hard sessions on consecutive days         (doctrine; missed.js)
//   R-PAST     a candidate never changes a day before today
// validate(days, ctx) -> violations[]; repair(days, ctx) -> days' (never increases load); weekReport() for the P0 report.
// days: [{date, kind, km, label?, tags?, locked?}]. ctx: { weekly4w?: seed for weeks before the window, longest30?: seed, actualWeeks?: {monday: km}, seed?: bool }
import { addDays, mondayOf } from '../../src/lib/dates.js'

export const RULES = { LOAD: 'R-LOAD-10', LR: 'R-LR-110', H48: 'R-48H', PAST: 'R-PAST' }
const HARD = new Set(['quality', 'tt', 'long', 'race'])
const runKm = (d) => (d && d.km > 0 && !['rest', 'gym'].includes(d.kind) ? d.km : 0)
const r1 = (x) => Math.round(x * 10) / 10
const isLocked = (d) => !!d.locked || d.kind === 'race' || /gate|CP\d/i.test(`${d.label || ''} ${(d.tags || []).join(' ')}`)

export function weekTotals(days) {
  const w = new Map()
  for (const d of days) { const m = mondayOf(d.date); w.set(m, r1((w.get(m) || 0) + runKm(d))) }
  return w
}
// cap for week `m`, from the previous four weeks: planned values inside the window, actualWeeks before it, ctx.weekly4w as the seed (only with ctx.seed)
function capFor(m, totals, ctx) {
  const prev = [1, 2, 3, 4].map((i) => addDays(m, -7 * i)).map((p) => totals.get(p) ?? ctx.actualWeeks?.[p] ?? (ctx.seed ? ctx.weekly4w : undefined))
  if (prev.some((x) => x == null)) return null // not enough history: the rule cannot judge this week
  const avg = prev.reduce((a, b) => a + b, 0) / 4
  return avg > 0 ? { avg: r1(avg), cap: r1(avg * 1.1) } : null
}

export function validate(days, ctx = {}) {
  const out = [], totals = weekTotals(days), sorted = [...days].sort((a, b) => a.date.localeCompare(b.date))
  for (const [m, km] of [...totals].sort()) {
    const c = capFor(m, totals, ctx)
    if (c && km > c.cap + 0.05) out.push({ rule: RULES.LOAD, severity: 'repair', date: m, detail: { week_km: km, avg4w: c.avg, cap_km: c.cap } })
  }
  for (const d of sorted) {
    if (d.kind === 'long' && d.km > 0) {
      const from = addDays(d.date, -30), prior = Math.max(0, ...sorted.filter((x) => x.date > from && x.date < d.date).map(runKm), ...(ctx.seed && from < sorted[0].date && ctx.longest30 ? [ctx.longest30] : []))
      if (prior > 0 && d.km > r1(prior * 1.1) + 0.05) out.push({ rule: RULES.LR, severity: 'repair', date: d.date, detail: { km: d.km, longest30: r1(prior), cap_km: r1(prior * 1.1) } })
    }
  }
  const byDate = Object.fromEntries(sorted.map((d) => [d.date, d]))
  for (const d of sorted) if (HARD.has(d.kind) && HARD.has(byDate[addDays(d.date, 1)]?.kind)) out.push({ rule: RULES.H48, severity: 'repair', date: d.date, detail: { next: addDays(d.date, 1) } })
  if (ctx.today && ctx.base) {
    const base = Object.fromEntries(ctx.base.map((d) => [d.date, d]))
    for (const d of days) if (d.date < ctx.today && (base[d.date]?.kind !== d.kind || base[d.date]?.km !== d.km || base[d.date]?.label !== d.label)) out.push({ rule: RULES.PAST, severity: 'block', date: d.date, detail: {} })
  }
  return out
}

// Deterministic repair. Only lowers km / downgrades kind, in week order (each week's cap uses the repaired weeks before it). Locked days are untouched.
// Order inside a week: easy runs first, then quality, then the long run; a week whose locked days alone exceed the cap is reported as 'block'.
function repairOnce(days, ctx) {
  let cur = days.map((d) => ({ ...d })).sort((a, b) => a.date.localeCompare(b.date)), blocks = []
  const scale = (d, km) => { d.km = r1(Math.max(0, km)); d.repaired = true }
  // long-run cap first (it feeds the week totals)
  for (const d of cur) {
    if (d.kind === 'long' && !isLocked(d)) {
      const from = addDays(d.date, -30), prior = Math.max(0, ...cur.filter((x) => x.date > from && x.date < d.date).map(runKm), ...(ctx.seed && from < cur[0].date && ctx.longest30 ? [ctx.longest30] : []))
      if (prior > 0 && d.km > r1(prior * 1.1) + 0.05) scale(d, Math.floor(prior * 1.1 * 10) / 10)
    }
  }
  for (const m of [...weekTotals(cur).keys()].sort()) {
    const totals = weekTotals(cur), c = capFor(m, totals, ctx); if (!c) continue
    let over = totals.get(m) - c.cap; if (over <= 0.05) continue
    const wk = cur.filter((d) => mondayOf(d.date) === m && runKm(d) > 0 && !isLocked(d))
    for (const grp of [['easy'], ['quality', 'tt'], ['long']]) {
      const g = wk.filter((d) => grp.includes(d.kind)), tot = g.reduce((s, d) => s + d.km, 0)
      if (over <= 0.05 || !tot) continue
      const cut = Math.min(over, tot), f = (tot - cut) / tot
      for (const d of g) scale(d, Math.floor(d.km * f * 10) / 10)
      over -= cut
    }
    if (over > 0.05) blocks.push({ rule: RULES.LOAD, severity: 'block', date: m, detail: { over_km: r1(over), reason: 'locked days alone exceed the cap' } })
  }
  return { days: cur, blocks }
}
// 48 h first (the later of two consecutive hard days becomes easy at <= 60 % km), then long-run cap and weekly cap. Lowering an earlier week lowers later caps, so iterate to a fixed point (km only ever decreases, so it terminates).
export function repair(days, ctx = {}) {
  let cur = days.map((d) => ({ ...d })).sort((a, b) => a.date.localeCompare(b.date)), blocks = []
  for (let i = 0; i < 50; i++) {
    const idx = Object.fromEntries(cur.map((d) => [d.date, d]))
    for (const d of cur) { const n = idx[addDays(d.date, 1)]; if (HARD.has(d.kind) && n && HARD.has(n.kind) && !isLocked(n)) { n.kind = 'easy'; n.km = r1(n.km * 0.6); n.repaired = true } }
    const r = repairOnce(cur, ctx); blocks = r.blocks
    const same = JSON.stringify(r.days.map((d) => [d.kind, d.km])) === JSON.stringify(cur.map((d) => [d.kind, d.km])); cur = r.days
    if (same) break
  }
  return { days: cur, blocks }
}

export function weekReport(days, ctx = {}) {
  const totals = weekTotals(days), rows = [...totals].sort().map(([m, km]) => ({ monday: m, km, ...(capFor(m, totals, ctx) || {}) }))
  const judged = rows.filter((r) => r.cap != null)
  return { weeks: rows.length, judged: judged.length, over: judged.filter((r) => r.km > r.cap + 0.05).length, rows }
}
