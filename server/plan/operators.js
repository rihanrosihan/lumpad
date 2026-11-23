// Micro-patch operators (P3). Pure: (plan {date: day}, args) -> patch | null. A patch = { operator, changes:[{date, before, after}], rules:[ids], rationale }.
// `after` is a full plan.json-shaped day. Operators only ever lower load (km, intensity) or move a session; the kernel re-checks every patch before it can become a version.
// The decisions of the old features are reused, not copied: scaler.proposeScale (72 h gate downgrade) and missed.missedPlan (missed-run scenarios).
import { proposeScale, gateActive } from '../../src/lib/scaler.js'
import { missedPlan } from '../../src/lib/missed.js'
import { addDays } from '../../src/lib/dates.js'
import { estimate, stepKm, flat } from '../../src/lib/zones.js'
import { expand } from './catalog.js'

const r1 = (x) => Math.round(x * 10) / 10
const LOCKED = (d) => !d || d.kind === 'race' || /race|gate|CP\d/i.test(`${d.label || ''} ${(d.tags || []).join(' ')}`)
const REST = { kind: 'rest', km: 0, label: '', steps: undefined, sec: undefined, tl: undefined, code: undefined, from: undefined, scaled: undefined }
const easySteps = (km) => expand('coros.P10540', { km })
const withEst = (d) => { if (!d.steps?.length || d.steps.some((s) => s.t === 'free')) return d; const e = estimate(d.steps); return { ...d, sec: e.sec, tl: e.tl } }
// scale the distance of every non-warm-up/cool-down step by f
export const scaleSteps = (steps, f) => steps.map((s) => (s.rep ? { ...s, steps: scaleSteps(s.steps, f) } : s.m && s.t !== 'wu' && s.t !== 'cd' ? { ...s, m: Math.round(s.m * f) } : s))
const mk = (operator, changes, rules, rationale, extra = {}) => (changes.length ? { operator, changes, rules, rationale, ...extra } : null)
const ch = (date, before, after) => ({ date, before, after: { ...before, ...after, date } })

// 72 h gate downgrade (scaler.js). gate = { tierId, caps, progPct } as for scaler.gateActive.
export function downgrade(plan, today, gateIn) {
  const gate = gateActive(gateIn), prop = proposeScale(plan, today, gate)
  const changes = Object.entries(prop).map(([date, p]) => ch(date, plan[date], withEst({ kind: 'easy', label: p.to.label, km: p.to.km, steps: easySteps(p.to.km), note: 'Readiness gate: easy only, HR-capped.', hr_max: 148, scaled: true, src: 'engine', code: undefined, from: undefined })))
  return mk('downgrade', changes, ['R-GATE'], `Readiness gate active (${gate.reasons.join('; ')}): ${changes.length} hard session(s) in the next 72 h become easy — ${changes.map((c) => `${c.date.slice(5)} ${c.before.label || c.before.kind} ${c.before.km} km → easy ${c.after.km} km`).join(', ')}.`)
}
export function trim(plan, date, pct) {
  const d = plan[date]; if (!d || LOCKED(d) || !(d.km > 0) || pct >= 1) return null
  const km = r1(d.km * pct), steps = d.steps ? scaleSteps(d.steps, km / d.km) : d.steps
  return mk('trim', [ch(date, d, withEst({ km, steps, scaled: true, src: 'engine' }))], ['R-LOAD-10'], `${date.slice(5)} ${d.label || d.kind} trimmed from ${d.km} km to ${km} km (${Math.round(pct * 100)} %).`)
}
export function drop(plan, date, why = 'let it go') {
  const d = plan[date]; if (!d || LOCKED(d) || !(d.km > 0)) return null
  return mk('drop', [ch(date, d, { ...REST, note: `Dropped (${why}); no make-up volume.`, src: 'engine' })], ['R-NO-MAKEUP'], `${date.slice(5)} ${d.label || d.kind} (${d.km} km) dropped: ${why}. Nothing is added to other days.`)
}
// session of `from` takes the place of `to` (whatever was there is dropped, never stacked); `from` becomes rest. km override = run it as an easy session of that length.
export function move(plan, from, to, { easyKm = null } = {}) {
  const a = plan[from], b = plan[to]; if (!a || LOCKED(a) || LOCKED(b) || !(a.km > 0) || from === to) return null
  const moved = easyKm != null && easyKm < a.km ? withEst({ ...a, kind: 'easy', label: 'Moved easy run', km: easyKm, steps: easySteps(easyKm), src: 'engine', code: undefined, from: undefined }) : { ...a, src: 'engine' }
  return mk('move', [ch(to, b || { date: to, kind: 'rest', km: 0, label: '' }, { ...moved, date: to, week: b?.week ?? a.week, phase: b?.phase ?? a.phase, tags: b?.tags ?? [] }), ch(from, a, { ...REST, note: `Moved to ${to.slice(5)}.` })], ['R-48H', 'R-NO-MAKEUP'],
    `${from.slice(5)} ${a.label || a.kind} (${a.km} km) moved to ${to.slice(5)}${easyKm != null && easyKm < a.km ? ` as an easy ${easyKm} km` : ''}${b && b.km > 0 ? `; ${to.slice(5)}'s ${b.label || b.kind} (${b.km} km) is dropped, not stacked` : ''}.`)
}
export function swap(plan, d1, d2) {
  const a = plan[d1], b = plan[d2]; if (!a || !b || LOCKED(a) || LOCKED(b)) return null
  const keep = (x, y) => ({ ...x, date: y.date, week: y.week, phase: y.phase, tags: y.tags })
  return mk('swap', [ch(d1, a, keep(b, a)), ch(d2, b, keep(a, b))], ['R-48H'], `${d1.slice(5)} ${a.label || a.kind} and ${d2.slice(5)} ${b.label || b.kind} swapped.`)
}
// same purpose, safer execution: heat / indoor / aqi
export function variant(plan, date, kind) {
  const d = plan[date]; if (!d || LOCKED(d) || !(d.km > 0)) return null
  const hard = ['quality', 'tt', 'long'].includes(d.kind), tag = { heat: 'HR-capped for heat', indoor: 'treadmill', aqi: 'indoor (air quality)' }[kind]; if (!tag) return null
  return mk('variant', [ch(date, d, { hr_max: kind === 'heat' || hard ? 148 : d.hr_max, variant: kind, label: `${d.label || d.kind} (${tag})`, note: `${d.note || ''} ${kind === 'heat' ? 'Run by HR, not pace.' : 'Same session, safer setting.'}`.trim(), src: 'engine' })], [kind === 'aqi' ? 'R-AQI' : 'R-HEAT'], `${date.slice(5)} ${d.label || d.kind}: ${tag}.`)
}
export function timeShift(plan, date, window) {
  const d = plan[date]; if (!d || LOCKED(d)) return null
  return mk('time_shift', [ch(date, d, { time_window: window, note: `${d.note || ''} Start ${window}.`.trim(), src: 'engine' })], ['R-HEAT'], `${date.slice(5)} ${d.label || d.kind}: start ${window}.`)
}
// next quality session one zone step easier: +15 s/km on its target pace, no extra volume (replan rule 4)
export const stepDown = (plan, date, deltaS = 15) => { const d = plan[date]; return !d || LOCKED(d) || d.kind !== 'quality' ? null : mk('step_down', [ch(date, d, { pace_delta_s_km: deltaS, note: `${d.note || ''} Target pace +${deltaS} s/km.`.trim(), src: 'engine' })], ['R-TIZ'], `${date.slice(5)} ${d.label || d.kind}: target pace +${deltaS} s/km, no added volume.`) }
export function hrCap(plan, dates, max = 148) {
  const changes = dates.map((x) => plan[x]).filter((d) => d && d.kind === 'easy' && d.km > 0 && !LOCKED(d)).map((d) => ch(d.date, d, { hr_max: max, label: `${d.label} (HR-capped ≤${max})`, src: 'engine' }))
  return mk('hr_cap', changes, ['R-Z2-CREEP'], `Easy runs ${changes.map((c) => c.date.slice(5)).join(', ')} capped at ${max} bpm (intensity creep).`)
}
export const insertRecovery = (plan, date, km = 5) => { const d = plan[date]; return !d || LOCKED(d) || d.km > 0 ? null : mk('insert_recovery', [ch(date, d, withEst({ kind: 'easy', label: 'Recovery Run', km, steps: [{ t: 'run', m: km * 1000, z: 1 }], note: 'Inserted after an unplanned hard effort.', src: 'engine' }))], ['R-48H'], `${date.slice(5)}: recovery run ${km} km inserted.`) }

// replan.go proposals (replan.js) -> patches
export function fromReplan(plan, proposals) {
  const out = []
  for (const p of proposals) {
    if (p.rule_id === 'z2_intensity_creep' && p.changes) out.push(hrCap(plan, p.changes.map((c) => c.date)))
    else if (p.rule_id === 'quality_low_compliance_stepdown') { const next = Object.values(plan).filter((d) => d.date >= p.scope_from && d.kind === 'quality').sort((a, b) => a.date.localeCompare(b.date))[0]; if (next) out.push(stepDown(plan, next.date, p.pace_delta_s_km)) }
  }
  return out.filter(Boolean)
}

// missed-run card (missed.js): the athlete chose a scenario (or accepts the recommendation) -> the patch that implements it. null = nothing to change.
export function fromMissed(plan, date, ctx = {}, choice = null) {
  const m = missedPlan(plan, date, ctx); if (!m) return { missed: null, patch: null }
  const id = choice || m.recommended, sc = m.scenarios.find((s) => s.id === id)
  if (!sc || sc.verdict === 'no') return { missed: m, patch: null, refused: sc ? `${id}: ${sc.checks.filter((c) => c.level === 'fail').map((c) => c.text).join(' ')}` : 'unknown scenario' }
  const easyKm = /(?:Easy-effort version|as an easy|easy) ([\d.]+) km/.exec(sc.do)?.[1]
  let patch = null
  if (id === 'skip') patch = drop(plan, date)
  else if (id === 'tomorrow') patch = move(plan, date, addDays(date, 1), { easyKm: easyKm ? +easyKm : null })
  else if (id === 'evening' && easyKm && +easyKm < m.km) patch = trim(plan, date, +easyKm / m.km)
  if (patch) patch.rationale = `Missed run, choice "${id}" (${sc.verdict}): ${patch.rationale}`
  return { missed: m, patch, choice: id }
}
export { LOCKED, REST }
