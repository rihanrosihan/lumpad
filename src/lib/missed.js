// Home: "the afternoon check found no run today". Pure rules that turn a missed session into scenarios:
// run it this evening, move it to tomorrow (several week-level checks), or let it go. Advice only: the plan data is never edited.
import { addDays, dowOf, mondayOf } from './dates.js'
import { isLowerDay } from './strength.js'

export const AFTERNOON_FROM = 10 // WIB hour: before this the day is not "missed" yet
const HARD = new Set(['quality', 'tt', 'speed', 'long'])
const RUNKM = (d) => (d && d.km > 0 && !['rest', 'gym'].includes(d.kind) ? d.km : 0)
const r1 = (n) => Math.round(n * 10) / 10
const isHard = (d) => !!d && HARD.has(d.kind)
const isRace = (d) => !!d && (d.kind === 'race' || /race|gate|CP\d/i.test(`${d.label || ''} ${(d.tags || []).join(' ')}`))
export const REASONS = [
  { id: 'time', label: 'No time / busy' }, { id: 'weather', label: 'Weather / heat' },
  { id: 'tired', label: 'Tired / low energy' }, { id: 'sick', label: 'Sick or pain' },
]
const chk = (ok, text, level) => ({ ok, text, level: ok ? 'ok' : level || 'fail' })
const verdictOf = (checks) => (checks.some((c) => c.level === 'fail') ? 'no' : checks.some((c) => c.level === 'warn') ? 'caution' : 'ok')

// plan: date → day. ctx: { hour, reason, load:{tsb,acwr}, tier, pain, weekly4w, raceDays }
export function missedPlan(plan, date, ctx = {}) {
  const day = plan[date], km = RUNKM(day), { hour = 15, reason = 'time', pain = null, tier = null, chose = null } = ctx
  if (!km || isRace(day) || hour < AFTERNOON_FROM) return null
  const tmr = plan[addDays(date, 1)], hard = isHard(day), tsb = ctx.load?.tsb ?? null, acwr = ctx.load?.acwr ?? null
  const sick = reason === 'sick' || (pain != null && pain >= 2), tired = reason === 'tired' || tier === 'compromised' || tier === 'depleted'
  const mon = mondayOf(date), week = Array.from({ length: 7 }, (_, i) => plan[addDays(mon, i)]).filter(Boolean)
  const weekKm = r1(week.reduce((s, d) => s + RUNKM(d), 0)), sunday = dowOf(date) === 0
  const out = { day, km, hard, weekKm, reason, chose, scenarios: [], recommended: null, note: null, eveningFailed: false }

  // 1. this evening
  const lateHard = hard && hour >= 18, tooLate = hour >= (hard ? 19 : 21)
  const ev = [
    chk(!sick, sick ? `${pain != null && pain >= 2 ? `Pain ${pain}/10` : 'Sick or pain'}: no run today (durability rule). Rest.` : 'No pain or illness reported.'),
    chk(!tooLate, tooLate ? `It is ${hour}:00 WIB: too close to bedtime for ${hard ? 'a hard' : 'a'} session; it would cost sleep, which the next run depends on.` : `There is still time (${hard ? 'start by 19:00' : 'start by 21:00'}).`),
    chk(!(hard && isHard(tmr)), hard && isHard(tmr) ? `Tomorrow is also hard (${tmr.label || tmr.kind}): two hard sessions in a row break the 48 h rule.` : 'Does not stack on a hard session tomorrow.'),
    chk(!(hard && tired), hard && tired ? 'You marked low energy / readiness is down: a hard session tonight is the wrong dose.' : 'Energy and readiness do not rule it out.', 'warn'),
    chk(!(hard && (lateHard || (tsb != null && tsb < -30) || (acwr != null && acwr > 1.3))), hard ? (lateHard ? 'A hard effort after 18:00 raises sleep heart rate (rule: sleep HR above 67 downgrades the next hard session).' : tsb != null && tsb < -30 ? `Form ${tsb} is below −30.` : acwr != null && acwr > 1.3 ? `Load ratio ${acwr} is above 1.3.` : 'Form and load allow a hard session.') : 'Easy session: no load rule applies.', 'warn'),
    chk(hour < 18, hour >= 18 ? 'It is dark after 18:00 in WIB: use a lit route or the treadmill.' : 'Daylight and cooler air in the evening.', 'warn'),
  ]
  const evKm = hard && (lateHard || tired) ? r1(Math.max(4, Math.min(km, km * 0.6))) : km
  const evV = sick || tooLate || (hard && isHard(tmr)) ? 'no' : verdictOf(ev)
  out.scenarios.push({
    id: 'evening', title: 'Run it this evening', verdict: evV, checks: ev, weekKm,
    do: hard && evKm < km ? `Easy-effort version, ${evKm} km (HR zone 1–2), not the structured session.` : `${day.label || day.kind} · ${km} km as planned.`,
    week: `Week stays at ${weekKm} km. Nothing else moves.`,
  })

  // 2. next day: move the session, with the checks that protect the rest of the week
  const after = addDays(date, 2), next = plan[after]
  const nextHard = Array.from({ length: 6 }, (_, i) => addDays(date, 2 + i)).map((d) => plan[d]).find((d) => isHard(d) || isRace(d))
  const gap = nextHard ? Math.round((Date.parse(nextHard.date + 'T12:00:00Z') - Date.parse(addDays(date, 1) + 'T12:00:00Z')) / 864e5) : 9
  const tmrRun = RUNKM(tmr), tmrRest = !tmrRun && (!tmr || tmr.kind === 'rest')
  const restLeft = week.filter((d) => d.date > addDays(date, 1) && d.kind === 'rest').length
  const crosses = sunday // tomorrow is the next plan week
  const drop = tmrRun // that session is dropped (never stacked: no double days, no make-up volume)
  const wkAfter = r1(weekKm - (crosses ? km : 0) - (crosses ? 0 : drop))
  const guard = ctx.weekly4w != null ? r1(ctx.weekly4w * 1.1) : null
  const cpSoon = Array.from({ length: 4 }, (_, i) => plan[addDays(date, 1 + i)]).find((d) => isRace(d))
  const nx = [
    chk(!sick, sick ? 'Not today and not tomorrow by force: rest, then re-check at tomorrow\'s sync (pain 2/10+ shortens, 4/10+ is a clinician).' : 'No pain or illness reported.'),
    chk(!isHard(tmr), isHard(tmr) ? `Tomorrow already holds a key session (${tmr.label || tmr.kind}): do not double up and do not replace it. Keep tomorrow, drop today's.` : 'Tomorrow is not a key session.'),
    chk(!(hard && gap < 2), hard && gap < 2 ? `It would sit ${gap * 24} h before the next hard day (${nextHard.label || nextHard.kind}, ${nextHard.date.slice(5)}): needs 48 h.` : hard ? `Next hard session is ${gap} days after it: recovery gap is fine.` : 'Easy session: no recovery gap needed.', 'fail'),
    chk(!(hard && isLowerDay(tmr)), hard && isLowerDay(tmr) ? 'Tomorrow is a lower-body gym day: a hard run on top of it stacks leg fatigue.' : 'No lower-body gym load tomorrow.', 'warn'),
    chk(!(hard && ((tsb != null && tsb < -30) || (acwr != null && acwr > 1.3))), hard && tsb != null && tsb < -30 ? `Form ${tsb} below −30: tomorrow it has to be easy.` : hard && acwr != null && acwr > 1.3 ? `Load ratio ${acwr} above 1.3: tomorrow it has to be easy.` : 'Form and load ratio allow it.', 'warn'),
    chk(restLeft >= 1 || tmrRest || !hard, restLeft >= 1 || tmrRest || !hard ? (tmrRest ? 'It uses tomorrow\'s rest day; the rest of the week keeps its easy days.' : `${restLeft} rest day(s) remain this week.`) : 'It would remove the last rest day of the week.', 'warn'),
    chk(!cpSoon, cpSoon ? `A race/checkpoint is on ${cpSoon.date.slice(5)}: do not move hard work next to it.` : 'No race or checkpoint within 4 days.', 'warn'),
    chk(!(guard != null && wkAfter > guard), guard != null && wkAfter > guard ? `Week would be ${wkAfter} km; the +10 % guard allows ${guard} km.` : `Week km does not go up (${wkAfter} km vs ${weekKm} planned).`, 'warn'),
    chk(!crosses, crosses ? 'Today is Sunday: moving it pushes into next week and shifts its first days. Prefer letting it go.' : 'Stays inside this training week.', 'warn'),
    chk(!tired, tired ? 'Low energy: tomorrow only if the morning check-in (sleep, HRV, pain) is green.' : 'No low-energy flag.', 'warn'),
  ]
  const nxV = sick || isHard(tmr) || (hard && gap < 2) ? 'no' : verdictOf(nx)
  const tmrEasyKm = hard && ((tsb != null && tsb < -30) || (acwr != null && acwr > 1.3)) ? r1(Math.min(km * 0.6, 8)) : km
  out.scenarios.push({
    id: 'tomorrow', title: 'Move it to tomorrow', verdict: nxV, checks: nx, weekKm: wkAfter,
    do: tmrRest ? `Run it on tomorrow's rest day${tmrEasyKm < km ? ` as an easy ${tmrEasyKm} km` : ''}.` : tmrRun && !isHard(tmr) ? `Swap: ${tmrEasyKm < km ? `easy ${tmrEasyKm} km` : `${day.label || day.kind} · ${km} km`} tomorrow; tomorrow's ${tmr.label || tmr.kind} (${tmr.km} km) is dropped, not stacked.` : `Replace tomorrow's ${tmr?.label || tmr?.kind} with it only after the morning check.`,
    week: crosses ? `Spills into next week; this week ends at ${wkAfter} km (−${r1(km)} km).` : `Week ends at ${wkAfter} km (${r1(wkAfter - weekKm)} km vs plan); no extra volume to make up.`,
    revisit: 'Re-decide at tomorrow\'s sync: sleep HR above 67, HRV reduced or pain 2/10+ cancels the move.',
  })

  // 3. let it go
  const lost = r1(km), pct = weekKm ? Math.round((1 - (weekKm - lost) / weekKm) * 100) : 0
  const sk = [
    chk(true, 'No make-up: never add the missed km onto other days (the +10 % guard and the 48 h rule stay).'),
    chk(!(hard && ['long'].includes(day.kind)), hard && day.kind === 'long' ? 'Long run: it is the week\'s key session. Skipping is allowed once; two in a row is a plan review.' : hard ? 'A quality session: skipping once costs little, do not chase it.' : 'An easy run: skipping costs almost nothing.', 'warn'),
    chk(pct <= 25, pct > 25 ? `The week would lose ${pct}% of its km.` : `The week loses ${pct}% of its km (${lost} of ${weekKm}).`, 'warn'),
  ]
  out.scenarios.push({
    id: 'skip', title: 'Let it go', verdict: sick ? 'ok' : verdictOf(sk) === 'no' ? 'caution' : verdictOf(sk), checks: sk, weekKm: r1(weekKm - lost),
    do: 'Rest or an easy 20–30 min walk, sleep target met. The plan resumes tomorrow unchanged.',
    week: `Week ends at ${r1(weekKm - lost)} km (−${lost} km, ${pct}%).`,
  })

  // recommendation: sick → skip; else best verdict, evening first for easy / time reasons, tomorrow first for tired
  const rank = { ok: 0, caution: 1, no: 2 }, by = Object.fromEntries(out.scenarios.map((s) => [s.id, s]))
  const order = sick ? ['skip'] : tired ? ['tomorrow', 'skip', 'evening'] : reason === 'weather' ? ['evening', 'tomorrow', 'skip'] : ['evening', 'tomorrow', 'skip']
  out.recommended = order.slice().sort((a, b) => rank[by[a].verdict] - rank[by[b].verdict] || order.indexOf(a) - order.indexOf(b))[0]
  out.eveningFailed = chose === 'evening' && tooLate && !sick
  if (out.eveningFailed) { out.recommended = by.tomorrow.verdict === 'no' ? 'skip' : by.tomorrow.verdict === 'caution' && by.skip.verdict === 'ok' && hard && day.kind === 'long' ? 'tomorrow' : out.recommended === 'evening' ? 'tomorrow' : out.recommended; if (out.recommended === 'tomorrow' && by.tomorrow.verdict === 'no') out.recommended = 'skip' }
  out.note = out.eveningFailed ? `You planned the evening run, but it is ${hour}:00 WIB and no run was recorded. Tonight is closed (running now costs tomorrow's sleep). Pick tomorrow, if its checks allow, or let it go.` : sick ? 'Sick or pain beats the plan: rest is the plan.' : null
  return out
}
