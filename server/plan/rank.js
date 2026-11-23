// Menu ranking for the AI selector (P5). Pure. For each key slot (quality / long run) of a generated plan: which templates are eligible, how they score,
// and which one is the deterministic default. score = .35 purpose + .25 personal response + .20 context + .10 progression + .10 variety - penalties (blueprint 9.4).
// The model only ever picks among these ids; every pick is rebuilt and re-checked by the kernel, so a bad pick falls back to the default.
import { addDays, diffDays } from '../../src/lib/dates.js'
import { rebuildSlot, hiKmOf } from './macro.js'
import { estimate } from '../../src/lib/zones.js'

const KIND_OPTIONS = { quality: ['coros.P10541', 'coros.P10547', 'coros.P10544'], long: ['coros.P10594', 'coros.P10545'] }
const PURPOSE = { 'coros.P10541': 'aerobic_power', 'coros.P10544': 'aerobic_power', 'coros.P10547': 'threshold', 'coros.P10594': 'durability', 'coros.P10545': 'durability' }
// how well a template serves a phase (0..1): base builds aerobic power, build/peak add threshold, taper keeps it short, long runs with a Z3 finish only once the block is big
const FIT = { BASE: { aerobic_power: 1, threshold: 0.35, durability: 0.9 }, RAMADAN: { aerobic_power: 1, threshold: 0.2, durability: 0.9 }, BUILD: { aerobic_power: 0.7, threshold: 1, durability: 0.9 }, PEAK: { aerobic_power: 0.6, threshold: 1, durability: 1 }, TAPER: { aerobic_power: 0.8, threshold: 0.8, durability: 0.7 } }
const PHASES = { 'coros.P10541': ['BASE', 'RAMADAN', 'BUILD', 'PEAK', 'TAPER'], 'coros.P10544': ['BASE', 'RAMADAN', 'BUILD'], 'coros.P10547': ['BUILD', 'PEAK', 'TAPER'], 'coros.P10594': ['BASE', 'RAMADAN', 'BUILD', 'PEAK', 'TAPER'], 'coros.P10545': ['BUILD', 'PEAK'] }
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x))

// ctx: { stats: {template_id: row}, signals: {template_or_purpose: delta}, availMin?: (date)=>minutes, injuredRecently: bool, weeklyKm?: (date)=>km }
export function eligible(day, tpl, ctx = {}) {
  if (!(PHASES[tpl] || []).includes(day.phase)) return { ok: false, why: `not used in ${day.phase}` }
  if (tpl === 'coros.P10547' && (ctx.injuredRecently || (ctx.weeklyKm?.(day.date) ?? 99) < 25)) return { ok: false, why: ctx.injuredRecently ? 'pain in the last 14 days: no threshold work' : 'weekly volume below 25 km' }
  if (tpl === 'coros.P10545' && (ctx.weeklyKm?.(day.date) ?? 99) < 40) return { ok: false, why: 'weekly volume below 40 km' }
  const b = rebuildSlot(day, tpl, day.km); if (!b) return { ok: false, why: 'does not fit the slot without more load' }
  const mins = ctx.availMin?.(day.date); if (mins && mins < 999 && estimate(b.steps).sec / 60 > mins) return { ok: false, why: `needs ${Math.round(estimate(b.steps).sec / 60)} min, ${mins} available` }
  return { ok: true, built: b }
}
export function score(day, tpl, built, ctx = {}, today = '2026-11-23') {
  const st = ctx.stats?.[tpl], purpose = PURPOSE[tpl]
  const purposeFit = FIT[day.phase]?.[purpose] ?? 0.5
  const personal = st && st.n >= 3 ? clamp(0.5 * (st.adherence ?? 50) / 100 + 0.3 * (1 - (st.pain48h_rate ?? 0)) + 0.2 * (1 - (st.skip_rate ?? 0))) : 0.5
  const mins = ctx.availMin?.(day.date), context = mins && mins < 999 ? clamp(1 - Math.max(0, estimate(built.steps).sec / 60 - mins * 0.8) / mins) : 1
  const last = st?.last_done, progression = last ? clamp(1 - Math.abs(built.km - (st.last_km ?? built.km)) / Math.max(1, st.last_km ?? built.km)) : 0.8
  const variety = last ? clamp(diffDays(day.date, last) / 14) : 1
  const penalty = clamp(Math.abs(Math.min(0, (ctx.signals?.[tpl] ?? 0) + (ctx.signals?.[purpose] ?? 0))), 0, 0.25)   // only memories at MEASURED or better reach here (signals.js)
  const total = 0.35 * purposeFit + 0.25 * personal + 0.2 * context + 0.1 * progression + 0.1 * variety - penalty
  return { total: Math.round(total * 1000) / 1000, parts: { purposeFit, personal: Math.round(personal * 100) / 100, context, progression: Math.round(progression * 100) / 100, variety: Math.round(variety * 100) / 100, penalty } }
}
// the slots for the next `weeks` weeks of a candidate plan, each with its ranked options (best first). The first option is the deterministic default.
export function slotOptions(days, { from, weeks = 8, ctx = {}, today, max = 16 } = {}) {
  const to = addDays(from, weeks * 7), out = []
  for (const d of days) {
    if (d.date < from || d.date >= to || !KIND_OPTIONS[d.kind] || !(d.km > 0) || d.kind === 'tt') continue
    const opts = KIND_OPTIONS[d.kind].map((tpl) => { const e = eligible(d, tpl, ctx); return e.ok ? { id: tpl, name: e.built.label, km: e.built.km, hi_km: Math.round(hiKmOf(e.built) * 10) / 10, ...score(d, tpl, e.built, ctx, today), built: e.built } : null }).filter(Boolean)
    // the generator's own template is always offered (it already passed every check)
    if (d.template && !opts.some((o) => o.id === d.template)) opts.push({ id: d.template, name: d.label, km: d.km, hi_km: Math.round(hiKmOf(d) * 10) / 10, total: 0, parts: {}, built: d })
    opts.sort((a, b) => b.total - a.total || a.id.localeCompare(b.id))
    if (opts.length) out.push({ date: d.date, phase: d.phase, kind: d.kind, km: d.km, week_km: null, current: d.template ?? null, options: opts })
    if (out.length >= max) break
  }
  return out
}
// apply the model's picks to a COPY of the plan. A pick is accepted only if the id was offered for that slot AND the week's hard-km share stays under 20 %;
// anything else keeps the deterministic default (the best-ranked option). Returns { days, applied:[{date,id,how}], fallback:[{date,why}] }.
const monday = (x) => { const y = new Date(x + 'T12:00:00Z'); y.setUTCDate(y.getUTCDate() - ((y.getUTCDay() + 6) % 7)); return y.toISOString().slice(0, 10) }
export function applyPicks(days, slots, picks) {
  const out = days.map((d) => ({ ...d })), by = Object.fromEntries(out.map((d) => [d.date, d])), res = { applied: [], fallback: [] }
  const want = Object.fromEntries((Array.isArray(picks) ? picks : []).filter((p) => p && typeof p.slot === 'string').map((p) => [p.slot, p]))
  const weekOk = (date) => { const wk = out.filter((x) => monday(x.date) === monday(date)), tot = wk.filter((x) => x.kind !== 'race').reduce((a, x) => a + (x.km || 0), 0); return wk.reduce((a, x) => a + hiKmOf(x), 0) <= 0.2 * tot + 0.3 }
  for (const s of slots) {
    const def = s.options[0], p = want[s.date], opt = p ? s.options.find((o) => o.id === p.option) : null
    if (p && !opt) res.fallback.push({ date: s.date, why: `option "${p.option}" was not offered` })
    let chosen = opt || def, how = opt ? 'coach' : 'default'
    const prev = { ...by[s.date] }   // snapshot to restore (a reference would be mutated by the assign below)
    if (chosen.id !== s.current) {
      by[s.date] = Object.assign(by[s.date], { ...chosen.built }); out[out.findIndex((x) => x.date === s.date)] = by[s.date]
      if (!weekOk(s.date)) {   // the pick would make the week too hard: restore, then try the default
        Object.assign(by[s.date], prev); res.fallback.push({ date: s.date, why: 'the week would exceed 20 % hard km' })
        if (def.id !== s.current && chosen.id !== def.id) { Object.assign(by[s.date], { ...def.built }); if (weekOk(s.date)) { chosen = def; how = 'default' } else Object.assign(by[s.date], prev); }
        if (by[s.date].template === s.current) continue
      }
      res.applied.push({ date: s.date, id: by[s.date].template ?? chosen.id, how })
    } else if (how === 'coach') res.applied.push({ date: s.date, id: chosen.id, how: 'coach (unchanged)' })
  }
  return { days: out, ...res }
}
