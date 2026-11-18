// Composite readiness (docs/readiness-model.md §2). Transparent, evidence-weighted, capped by the athlete's validated gates.
import { lin, clamp } from './stats.js'

export const BASE_WEIGHTS = { msk: 30, ans: 30, sleep: 20, load: 20 }
export function weightsFor(phase) {
  if (phase === 'TAPER' || phase === 'RACE WEEK') return { msk: 30, ans: 30, sleep: 25, load: 15 }
  if (phase === 'PEAK') return { msk: 30, ans: 25, sleep: 20, load: 25 }
  return { ...BASE_WEIGHTS }
}
export const PILLAR = { msk: 'Musculoskeletal & subjective', ans: 'Autonomic (HRV, RHR)', sleep: 'Sleep', load: 'Load balance' }
export const TIERS = [{ min: 85, id: 'prime', label: 'Prime', color: 'green', advice: 'Ready for I/R work or a race effort.' }, { min: 65, id: 'optimal', label: 'Optimal', color: 'teal', advice: 'Run T, M or the long run as planned.' },
  { min: 45, id: 'compromised', label: 'Compromised', color: 'yellow', advice: 'Scale down: swap the hard session for easy, or cut volume 20–30 %.' }, { min: 0, id: 'depleted', label: 'Depleted', color: 'red', advice: 'Rest or very light recovery.' }]
export const tierOf = (s) => (s == null ? null : TIERS.find((t) => s >= t.min))

// component = { id, label, max, value (raw shown), pts | null (null = no data) }
function pillarScore(comps, weight) {
  const max = comps.reduce((a, c) => a + c.max, 0), have = comps.filter((c) => c.pts != null)
  const haveMax = have.reduce((a, c) => a + c.max, 0), got = have.reduce((a, c) => a + c.pts, 0)
  const scale = weight / max // components are defined on the base weight; rescale for phase-adjusted weights
  return { weight, haveWeight: haveMax * scale, earned: got * scale, comps: comps.map((c) => ({ ...c, max: c.max * scale, pts: c.pts == null ? null : c.pts * scale })) }
}
const has = (v) => v !== '' && v != null

// inputs: f (morning check-in), hrv (hrvState), rhr (rhrState), sleep (sleepState), pmcPoint, monotony, progression, muscleMax (0–3), phase, hard (bool, today's session is hard)
export function computeReadiness({ f = {}, hrv = {}, rhr = {}, sleep = {}, pmcPoint = null, monotony = null, progression = null, muscleMax = null, phase, hard = false, sleepHR = null }) {
  const w = weightsFor(phase)
  const msk = pillarScore([
    // v1.3 minimal check-in: pain (worst site) 15 + one "feel" item 12 + muscular load 3 = 30. Tibia is a pain site (cap below); soreness/hydration are optional and not scored.
    { id: 'pain', label: 'Pain while running (worst site)', max: 15, value: has(f.pain) ? f.pain + '/10' : null, pts: has(f.pain) ? (f.pain >= 2 ? 0 : f.pain === 1 ? 9 : 15) : null },
    { id: 'energy', label: 'How the body feels today', max: 12, value: has(f.energy) ? f.energy + '/5' : null, pts: has(f.energy) ? lin(f.energy, 1, 0, 5, 12) : null },
    { id: 'muscle', label: 'Muscle load (from strength work)', max: 3, value: muscleMax == null ? null : muscleMax.toFixed(1) + '/3', pts: muscleMax == null ? null : clamp(3 - muscleMax, 0, 3) },
  ], w.msk)
  const ans = pillarScore([
    { id: 'hrv7', label: 'HRV 7-day vs baseline', max: 16, value: hrv.enough ? `z ${hrv.z7}` : null, pts: hrv.enough ? lin(hrv.z7, -2, 0, -0.5, 16) : null },
    { id: 'hrvday', label: 'Overnight HRV', max: 5, value: hrv.enough && hrv.zToday != null ? `z ${hrv.zToday}` : null, pts: hrv.enough && hrv.zToday != null ? (hrv.zToday >= -1 ? 5 : 2) : null },
    { id: 'cv', label: 'Stabilitas HRV (CV)', max: 3, value: hrv.enough && hrv.cv7 != null ? hrv.cv7 + '%' : null, pts: hrv.enough && hrv.cv7 != null && hrv.cvMean != null ? (hrv.flagCv ? 0 : 3) : null },
    { id: 'rhr', label: 'Resting HR vs 30 days', max: 6, value: rhr.enough ? (rhr.dev > 0 ? '+' : '') + rhr.dev + ' bpm' : null, pts: rhr.enough ? lin(rhr.dev, 2, 6, 6, 0) : null },
  ], w.ans)
  const slp = pillarScore([
    { id: 'dur', label: 'Sleep vs need', max: 10, value: sleep.enough ? Math.round(sleep.asleep_min) + ' min' : null, pts: sleep.enough ? lin(sleep.asleep_min, sleep.need_min - 120, 0, sleep.need_min, 10) : null },
    { id: 'debt', label: 'Sleep debt 14 days', max: 6, value: sleep.nights >= 7 ? Math.round(sleep.debt_min / 6) / 10 + ' h' : null, pts: sleep.nights >= 7 ? lin(sleep.debt_min, 120, 6, 480, 0) : null },
    { id: 'eff', label: 'Sleep efficiency', max: 4, value: sleep.enough ? sleep.eff + '%' : null, pts: sleep.enough ? lin(sleep.eff, 75, 0, 90, 4) : null },
  ], w.sleep)
  const ld = pillarScore([
    { id: 'acwr', label: 'ACWR (EWMA)', max: 6, value: pmcPoint?.acwr ?? null, pts: pmcPoint?.acwr == null ? null : pmcPoint.acwr > 1.5 ? 0 : pmcPoint.acwr > 1.3 ? 3 : pmcPoint.acwr < 0.8 ? 5 : 6 },
    { id: 'form', label: 'Form (% fitness)', max: 6, value: pmcPoint?.tsbPct != null ? pmcPoint.tsbPct + '%' : null, pts: pmcPoint?.tsbPct == null ? null : pmcPoint.tsbPct >= -10 ? 6 : pmcPoint.tsbPct >= -30 ? 4 : 1 },
    { id: 'prog', label: 'Weekly distance progression', max: 5, value: progression?.pct != null ? progression.pct + '%' : null, pts: progression?.pct == null ? null : progression.pct < 10 ? 5 : progression.pct <= 30 ? 3 : 0 },
    { id: 'mono', label: 'Monotony 7-day', max: 3, value: monotony?.monotony ?? null, pts: monotony?.monotony == null ? null : monotony.monotony <= 1.5 ? 3 : monotony.monotony <= 2 ? 1.5 : 0 },
  ], w.load)

  const pillars = { msk, ans, sleep: slp, load: ld }
  const haveW = Object.values(pillars).reduce((a, p) => a + p.haveWeight, 0), earned = Object.values(pillars).reduce((a, p) => a + p.earned, 0)
  let score = haveW >= 60 ? Math.round((earned / haveW) * 100) : null
  // caps from the athlete's validated / project gates — the score can never contradict them
  const caps = []
  if (has(f.pain) && f.pain >= 2) caps.push({ max: 44, why: `Pain ${f.pain}/10 ≥ 2 → durability event` })
  const shr = has(f.sleepHR) ? f.sleepHR : sleepHR
  if (shr != null && shr > 67 && hard) caps.push({ max: 64, why: `Sleep HR ${shr} > 67 before a hard session [VALIDATED]` })
  if (f.hrv === 'reduced' && hard) caps.push({ max: 64, why: 'HRV Reduced + hard session' })
  if (f.tibia === true) caps.push({ max: 64, why: 'Tibia tender (MTSS history)' })
  const capped = score != null && caps.length ? Math.min(score, ...caps.map((c) => c.max)) : score
  return { score: capped, raw: score, capped: capped !== score, caps, tier: tierOf(capped), coverage: Math.round(haveW), weights: w, pillars }
}
