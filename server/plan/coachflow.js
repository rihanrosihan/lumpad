// Season plan with the AI selector (P5): prepare (deterministic, kernel-checked) -> rank slots -> ask the coach to pick among offered options -> apply picks on a copy ->
// kernel check again -> proposal. Any failure at any step leaves the engine's own ranked plan; the model can never make the result worse than engine-only.
import { prepareMacro, finishMacro } from './macroflow.js'
import { slotOptions, applyPicks } from './rank.js'
import { loadStats } from './stats.js'
import { planSignals } from './signals.js'
import { coachSelect, groundText, coachEnabled } from './planllm.js'
import { checkCandidate, dayAvail } from './macro.js'
import { mondayOf, addDays, diffDays } from '../../src/lib/dates.js'

const compactTwin = (s) => (s ? { durability_km: s.durability?.durability_km ?? null, fade_onset_km: s.durability?.fade_onset_km_median_90d ?? null, heat_bpm_per_c: s.heat?.hr_cost_bpm_per_c?.value ?? null, weekly_km_4w: s.load?.weekly_km_4w ?? null, readiness: s.readiness?.tier ?? null, pain_sites: Object.fromEntries(Object.entries(s.injury?.sites || {}).filter(([, v]) => v.last_pain >= 2).map(([k, v]) => [k, v.pain_free_days])) } : null)
const recentPain = (s, today) => Object.values(s?.injury?.sites || {}).some((v) => v.last_pain >= 2 && v.pain_free_days != null && v.pain_free_days < 14)

export async function proposeMacroCoach(db, args = {}, { complete, mdb, twinState = null, memoryRows = [], env = process.env } = {}) {
  const prep = prepareMacro(db, args); if (!prep.ok) return prep
  const { g, c, chk, av, today } = prep, start = g.report.start, weeks = Object.fromEntries(g.report.weeks.map((w) => [w.monday, w.km]))
  const sig = planSignals(memoryRows), ctx = { stats: loadStats(db), signals: sig.signals, injuredRecently: recentPain(twinState, today), weeklyKm: (d) => weeks[mondayOf(d)] ?? c.weekly4w, availMin: (d) => dayAvail(d, av).maxMin }
  const slots = slotOptions(chk.days, { from: start, weeks: 8, ctx, today })
  const header = { weekly_km_now: c.weekly4w, start, guard_baseline: c.guardBaseline, peak_cap_km: c.peakCap, goals: prep.goals.map((x) => ({ date: x.race_date, cls: x.cls, name: x.name })) }
  const sel = await coachSelect({ slots, header, twin: compactTwin(twinState), memories: memoryRows, complete, mdb, env })
  const ap = applyPicks(chk.days, slots, sel.picks), re = checkCandidate(ap.days, c, start)
  let days = re.days, note = null
  if (re.violations.length) { days = chk.days; note = `coach picks rejected by the kernel (${re.violations[0].rule}); engine plan kept` }   // cannot happen by construction, but the check is the guarantee
  const evidence = { ...(sel.evidence || {}), plan: { peak_before: Math.max(...Object.values(Object.fromEntries(prep.plan.reduce((m, d) => m.set(mondayOf(d.date), (m.get(mondayOf(d.date)) || 0) + (d.kind === 'race' ? 0 : d.km || 0)), new Map())))), peak_after: g.report.peak_km, weekly_km_now: c.weekly4w, goals: prep.goals.length, cutback: g.report.cutback } }
  const gr = groundText(sel.summary, evidence)
  const coachNotes = { engine_only: sel.engineOnly || !!note, reason: note || sel.reason, applied: ap.applied.filter((x) => x.how !== 'default').length, defaults_applied: ap.applied.filter((x) => x.how === 'default').length, fallbacks: ap.fallback, reply_errors: sel.errors, summary_unverified: gr.unverified, signals_used: sig.used, slots: slots.length, reused: !!sel.reused }
  const r = finishMacro(db, prep, { trigger: args.trigger ?? null, by: 'engine', days, rationaleLlm: note ? null : gr.text, coachRunId: sel.runId, tokens: sel.tokens, coachNotes })
  return { ...r, coach: coachNotes }
}
export { coachEnabled }
