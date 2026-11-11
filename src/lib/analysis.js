// Activity & profile analytics (docs/readiness-model.md §5–6). Pure functions.
import { addDays, diffDays } from './dates.js'
import { mean, r1 } from './stats.js'

export const efOf = (a) => { const pace = a.adjusted_pace_s_km || a.avg_pace_s_km; return pace && a.avg_hr ? r1((60000 / pace) / a.avg_hr, 3) : null } // m/min per bpm
// aerobic decoupling from laps: EF first half vs second half (by distance)
export function decoupling(laps) {
  const L = laps.filter((l) => l.distance_m > 0 && l.duration_s > 0 && l.avg_hr); if (L.length < 4) return null
  const total = L.reduce((a, l) => a + l.distance_m, 0); let acc = 0; const h1 = [], h2 = []
  for (const l of L) { (acc + l.distance_m / 2 <= total / 2 ? h1 : h2).push(l); acc += l.distance_m }
  const ef = (ls) => { const d = ls.reduce((a, l) => a + l.distance_m, 0), t = ls.reduce((a, l) => a + l.duration_s, 0), hr = ls.reduce((a, l) => a + l.avg_hr * l.duration_s, 0) / t; return ((d / t) * 60) / hr }
  if (!h1.length || !h2.length) return null
  const e1 = ef(h1), e2 = ef(h2), pct = r1(((e1 - e2) / e1) * 100)
  return { pct, band: pct < 5 ? 'green' : pct <= 7.5 ? 'yellow' : 'red' }
}
// pace zones per lap (VDOT paces, s/km): E, M, T, I, R. 3-zone: Z1 slower than M, Z2 M..T, Z3 faster than T
export function paceZone(pace, p) { if (!pace) return null; if (pace > p.M + 1) return 'E'; if (pace > p.T + 1) return 'M'; if (pace > p.I + 1) return 'T'; if (pace > p.R + 1) return 'I'; return 'R' }
export const three = (z) => (z === 'E' ? 1 : z === 'M' ? 2 : z ? 3 : null)
export function zoneTime(laps, p) { const t = { E: 0, M: 0, T: 0, I: 0, R: 0 }; for (const l of laps) { const z = paceZone(l.avg_pace_s_km, p); if (z) t[z] += l.duration_s || 0 } return t }
export function hrZoneTime(laps, hrmax) { const t = [0, 0, 0, 0, 0]; if (!hrmax) return null; for (const l of laps) { if (!l.avg_hr) continue; const f = l.avg_hr / hrmax, z = f < 0.6 ? 0 : f < 0.7 ? 1 : f < 0.8 ? 2 : f < 0.9 ? 3 : 4; t[z] += l.duration_s || 0 } return t }
// intensity distribution over a window, time-weighted by laps; runs without laps classified by avg pace
export function intensityDistribution(acts, lapsById, p) {
  const t = [0, 0, 0]
  for (const a of acts.filter((x) => x.sport_class === 'run')) {
    const laps = lapsById?.[a.id]
    if (laps?.length) for (const l of laps) { const z = three(paceZone(l.avg_pace_s_km, p)); if (z) t[z - 1] += l.duration_s || 0 }
    else { const z = three(paceZone(a.avg_pace_s_km, p)); if (z) t[z - 1] += a.duration_s || 0 }
  }
  const tot = t[0] + t[1] + t[2]; return tot ? { low: Math.round((t[0] / tot) * 100), mid: Math.round((t[1] / tot) * 100), high: Math.round((t[2] / tot) * 100), seconds: tot } : null
}
// compliance: planned km vs actual km for a date
export function compliance(planKm, actualKm, isPast) {
  if (!planKm) return actualKm ? 'extra' : null
  if (!isPast) return actualKm ? 'done' : 'future'
  if (!actualKm) return 'missed'
  const dev = Math.abs(actualKm - planKm) / planKm; return dev <= 0.1 ? 'ok' : dev <= 0.3 ? 'modified' : 'off'
}
// muscular load decay map (heuristic; manual override possible). regions: quads, hams, glutes, calves, achilles, shins, back
export const REGIONS = [['quads', 'Paha depan / VMO'], ['hams', 'Hamstring'], ['glutes', 'Glutes'], ['calves', 'Betis / soleus'], ['achilles', 'Achilles / ankle'], ['shins', 'Tulang kering / tibialis'], ['back', 'Punggung bawah / core']]
const STIM = { // stimulus per session type: [regions, peak 0–3, half-life hours]
  lower: [['quads', 'glutes', 'hams', 'calves'], 2.5, 30], unilateral: [['quads', 'glutes', 'hams'], 2, 30], plyo: [['calves', 'achilles', 'shins'], 2, 30],
  quality: [['calves', 'achilles', 'hams'], 1.8, 24], tt: [['calves', 'achilles', 'hams', 'quads'], 2.2, 24], long: [['quads', 'calves', 'shins'], 2, 30], race: [['quads', 'calves', 'shins', 'hams'], 3, 36], speed: [['calves', 'achilles'], 1.2, 20], easy: [['calves'], 0.5, 12],
}
export function muscleMap(events, nowMs) {
  const m = Object.fromEntries(REGIONS.map(([k]) => [k, 0]))
  for (const e of events) { const s = STIM[e.type]; if (!s) continue; const h = (nowMs - e.t) / 3.6e6; if (h < 0 || h > 96) continue; const v = s[1] * Math.pow(0.5, h / s[2]) * (e.scale || 1); for (const r of s[0]) m[r] = Math.min(3, m[r] + v) }
  return m
}
// Tanda & Knechtle 2013 marathon prediction (min); K = mean weekly km (8 wk), P = mean training pace s/km; BF optional
export function tandaMarathon(K, P, bf) { if (!K || !P) return null; return 11.03 + 98.46 * Math.exp(-0.0053 * K) + 0.387 * P + (bf != null && bf !== '' ? 0.1 * Math.exp(0.23 * bf) : 0) }
export function trainingIndices(acts, date, weeks = 8) {
  const from = addDays(date, -7 * weeks), runs = acts.filter((a) => a.sport_class === 'run' && a.date > from && a.date <= date && a.distance_m && a.duration_s)
  const km = runs.reduce((s, a) => s + a.distance_m / 1000, 0), t = runs.reduce((s, a) => s + a.duration_s, 0)
  return { K: r1(km / weeks), P: km ? Math.round(t / km) : null, runs: runs.length }
}
// PRs from data we actually have: best 1 km lap; whole activities within 2 % of standard distances
export const PR_DIST = [['1K', 1000], ['5K', 5000], ['10K', 10000], ['Half', 21097.5], ['Marathon', 42195]]
export function prs(acts, lapsBest1k) {
  const out = {}
  for (const [k, d] of PR_DIST.slice(1)) { const c = acts.filter((a) => a.sport_class === 'run' && a.distance_m && Math.abs(a.distance_m - d) / d <= 0.02 && a.duration_s); if (c.length) { const b = c.reduce((x, y) => (y.duration_s / y.distance_m < x.duration_s / x.distance_m ? y : x)); out[k] = { time: Math.round((b.duration_s * d) / b.distance_m), date: b.date, name: b.name, gear_id: b.gear_id } } }
  if (lapsBest1k) out['1K'] = lapsBest1k
  return out
}
// session structure for the step chart, parsed from the plan label; WU 2 km / CD 1 km as in the plan's TT notes [calc]
export function sessionSteps(day) {
  if (!day || !day.km) return []
  const l = (day.label || '').toLowerCase(), km = day.km, steps = []
  const wu = 2, cd = 1, main = Math.max(0, km - wu - cd)
  let m
  if (day.kind === 'tt') return [['WU', wu, 1], [day.label, Math.max(0, km - 3), 4], ['CD', cd, 1]]
  if ((m = /(\d+)\s*[×x]\s*(\d+)\s*km/.exec(l))) { const n = +m[1], d = +m[2]; steps.push(['WU', wu, 1]); for (let i = 0; i < n; i++) { steps.push([`${d} km`, d, 3]); if (i < n - 1) steps.push(['jog', 0.4, 1]) } steps.push(['CD', cd, 1]); return steps }
  if ((m = /(\d{3,4})\s*m repeats/.exec(l))) { const d = +m[1] / 1000, n = Math.max(1, Math.round((main * 0.5) / d)); steps.push(['WU', wu, 1]); for (let i = 0; i < n; i++) { steps.push([`${m[1]} m`, d, 4]); steps.push(['jog', d / 2, 1]) } steps.push(['CD', cd, 1]); return steps }
  if (/tempo|steady|progressive|mile|over|broken|on off|descending|into/.test(l)) return [['WU', wu, 1], [day.label, main, 3], ['CD', cd, 1]]
  if (/hills|strides/.test(l)) return [['Easy', km - 0.6, 1], ['Hills/strides', 0.6, 4]]
  if (day.kind === 'long') { const mp = (day.tags || []).find((t) => /^MP \d+/.test(t)); if (mp) { const x = +mp.split(' ')[1]; return [['Easy', km - x - 5 > 0 ? km - x - 5 : km - x, 1], ['MP', x, 2], ['Easy', Math.min(5, km - x), 1]] } }
  return [[day.label || 'Easy', km, day.kind === 'race' ? 3 : 1]]
}
// monthly cumulative km per day-of-month
export function cumulativeKm(acts, ym) { const days = new Date(+ym.slice(0, 4), +ym.slice(5, 7), 0).getDate(), per = Array(days).fill(0); for (const a of acts) if (a.sport_class === 'run' && a.date.startsWith(ym)) per[+a.date.slice(8) - 1] += (a.distance_m || 0) / 1000; let c = 0; return per.map((v, i) => ({ day: i + 1, km: r1((c += v)) })) }
export const SHOE_LIFE = { easy: 700, daily: 700, plated: 500, short: 400, '': 650 } // [convention] — no validated lifespan exists
export function shoeStats(acts, gearId, date) {
  const runs = acts.filter((a) => a.gear_id === gearId && a.sport_class === 'run' && a.distance_m)
  const km = (d) => runs.filter((a) => a.date > addDays(date, -d) && a.date <= date).reduce((s, a) => s + a.distance_m / 1000, 0)
  const tkm = runs.reduce((s, a) => s + a.distance_m / 1000, 0), t = runs.reduce((s, a) => s + (a.duration_s || 0), 0)
  return { km30: r1(km(30)), km90: r1(km(90)), avgPace: tkm ? Math.round(t / tkm) : null, runs: runs.length }
}
export const weeksBetween = (a, b) => Math.floor(diffDays(b, a) / 7)
