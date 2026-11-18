// Smart Pre-Run Session Prescription & Execution Brief Engine
// Synthesises locked rules ([1] Sleep HR <= 67, [3] HRV status, [5] Pain < 2/10, [7] Weekly km <= +10%, [9] Opening 0-10 km HR & pace cap),
// VDOT training paces, tropical WBGT thermal adjustments (Ely 2007), and session-specific CHO/hydration schedules.
import { paces, fmtPace } from './vdot.js'
import { heatPenalty } from './pacing.js'
import { HARD } from './gate.js'

export function buildSessionPrescription({
  day = null,
  readiness = null,
  healthRow = null,
  dailyCheckin = {},
  twinLoad = null,
  vdot = 31.7,
  wbgt = 27,
} = {}) {
  const p = paces(vdot || 31.7)
  const pen = heatPenalty(wbgt) // fractional slowdown (0 to 0.08)
  const adj = (sec) => Math.round(sec * (1 + pen))

  const sleepHr = dailyCheckin?.sleepHR !== '' && dailyCheckin?.sleepHR != null
    ? +dailyCheckin.sleepHR
    : healthRow?.sleep_hr_avg ?? null
  const hrvReduced = dailyCheckin?.hrv === 'reduced' || /reduced|low|unbalanced|poor/i.test(healthRow?.hrv_status || '')
  const pain = dailyCheckin?.pain !== '' && dailyCheckin?.pain != null ? +dailyCheckin.pain : 0
  const kmSpike = twinLoad?.km_vs_4wk_avg_pct != null && twinLoad.km_vs_4wk_avg_pct > 10
  const tsb = twinLoad?.tsb ?? null
  const heavyLoad = tsb != null && tsb < -35

  const kind = day?.kind || 'easy'
  const isHard = HARD.has(kind)
  const plannedKm = day?.km || 0

  // Evaluate locked rules & readiness gate
  const breaches = []
  if (sleepHr != null && sleepHr > 67) breaches.push({ rule: '[1]', text: `Sleep HR ${Math.round(sleepHr)} bpm (> 67 bpm hard ceiling)` })
  if (hrvReduced) breaches.push({ rule: '[3]', text: 'Overnight HRV is Reduced vs personal baseline' })
  if (pain >= 2) breaches.push({ rule: '[5]', text: `Pain ${pain}/10 (≥ 2/10 triggers durability protection)` })
  if (kmSpike && isHard) breaches.push({ rule: '[7]', text: `Weekly volume +${twinLoad.km_vs_4wk_avg_pct}% vs 4-wk avg (limit +10%)` })

  let verdict = 'go' // 'go' | 'scale' | 'easy_only' | 'rest'
  let headline = 'Cleared to execute as planned'
  let effectiveKm = plannedKm

  if (pain >= 3 || (sleepHr != null && sleepHr > 72 && hrvReduced)) {
    verdict = 'rest'
    headline = 'Rest or 20–30 min recovery walk only — autonomic/structural gate triggered'
    effectiveKm = 0
  } else if (breaches.length > 0 && isHard) {
    verdict = 'easy_only'
    headline = 'Downgrade quality to Easy aerobic run (Z1–Z2) — locked gate active'
    effectiveKm = Math.min(6, Math.round(plannedKm * 0.65 * 10) / 10 || 5)
  } else if ((readiness?.score != null && readiness.score < 60) || heavyLoad) {
    verdict = isHard ? 'scale' : 'go'
    headline = isHard
      ? 'High cumulative fatigue — trim volume by 25% and cap HR strictly'
      : 'Easy aerobic volume only — keep effort conversational'
    if (isHard && plannedKm > 0) effectiveKm = Math.round(plannedKm * 0.75 * 10) / 10
  }

  // Target pace band (dry vs WBGT-adjusted)
  const rawBand = kind === 'quality'
    ? [p.T, p.M]
    : kind === 'tt'
      ? [p.I, p.T]
      : kind === 'race'
        ? [p.M, p.M + 15]
        : [p.E[1], p.E[0]]

  const effectiveBand = verdict === 'easy_only' ? [p.E[1], p.E[0]] : rawBand
  const heatBand = [adj(effectiveBand[0]), adj(effectiveBand[1])]

  // Rule [9] Opening 0-10 km ceiling (prevents km-5 fade seen in [648] and [644])
  const openingHrCap = verdict === 'easy_only' || kind === 'easy' || kind === 'long'
    ? 152
    : kind === 'race'
      ? 158
      : 162
  const openingPaceFloor = adj(Math.max(effectiveBand[0], p.M + 10))

  // Estimated duration & fueling schedule
  const avgPaceS = (heatBand[0] + heatBand[1]) / 2
  const estMin = effectiveKm > 0 ? Math.round((effectiveKm * avgPaceS) / 60) : 0

  const fueling = {
    needed: effectiveKm >= 12 || estMin >= 75 || kind === 'long' || kind === 'race',
    mealBufferMin: isHard || kind === 'long' || kind === 'race' ? 90 : 60,
    giFlushKm: isHard || kind === 'long' || kind === 'race' ? 0.7 : 0,
    choRateGh: kind === 'race' || effectiveKm >= 24 ? '50–60 g/h' : effectiveKm >= 14 ? '40–50 g/h' : '30 g/h',
    fluidMlh: wbgt >= 28 ? '650–800 mL/h' : wbgt >= 24 ? '500–650 mL/h' : '400–550 mL/h',
    sodiumMgh: wbgt >= 27 ? '600–800 mg/h' : '400–500 mg/h',
    gelSchedule: [],
  }

  if (fueling.needed && estMin > 0) {
    const intervalMin = wbgt >= 28 ? 25 : 28
    for (let m = 30; m <= estMin - 12; m += intervalMin) {
      const approxKm = Math.round((m * 60 / avgPaceS) * 10) / 10
      fueling.gelSchedule.push({ min: m, km: approxKm, item: m === 30 ? 'Gel #1 (25g CHO + 150mL water)' : `Gel #${fueling.gelSchedule.length + 1} (25g CHO + electrolytes)` })
    }
  }

  return {
    verdict,
    headline,
    plannedKm,
    effectiveKm,
    estMin,
    wbgt,
    heatPenaltyPct: +(pen * 100).toFixed(1),
    dryPaceText: `${fmtPace(effectiveBand[0])}–${fmtPace(effectiveBand[1])}/km`,
    heatPaceText: `${fmtPace(heatBand[0])}–${fmtPace(heatBand[1])}/km`,
    openingCap: {
      hrMaxBpm: openingHrCap,
      paceFloorText: `${fmtPace(openingPaceFloor)}/km`,
      ruleNote: 'Rule [9]: Hold km 0–10 strictly below HR cap to protect post-km 20 running share.',
    },
    breaches,
    fueling,
  }
}
