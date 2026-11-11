// One place that turns synced data into every derived metric (Home and Readiness share it).
import { useMemo } from 'react'
import { useApi } from './api.js'
import { EMPTY_DAY, HARD } from './lib/gate.js'
import { BY_DATE, addDays } from './lib/calendar.js'
import { dailyLoadSeries, pmc, acwrRolling, monotonyStrain, distanceProgression, project, ctlRamp } from './lib/load.js'
import { hrvState, rhrState, quadrant, hrvSeries } from './lib/hrv.js'
import { sleepState } from './lib/sleep.js'
import { computeReadiness } from './lib/readiness.js'
import { muscleMap, intensityDistribution } from './lib/analysis.js'
import { paces } from './lib/vdot.js'
import { mean } from './lib/stats.js'

const RUN_TYPE = { quality: 'quality', tt: 'tt', long: 'long', race: 'race', speed: 'speed', easy: 'easy', social: 'easy' }
// planned daily load = plan km × your own TL/km for that kind of session (last 42 days)
export function plannedLoad(day, ratios) { if (!day?.km || ['rest', 'gym'].includes(day.kind)) return 0; return Math.round(day.km * (ratios[day.kind] ?? ratios.all ?? 0)) }
function tlRatios(acts) { const by = {}, all = [0, 0]; for (const a of acts) { if (a.sport_class !== 'run' || !a.training_load || !a.distance_m) continue; const k = BY_DATE[a.date]?.kind || 'easy'; (by[k] ||= [0, 0])[0] += a.training_load; by[k][1] += a.distance_m / 1000; all[0] += a.training_load; all[1] += a.distance_m / 1000 } const out = {}; for (const [k, [t, d]] of Object.entries(by)) out[k] = t / d; if (all[1]) out.all = all[0] / all[1]; return out }

// `f` (morning check-in) and `ov` (muscle overrides) come from the screen's own state so the score reacts as you type
export function useModel(T, settings, vdot, f = EMPTY_DAY, ov = {}) {
  const from = addDays(T, -120)
  const R = useApi(`/api/readiness?from=${from}&to=${T}`), A = useApi(`/api/activities/merged?from=${from}&to=${addDays(T, 1)}`), Lp = useApi(`/api/laps?from=${addDays(T, -28)}&to=${T}`)
  return useMemo(() => {
    const health = R.data?.health || [], acts = (A.data || []).filter((a) => a.date <= T), lapsById = Lp.data || {}, sess = BY_DATE[T]
    const series = dailyLoadSeries(R.data?.loads || [], from, T), P = pmc(series), cur = P.at(-1) || null
    const ratios = tlRatios(acts.filter((a) => a.date > addDays(T, -42)))
    const planned14 = Array.from({ length: 14 }, (_, i) => { const d = addDays(T, i + 1); return { date: d, load: plannedLoad(BY_DATE[d], ratios) } })
    const proj = cur && R.data?.loads?.length ? project(cur, planned14) : []
    const hrv = hrvState(health, T), rhr = rhrState(health, T), sleep = sleepState(health, T, settings.sleepNeedMin || 480)
    const mono = monotonyStrain(series), prog = distanceProgression(acts, T)
    // muscular decay events from what was actually done (runs by planned kind; strength by the plan's gym tags)
    const ev = []; for (const a of acts.filter((x) => x.date > addDays(T, -5))) {
      const t = a.start_ts ? a.start_ts * 1000 : new Date(a.date + 'T06:00:00+07:00').getTime(), day = BY_DATE[a.date]
      if (a.sport_class === 'run') ev.push({ type: a.distance_m >= 20000 ? 'long' : RUN_TYPE[day?.kind] || 'easy', t })
      if (a.sport_class === 'strength') for (const tag of day?.tags || []) { if (tag.startsWith('Lower')) ev.push({ type: 'lower', t }); if (tag === 'Unilateral') ev.push({ type: 'unilateral', t }); if (tag.startsWith('Plyo')) ev.push({ type: 'plyo', t }) }
    }
    const nowMs = new Date(T + 'T06:00:00+07:00').getTime(), muscle = muscleMap(ev, nowMs), eff = Object.fromEntries(Object.entries(muscle).map(([k, v]) => [k, ov[k] ?? v]))
    const muscleMax = acts.length || Object.keys(ov).length ? Math.max(...Object.values(eff)) : null
    const shr = health.find((h) => h.date === T)?.sleep_hr_avg ?? null
    const readiness = computeReadiness({ f, hrv, rhr, sleep, pmcPoint: cur, monotony: mono, progression: prog, muscleMax, phase: sess?.phase, hard: sess ? HARD.has(sess.kind) : false, sleepHR: shr })
    const p = paces(vdot.v), week = acts.filter((a) => a.date > addDays(T, -7))
    const lapsWeek = {}; for (const a of week) if (lapsById[a.id]) lapsWeek[a.id] = lapsById[a.id]
    const intensity = intensityDistribution(week, lapsWeek, p)
    const hrmax = Math.max(0, ...Object.values(lapsById).flat().map((l) => l.max_hr || 0), ...acts.map((a) => a.max_hr || 0)) || null
    return { ready: R.state === 'ok' && A.state === 'ok', state: R.state, health, acts, lapsById, series, pmc: P, cur, proj, ratios, planned14, hrv, rhr, sleep, mono, prog, muscle, muscleEff: eff, overrides: ov, readiness,
      quadrant: quadrant(health, T), hrvSeries: hrvSeries(health, T, 60), acwrRoll: acwrRolling(series), ramp: ctlRamp(P), intensity, hrmax, recov: [...health].reverse().find((h) => h.recovery_pct != null) || null,
      rhrSeries: health.filter((h) => h.date > addDays(T, -30) && h.resting_hr != null).map((h) => ({ date: h.date, rhr: h.resting_hr, base: mean(health.filter((x) => x.date < h.date && x.date >= addDays(h.date, -30)).map((x) => x.resting_hr)) })) }
  }, [R.data, R.state, A.data, A.state, Lp.data, f, ov, T, settings.sleepNeedMin, vdot.v])
}
