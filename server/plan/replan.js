// JS port of lumpadd/internal/decision/replan.go (Phase 5 deterministic rules). Input and output use the Go field names on purpose, so the same
// vectors (server/plan/vectors/replan.json) drive both implementations. Rule -> kernel id: see RULE_MAP.
export const Z2_CEILING_BPM = 148.0, MAX_WEEKLY_RAMP = 1.10, MAX_LONG_RUN_RATIO = 1.10
export const RULE_MAP = { gate_72h_downgrade: 'R-GATE', weekly_progression_cap: 'R-LOAD-10', pain_progression_freeze: 'R-PAIN-FREEZE', long_run_110_cap: 'R-LR-110', quality_low_compliance_stepdown: 'R-TIZ', z2_intensity_creep: 'R-Z2-CREEP', taper_volume_window: 'R-TAPER' }
const round1 = (v) => Math.round(v * 10) / 10 // Go math.Round rounds half away from zero; identical for the non-negative values used here
const f1 = (v) => v.toFixed(1)
const sess = (s) => ({ date: s.date, kind: s.kind, label: s.label, km: s.km, ...(s.hr_max ? { hr_max: s.hr_max } : {}) }) // hr_max is omitempty in Go

export function evaluateReplan(inp) {
  const out = [], n72 = inp.Next72h || []
  if (inp.GateActive) {
    const ch = []
    for (const s of n72) if (['quality', 'long', 'race'].includes(s.kind)) ch.push({ date: s.date, from: sess(s), to: sess({ ...s, kind: 'easy', label: 'Easy / Rehab (gate downgrade)', km: round1(Math.min(s.km * 0.75, 10.0)), hr_max: Math.trunc(Z2_CEILING_BPM) }) })
    if (ch.length) out.push({ rule_id: 'gate_72h_downgrade', scope_from: ch[0].date, scope_to: ch.at(-1).date, changes: ch, reason: 'Active gate (' + (inp.GateReason || 'validated physiological/pain gate active') + '): downgrade hard sessions in next 72h to easy/rehab.', expected: { pain_max: 0, hr_cap_bpm: Z2_CEILING_BPM } })
  }
  if (inp.Prev4WeekAvgKm > 0) {
    let mult = MAX_WEEKLY_RAMP, ruleId = 'weekly_progression_cap', reason = `Weekly planned volume (${f1(inp.PlannedWeekKm)} km) exceeds +10% cap over 4-week average (${f1(inp.Prev4WeekAvgKm)} km).`
    if (inp.PainEventLast7d) { mult = 1.0; ruleId = 'pain_progression_freeze'; reason = `Pain >= 2/10 in last 7 days freezes weekly progression at 4-week average (${f1(inp.Prev4WeekAvgKm)} km).` }
    const capKm = round1(inp.Prev4WeekAvgKm * mult)
    if (inp.PlannedWeekKm > capKm + 0.05) out.push({ rule_id: ruleId, scope_from: inp.AsOf, scope_to: inp.AsOf, changes: null, reason, expected: { weekly_km_max: capKm, pain_max: 1 }, cap_km: capKm })
  }
  if (inp.Max30dLongRunKm > 0 && inp.NextWeekLongRunKm > 0) {
    const lrCap = round1(inp.Max30dLongRunKm * MAX_LONG_RUN_RATIO)
    if (inp.NextWeekLongRunKm > lrCap + 0.05) {
      let why = `Next long run (${f1(inp.NextWeekLongRunKm)} km) exceeds 110% of 30-day longest run (${f1(inp.Max30dLongRunKm)} km → cap ${f1(lrCap)} km).`
      if (inp.MissedLongRun) why = 'Missed long run cannot add extra volume: ' + why
      out.push({ rule_id: 'long_run_110_cap', scope_from: inp.AsOf, scope_to: inp.AsOf, changes: null, reason: why, expected: { long_run_km_max: lrCap, durability_pain_max: 1 }, cap_km: lrCap })
    }
  }
  const q = inp.RecentQualityTIZ || []
  if (q.length >= 2 && q.at(-1) < 70 && q.at(-2) < 70) out.push({ rule_id: 'quality_low_compliance_stepdown', scope_from: inp.AsOf, scope_to: inp.AsOf, changes: null, pace_delta_s_km: 15, reason: `Last 2 quality sessions had <70% time in zone (${q.at(-2).toFixed(0)}%, ${q.at(-1).toFixed(0)}%): lower target pace by one step (+15 s/km) without adding volume.`, expected: { next_quality_tiz_min_pct: 75 } })
  if (inp.EasyRunsAboveZ214d >= 3) {
    const ch = []
    for (const s of n72) if (s.kind === 'easy') ch.push({ date: s.date, from: sess(s), to: sess({ ...s, hr_max: Math.trunc(Z2_CEILING_BPM), label: s.label + ' (HR-capped ≤148)' }) })
    out.push({ rule_id: 'z2_intensity_creep', scope_from: inp.AsOf, scope_to: inp.AsOf, changes: ch.length ? ch : null, reason: `${inp.EasyRunsAboveZ214d} easy runs averaged above Z2 ceiling (148 bpm) in the last 14 days: enforce HR-capped easy runs.`, expected: { easy_avg_hr_max: Z2_CEILING_BPM } })
  }
  if (inp.DaysToARace > 0 && inp.DaysToARace <= 21 && inp.PeakWeekKm > 0) {
    const tMin = round1(inp.PeakWeekKm * 0.40), tMax = round1(inp.PeakWeekKm * 0.60)
    if (inp.PlannedWeekKm > tMax + 0.05) out.push({ rule_id: 'taper_volume_window', scope_from: inp.AsOf, scope_to: inp.AsOf, changes: null, cap_km: tMax, reason: `Taper window (${inp.DaysToARace} days to A-race): keep weekly volume in ${f1(tMin)}–${f1(tMax)} km (-40% to -60% of ${f1(inp.PeakWeekKm)} km peak) with 1 sharp quality session.`, expected: { weekly_km_min: tMin, weekly_km_max: tMax, quality_sessions: 1 } })
  }
  return out
}
export function applyCaps(inp) {
  let w = inp.PlannedWeekKm, l = inp.NextWeekLongRunKm
  for (const p of evaluateReplan(inp)) {
    if (p.cap_km == null) continue
    if (['weekly_progression_cap', 'pain_progression_freeze', 'taper_volume_window'].includes(p.rule_id)) { if (p.cap_km < w) w = p.cap_km }
    else if (p.rule_id === 'long_run_110_cap' && p.cap_km < l) l = p.cap_km
  }
  return [w, l]
}
