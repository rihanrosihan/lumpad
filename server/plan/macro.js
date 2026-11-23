// Macro generator (P4): periodise -> allocate -> fill. Pure and deterministic: same inputs, same plan. No LLM (engine-only; an AI selector may pick among options later, P5).
//   periodise: weeks backward from each goal race, start volume = ACTUAL 4-week volume, weekly ramp from the load guard, cutback every 4th build week, taper, recovery
//   allocate : long run, quality and easy days placed inside the availability windows, never next to a race/TT, hard days >= 48 h apart
//   fill     : templates from the catalog with doses (symbolic zones); every candidate is checked by the kernel (raceExempt, DEC-8) before it can be proposed
import { addDays, diffDays, mondayOf, dowOf } from '../../src/lib/dates.js'
import { estimate, flat, stepKm } from '../../src/lib/zones.js'
import { expand } from './catalog.js'
import { validate, repair, weekTotals } from './kernel.js'

export const FREEZES = [['2027-05-30', '2027-06-20'], ['2027-10-03', '2027-10-24']]   // no software cutovers (remaining-work §1)
export const RAMADAN = ['2027-02-01', '2027-03-14']
// Rebuild one generated session with a different template (same day, never more km than the slot had). Used by the AI selector (P5).
const META = { 'coros.P10541': ['quality', 'Steady Run · Aerobic Power'], 'coros.P10547': ['quality', 'Threshold Intervals'], 'coros.P10544': ['quality', 'Aerobic Power Alternations'], 'coros.P10594': ['long', 'Long Run'], 'coros.P10545': ['long', 'Long Run · Aerobic Power finish'] }
export const hiKmOf = (d) => (d.kind === 'quality' || d.template === 'coros.P10545' ? flat(d.steps || []).filter((s) => (s.z || 0) >= 3 && s.m).reduce((a, s) => a + s.m / 1000, 0) : 0)
export function rebuildSlot(day, tpl, km = day.km) {
  const m = META[tpl]; if (!m) return null
  const s = session(day.date, tpl, km); if (s.km > day.km + 0.05) return null   // never more load than the slot had
  return { ...day, kind: m[0], label: m[1], km: s.km, steps: s.steps, sec: s.est.sec, tl: s.est.tl, template: tpl }
}
export const inFreeze = (d) => FREEZES.some(([a, b]) => d >= a && d <= b)
const r05 = (x) => Math.round(x * 2) / 2, f05 = (x) => Math.floor(x * 10 + 1e-9) / 10, f1 = (x) => Math.floor(x * 10) / 10, r1 = (x) => Math.round(x * 10) / 10
const NOTE = { easy: 'Conversational: hold the HR zone, let pace float in heat.', long: 'Fuel from 45 min (30–60 g/h), drink to thirst, sodium in heat.', quality: 'Hold the zone evenly; recoveries stay in zone 2.', rest: 'REST DAY' }
const DEFAULT_PATTERN = { 1: { rest: true }, 2: { quality: true }, 4: { quality: true }, 6: { long: true } } // Mon rest, Tue/Thu quality, Sat long (plan.js TEMPLATE)
const weekNo = (d) => 'W' + (Math.floor(diffDays(mondayOf(d), '2027-01-04') / 7) + 1)

// availability: { rules: [{dow, windows:[{max_min}], pref}], exceptions: {date: []|[{max_min}]} } -> per date { open, maxMin, pref }
export function dayAvail(date, availability = {}) {
  const dow = dowOf(date), ex = availability.exceptions?.[date], rule = (availability.rules || []).find((r) => r.dow === dow)
  const wins = ex ?? rule?.windows ?? null
  const open = wins == null ? true : wins.length > 0, maxMin = wins?.length ? Math.max(...wins.map((w) => w.max_min ?? 999)) : (open ? 999 : 0)
  return { open, maxMin, pref: rule?.pref ?? (availability.rules?.length ? {} : DEFAULT_PATTERN[dow] || {}) }
}
const minutes = (steps) => (steps?.some((s) => s.t === 'free') ? 0 : estimate(steps).sec / 60)

// Build a session. The reps of the two interval templates are sized explicitly (never derived from the km hint), and the returned km is what the steps really add up to,
// so the weekly totals the load guard sees are the real ones.
function session(date, template, km, dose = {}) {
  const d = template === 'coros.P10547' ? { n: Math.max(1, Math.floor(km / 4.6 + 1e-9)), r: 1600 } : template === 'coros.P10544' ? { n: Math.max(1, Math.floor(km / 3.2 + 1e-9)), per: 1600 } : {}
  const steps = expand(template, { km, ...d, ...dose }), est = estimate(steps)
  return { steps, est, km: Math.round(stepKm(steps) * 10) / 10 }
}
// choose a template per purpose. rot = rotation counter so quality alternates deterministically
const QUALITY = (phase, rot) => (phase === 'BASE' || phase === 'RAMADAN' ? ['coros.P10541', 'coros.P10544'] : phase === 'PEAK' ? ['coros.P10547', 'coros.P10541'] : ['coros.P10547', 'coros.P10544', 'coros.P10541'])
const pickQ = (phase, rot) => { const q = QUALITY(phase, rot); return q[rot % q.length] }

// ------------------------------------------------------------------ periodise
// Week class from the goals (no volume yet): phase, race, taper/recovery multiplier of the block peak
export function classify(m, goals) {
  const sun = addDays(m, 6), inWeek = goals.filter((g) => g.race_date >= m && g.race_date <= sun), next = goals.find((g) => g.race_date >= m), prev = [...goals].reverse().find((g) => g.race_date < m)
  const fm = (g) => g.distance_m >= 30000, ramadan = m <= RAMADAN[1] && sun >= RAMADAN[0], cands = []
  let phase = null
  if (inWeek.length) { phase = 'RACE WEEK'; for (const g of inWeek) cands.push(g.cls === 'A' || g.cls === 'B' ? 0.35 : 0.5) }
  else if (prev && diffDays(m, prev.race_date) <= 7 && fm(prev)) { phase = 'RECOVERY'; cands.push(0.5) }
  // every upcoming goal contributes its own taper; the strictest one wins (a C-race three weeks before the A-race must not loosen the A-race's 21-day rule)
  for (const g of goals) { const wt = Math.floor(diffDays(g.race_date, m) / 7); if (g.race_date < m) continue
    const x = g.cls === 'A' && wt <= 3 ? [0, 0.5, 0.55, 0.6][wt] : g.cls === 'B' && wt <= 2 ? [0, 0.5, 0.6][wt] : g.cls === 'C' && wt <= 1 ? 0.8 : null
    if (x != null) { cands.push(x); phase = phase || 'TAPER' } }
  return { monday: m, phase, mult: cands.length ? Math.min(...cands) : null, race: inWeek[0] || null, weeksTo: next ? Math.floor(diffDays(next.race_date, m) / 7) : 99, ramadan, next }
}
// Weekly km target. state = { hist (actual non-race km of previous weeks), streak, lastBuild, peak }. The ceiling is the load guard itself (+10 % of the 4-week average, 2 % margin) and peakCap.
export function weekTarget(w, state, { peakCap, cutbackEvery = 4, cutbackRatio = 0.9, guardBaseline = 'literal' }, goals) {
  const base = guardBaseline === 'build' ? state.buildHist.slice(-4) : state.hist.slice(-4), cap = 1.1 * (base.reduce((a, b) => a + b, 0) / 4), ceil = Math.min(peakCap, f1(cap * 0.98))
  let km, cutback = false, phase = w.phase
  if (w.mult != null) { km = f1(Math.max(0, (state.peak || state.lastBuild) * w.mult)); state.streak = 0 }   // a share of the peak actually placed (the athlete's current volume only before any build week exists)
  else {
    if (cutbackEvery && state.streak >= cutbackEvery - 1) { cutback = true; km = f1(state.lastBuild * cutbackRatio); state.streak = 0 }
    else { km = w.ramadan ? Math.min(ceil, f1(state.lastBuild)) : ceil; state.streak++; state.lastBuild = km }   // Ramadan: hold, no progression
    const upcoming = goals.find((g) => (g.cls === 'A' || g.cls === 'B') && g.race_date > w.monday && diffDays(g.race_date, w.monday) <= 8 * 7)
    phase = w.ramadan ? 'RAMADAN' : upcoming && diffDays(upcoming.race_date, w.monday) <= 6 * 7 ? 'PEAK' : km >= 30 ? 'BUILD' : 'BASE'
  }
  return { ...w, phase, km: r1(Math.min(km, w.mult == null || guardBaseline === 'literal' ? ceil : 1e9)), ceil, cutback }   // literal: even taper and recovery weeks stay under the guard
}

// ------------------------------------------------------------------ allocate + fill one week
function planWeek(w, { plan, anchors, availability, goals, longHist, hardPrev = new Set(), placed = [], weekly4w = 15, planStart = '0000' }) {
  const dates = Array.from({ length: 7 }, (_, i) => addDays(w.monday, i)), out = {}, shortfall = []
  const av = Object.fromEntries(dates.map((d) => [d, dayAvail(d, availability)])), anchor = (d) => anchors[d]
  const nearAnchor = (d) => [-1, 0, 1].some((o) => anchor(addDays(d, o)) && ['race', 'tt'].includes(anchor(addDays(d, o)).kind))
  const raceDay = dates.find((d) => anchor(d)?.kind === 'race'), dayBeforeRace = raceDay ? addDays(raceDay, -1) : null
  const recovery = w.phase === 'RECOVERY'
  const free = dates.filter((d) => !anchor(d) && av[d].open && d <= (w.lastDate ?? '9999'))
  // rest forced: day after a goal race
  const afterRace = new Set(dates.filter((d) => anchor(addDays(d, -1))?.kind === 'race'))
  const runDays = free.filter((d) => !afterRace.has(d))
  const hardOk = (d) => runDays.includes(d) && !nearAnchor(d) && d !== dayBeforeRace && !hardPrev.has(addDays(d, -1))   // 48 h also across the week boundary
  const longEligible = !['TAPER', 'RACE WEEK', 'RECOVERY'].includes(w.phase) || (w.phase === 'TAPER' && w.km >= 18)
  const nq = recovery || w.phase === 'RACE WEEK' || w.km < (w.qualityMinKm ?? 20) || dates.some((d) => anchor(d)?.kind === 'tt') ? 0 : w.phase === 'TAPER' ? 1 : w.ramadan ? 1 : w.km >= 45 ? 2 : 1
  // long run: preferred day, else Saturday, else the open day with the most minutes; needs 2 clear days from other anchors
  let longDay = null
  if (longEligible && w.km >= 12) {
    const cands = runDays.filter(hardOk).sort((a, b) => (av[b].pref.long ? 1 : 0) - (av[a].pref.long ? 1 : 0) || (dowOf(b) === 6) - (dowOf(a) === 6) || av[b].maxMin - av[a].maxMin || a.localeCompare(b))
    longDay = cands[0] || null
  }
  const qDays = []
  if (nq) {
    const cands = runDays.filter((d) => hardOk(d) && d !== longDay && (!longDay || Math.abs(diffDays(d, longDay)) >= 2)).sort((a, b) => (av[b].pref.quality ? 1 : 0) - (av[a].pref.quality ? 1 : 0) || a.localeCompare(b))
    for (const d of cands) { if (qDays.length >= nq) break; if (qDays.every((x) => Math.abs(diffDays(d, x)) >= 2)) qDays.push(d) }
  }
  // volumes
  const quality = qDays.length ? Math.min(16, Math.max(5, f05(w.km * 0.18))) : 0
  let long = 0
  // long run cap: longest run of ANY kind in the last 30 days, exactly as the kernel counts it
  if (longDay) { const win = (x) => x.date > addDays(longDay, -30) && x.date < longDay, prior = Math.max(0, ...(addDays(longDay, -30) < planStart ? longHist.filter(win).map((h) => h.km) : []), ...placed.filter(win).filter((x) => x.km > 0 && x.kind !== 'rest' && x.kind !== 'gym').map((x) => x.km)), cap = f1((prior > 0 ? prior : Math.max(8, weekly4w * 0.4)) * 1.1); long = Math.min(30, cap, f05(w.km * (w.km >= 40 ? 0.32 : 0.38))); if (w.cutback) long = f05(long * 0.8); if (long < 5 && w.km * 0.6 >= 5 && cap >= 5) long = 5; if (long < 4) { long = 0; longDay = null } }   // the 110 % cap decides: below 4 km it is not a long run, the volume goes to easy days
  const rest = Math.max(0, w.km - long - quality * qDays.length)
  const easyDays = runDays.filter((d) => d !== longDay && !qDays.includes(d) && !(av[d].pref.rest && rest < 3 * 4))
  const maxEasy = Math.max(6, r05(w.km * 0.22)), want = Math.max(rest >= 3 ? 1 : 0, Math.min(easyDays.length, Math.round(rest / 5)))
  const nEasy = Math.min(easyDays.length, Math.max(want, Math.ceil(rest / maxEasy)), Math.floor(rest / 3))
  // easy days: prefer the day before the long run (short), then spread; never more than the volume supports
  const order = [...easyDays].sort((a, b) => (a === (longDay && addDays(longDay, -1)) ? 1 : 0) - (b === (longDay && addDays(longDay, -1)) ? 1 : 0) || a.localeCompare(b)), easy = order.slice(0, nEasy).sort()
  const each = nEasy ? Math.max(3, f05(rest / nEasy)) : 0
  const put = (d, kind, tpl, km, label, extra = {}) => {
    let k = km, s = session(d, tpl, k)
    while (av[d].maxMin < 999 && minutes(s.steps) > av[d].maxMin && k > 3) { k = r05(k - 0.5); s = session(d, tpl, k) }
    if (av[d].maxMin < 999 && minutes(s.steps) > av[d].maxMin) {   // the structure does not fit the window: an easy run, or nothing
      if (kind !== 'easy') return put(d, 'easy', tpl.startsWith('coros.P10594') || kind === 'long' || kind === 'quality' ? 'coros.P10540' : tpl, Math.min(km, 6), 'Aerobic Endurance Run', extra)
      shortfall.push({ date: d, wanted: km, got: 0, why: `only ${av[d].maxMin} min available` }); return
    }
    if (s.km < km - 0.05) shortfall.push({ date: d, wanted: km, got: s.km, why: av[d].maxMin < 999 && k < km ? `only ${av[d].maxMin} min available` : 'interval structure comes in whole repetitions' })
    out[d] = { kind, label, km: s.km, steps: s.steps, sec: s.est.sec, tl: s.est.tl, tpl, ...extra }
  }
  if (longDay) put(longDay, 'long', w.phase === 'PEAK' && w.km >= 40 && !w.cutback ? 'coros.P10545' : 'coros.P10594', long, w.phase === 'PEAK' && w.km >= 40 && !w.cutback ? 'Long Run · Aerobic Power finish' : 'Long Run')
  qDays.forEach((d, i) => { const tpl = pickQ(w.phase, Math.floor(diffDays(w.monday, '2026-11-23') / 7) + i); put(d, 'quality', tpl, quality, { 'coros.P10541': 'Steady Run · Aerobic Power', 'coros.P10547': 'Threshold Intervals', 'coros.P10544': 'Aerobic Power Alternations' }[tpl]) })
  easy.forEach((d) => { const shortDay = d === dayBeforeRace; put(d, 'easy', recovery ? 'lumpad.recovery' : 'coros.P10540', shortDay ? 3 : each, recovery ? 'Recovery Run' : 'Aerobic Endurance Run') })
  // long run: the kernel's 110 % window is 30 days (not 4 long runs), see longHist above
  // last guard: hard (zone 3+) km must stay under ~19 % of what was actually placed (closed days can leave volume unplaced). Order of relief: the Z3 finish of the long run
  // becomes a plain long run, then a quality session becomes an easy run.
  const hiKm = (o) => (o.kind === 'quality' || o.tpl === 'coros.P10545' ? flat(o.steps).filter((s) => (s.z || 0) >= 3 && s.m).reduce((a, s) => a + s.m / 1000, 0) : 0)
  for (let guard = 0; guard < 6; guard++) {
    const tot = Object.values(out).reduce((s, o) => s + o.km, 0), hi = Object.values(out).reduce((s, o) => s + hiKm(o), 0); if (hi <= 0.19 * tot) break
    const d = Object.keys(out).filter((k) => hiKm(out[k]) > 0).sort((a, b) => hiKm(out[b]) - hiKm(out[a]))[0]; if (!d) break
    const o = out[d], km = o.km; delete out[d]
    if (o.tpl === 'coros.P10545') put(d, 'long', 'coros.P10594', km, 'Long Run'); else put(d, 'easy', recovery ? 'lumpad.recovery' : 'coros.P10540', km, 'Aerobic Endurance Run')
  }
  if (dayBeforeRace && free.includes(dayBeforeRace) && !out[dayBeforeRace] && ['A', 'B'].includes(goals.find((g) => g.race_date === raceDay)?.cls)) put(dayBeforeRace, 'easy', 'coros.P10540', 3, 'Pre-race shakeout')
  // final fit: the week never exceeds its budget (min session sizes and the pre-race shakeout can push it over). Shrink the largest easy runs toward 3 km, then drop the smallest.
  const total = () => Object.values(out).reduce((s, o) => s + o.km, 0)
  for (let i = 0; i < 40 && total() > w.km + 0.05; i++) {
    const easies = Object.keys(out).filter((k) => out[k].kind === 'easy').sort((a, b) => out[b].km - out[a].km), big = easies.find((k) => out[k].km > 3.05)
    if (big) { const cut = Math.min(total() - w.km, out[big].km - 3), km = f05(out[big].km - cut), o = out[big]; delete out[big]; put(big, 'easy', o.tpl, km, o.label); shortfall.push({ date: big, wanted: o.km, got: km, why: 'week budget' }) }
    else if (easies.length) { const d = easies.at(-1); shortfall.push({ date: d, wanted: out[d].km, got: 0, why: 'week budget' }); delete out[d] } else break
  }
  return { out, shortfall, qDays, longDay, long }
}

// ------------------------------------------------------------------ generate
// plan: current active days [{date,...}] (plan.json shape). goals: plan_goal rows [{race_date,name,cls,distance_m,target_s,params}]. Returns the FULL candidate plan.
export function generate({ today, plan, goals, availability = {}, ctx = {} }) {
  const c = { weekly4w: 15, longest30: 0, peakCap: 60, ...ctx }, G = goals.filter((g) => g.status !== 'archived' && g.race_date >= today).sort((a, b) => a.race_date.localeCompare(b.race_date))
  const first = addDays(today, 3), startMonday = dowOf(first) === 1 ? first : addDays(mondayOf(first), 7), last = plan.at(-1).date, endMonday = mondayOf(last)
  const peakCap = G.find((g) => g.cls === 'A')?.params?.peak_cap_km ?? c.peakCap
  const by = Object.fromEntries(plan.map((d) => [d.date, d])), keep = plan.filter((d) => d.date < startMonday)
  // anchors: goal race days (kept from the plan when it already has them), time trials and gates from the plan
  const anchors = {}
  for (const g of G) if (g.race_date >= startMonday && g.race_date <= last) anchors[g.race_date] = by[g.race_date]?.kind === 'race' ? by[g.race_date] : { date: g.race_date, week: weekNo(g.race_date), phase: 'RACE WEEK', event: null, tags: [], km: r1(g.distance_m / 1000), label: g.cls === 'A' ? `${g.name} · A-RACE` : `${g.name} · ${g.cls}-race`, kind: 'race', note: `${g.cls}-race${g.target_s ? '' : ': finish before the cut-offs'}`, src: 'engine', steps: [{ t: 'race', m: Math.round(g.distance_m), z: 3, note: 'even pace; walk the aid stations if needed' }] }
  for (const d of plan) if (d.date >= startMonday && !anchors[d.date] && (d.kind === 'tt' || /gate/i.test(d.label || ''))) anchors[d.date] = d   // other checkpoint sessions (long-run proofs, marathon-effort reps) are regenerated and keep their CP tag
  const classes = []; for (let m = startMonday; m <= endMonday; m = addDays(m, 7)) classes.push(classify(m, G))
  const opt = { peakCap, cutbackEvery: c.cutbackEvery ?? 4, cutbackRatio: c.cutbackRatio ?? 0.9, guardBaseline: c.guardBaseline ?? 'literal' }, kt = weekTotals(keep, { raceExempt: true }), seedHist = [4, 3, 2, 1].map((i) => Math.min(kt.get(addDays(startMonday, -7 * i)) ?? c.weekly4w, c.weekly4w))   // what the kernel will compare the first generated week with (kept plan weeks), but never above the athlete's actual volume
  const state = { hist: [...seedHist], buildHist: [...seedHist], streak: 0, lastBuild: Math.min(c.weekly4w, ...seedHist), peak: 0 }
  const days = [...keep], report = { start: startMonday, peak_cap_km: peakCap, cutback: { every: opt.cutbackEvery, ratio: opt.cutbackRatio }, guard_baseline: opt.guardBaseline, weeks: [], shortfalls: [], conflicts: [] }
  const longHist = c.longest30 > 0 ? [{ date: addDays(startMonday, -1), km: Math.min(c.longest30, Math.max(8, c.weekly4w * 0.4)) }] : []   // never seed the long run from a single outlier
  for (const cls of classes) {
    const w = { ...weekTarget(cls, state, opt, G), qualityMinKm: c.qualityMinKm ?? 20 }
    // time trials / gates the load cannot carry are postponed (reported), never forced through the guard
    for (let i = 0; i < 7; i++) { const d = addDays(w.monday, i), a = anchors[d]; if (a && a.kind !== 'race') { const av = dayAvail(d, availability); if (!av.open || (a.sec && a.sec / 60 > av.maxMin)) { report.conflicts.push({ date: d, label: a.label, km: a.km, ceiling_km: null, why: !av.open ? 'the day is marked unavailable; postponed' : `needs ${Math.round(a.sec / 60)} min but only ${av.maxMin} are available; postponed` }); delete anchors[d]; continue } }
      const nextToRace = a && a.kind === 'tt' && [-1, 1].some((o) => anchors[addDays(d, o)]?.kind === 'race'); if (nextToRace) { report.conflicts.push({ date: d, label: a.label, km: a.km, ceiling_km: null, why: 'the checkpoint is next to a race (48 h rule); postponed' }); delete anchors[d]; continue }
      const limit = w.mult != null ? w.km : w.ceil; if (a && a.kind === 'tt' && a.km > limit) { report.conflicts.push({ date: d, label: a.label, km: a.km, ceiling_km: limit, why: w.mult != null ? `the checkpoint does not fit a ${w.phase.toLowerCase()} week (${w.km} km); postponed` : 'the checkpoint is longer than the load guard allows that week; postponed' }); delete anchors[d] } }
    const anchorKm = r1(Array.from({ length: 7 }, (_, i) => anchors[addDays(w.monday, i)]).filter((a) => a && a.kind !== 'race').reduce((s, a) => s + (a.km || 0), 0))
    const inPlan = Array.from({ length: 7 }, (_, i) => addDays(w.monday, i)).filter((x) => x <= last).length   // the final week can be short: scale the budget to the days that exist
    const p = planWeek({ ...w, km: Math.max(0, r1((w.km - anchorKm) * inPlan / 7)), lastDate: last }, { plan, anchors, availability, goals: G, longHist, hardPrev: new Set(days.filter((x) => ['quality', 'long', 'tt', 'race'].includes(x.kind)).map((x) => x.date)), placed: days, weekly4w: c.weekly4w, planStart: plan[0].date })
    if (p.long) longHist.push({ date: p.longDay, km: p.long })
    for (let i = 0; i < 7; i++) {
      const date = addDays(w.monday, i); if (date > last) break
      const old = by[date], tag = (old?.tags || []).filter((t) => /^CP\d+$/.test(t)), a = anchors[date], s = p.out[date]
      const phase = a?.kind === 'race' ? 'RACE WEEK' : w.phase
      let d
      if (a) d = { ...a, week: old?.week ?? weekNo(date), phase }
      else if (s) d = { date, week: old?.week ?? weekNo(date), phase, event: old?.event ?? null, tags: tag, km: s.km, label: s.label, kind: s.kind, note: NOTE[s.kind] + (tag.length && old?.note ? ` · ${old.note}` : ''), src: 'engine', steps: s.steps, sec: s.sec, tl: s.tl, template: s.tpl }
      else d = { date, week: old?.week ?? weekNo(date), phase, event: old?.event ?? null, tags: tag, km: 0, label: '', kind: 'rest', note: NOTE.rest, src: 'engine' }
      days.push(d)
    }
    const km = r1(days.filter((d) => d.date >= w.monday && d.date <= addDays(w.monday, 6) && d.kind !== 'race').reduce((s, d) => s + (d.km || 0), 0))
    state.hist.push(km)   // the load guard sees what is actually placed, not what was targeted
    if (!(w.mult != null || w.cutback)) { state.buildHist.push(km); state.peak = Math.max(state.peak, km) }   // tapers are a share of the peak actually placed
    if (w.cutback) for (const d of days.filter((x) => x.date >= w.monday && x.date <= addDays(w.monday, 6))) d.down = true
    report.weeks.push({ monday: w.monday, phase: w.phase, target_km: w.km, km, long_km: p.long || 0, quality: p.qDays.length, cutback: w.cutback, race: w.race?.name ?? null }); report.shortfalls.push(...p.shortfall)
  }
  const peakWeek = Math.max(...report.weeks.map((x) => x.km)); report.peak_km = peakWeek
  return { days, report }
}
// kernel pass: the candidate must be clean (race km exempt from the weekly guard, DEC-8); repair once if not, then report what is left
export function checkCandidate(days, ctx, start = null) {
  const kctx = { seed: true, weekly4w: ctx.weekly4w, longest30: ctx.longest30, raceExempt: true, guardBaseline: ctx.guardBaseline ?? 'literal' }
  const split = (v) => ({ inside: v.filter((x) => !start || x.date >= start), kept: v.filter((x) => start && x.date < start) })   // weeks before the horizon are frozen: reported, not fixable here
  let { inside, kept } = split(validate(days, kctx)), repaired = false
  if (inside.length) { const r = repair(days, kctx); days = r.days; const s = split(validate(days, kctx)); inside = s.inside.concat(r.blocks); kept = s.kept; repaired = true }
  return { days, violations: inside, kept_violations: kept, repaired }
}
