// Race-pace simulator: heat penalty (rough interpolation of Ely 2007, hypothesis) and run-walk average pace → finish time and COP margins.
// All times in seconds, paces in s/km. Not a prediction: a what-if calculator.
export const FM_M = 42195
// slowdown fraction for slower runners: ~4.5% between 5 and 25 °C WBGT (Ely 2007 range), linear, none below 8 °C, capped at 8%
export const heatPenalty = (wbgt) => (wbgt == null || wbgt <= 8 ? 0 : Math.min(0.08, (wbgt - 8) * 0.0025))
// run `runS` seconds at runPace, walk `walkS` seconds at walkPace, repeat. walkS = 0 → continuous running.
export function runWalkPace({ runPace, walkPace, runS, walkS = 0 }) {
  if (!(runPace > 0) || !(runS > 0)) return null
  if (!(walkS > 0)) return runPace
  if (!(walkPace > 0)) return null
  const km = runS / runPace + walkS / walkPace
  return (runS + walkS) / km
}
export function simulate({ runPace, walkPace = 0, runS, walkS = 0, wbgt = 0, gunMin = 240, cops = [], goalS = 14400 }) {
  const base = runWalkPace({ runPace, walkPace, runS, walkS }); if (base == null) return null
  const pace = base * (1 + heatPenalty(wbgt)), finish = pace * (FM_M / 1000)
  const points = cops.map(([name, km, closeHHMM]) => {
    const close = +closeHHMM.slice(0, 2) * 60 + +closeHHMM.slice(3, 5), at = gunMin + (pace * km) / 60
    return { name, km, closes: closeHHMM, arrivesMin: at, marginMin: Math.round(close - at) }
  })
  return { basePace: base, pace, finish, vsGoalS: Math.round(finish - goalS), points, allClear: points.every((p) => p.marginMin >= 0) }
}
export const fmtHMS = (s) => { const t = Math.round(s), h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), x = t % 60; return `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` }
