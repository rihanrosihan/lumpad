// Daniels–Gilbert equations. [ALGORITHMIC, calculated]
const vo2 = (v) => -4.6 + 0.182258 * v + 0.000104 * v * v // v in m/min
const pctMax = (t) => 0.8 + 0.1894393 * Math.exp(-0.012778 * t) + 0.2989558 * Math.exp(-0.1932605 * t) // t in min

export function vdotFromRace(meters, seconds) {
  const t = seconds / 60
  return vo2(meters / t) / pctMax(t)
}
function velAtVO2(x) { // m/min
  const a = 0.000104, b = 0.182258, c = -4.6 - x
  return (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a)
}
export function raceTime(vdot, meters) { // seconds, bisection
  let lo = 60, hi = 3600 * 8
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2
    vdotFromRace(meters, mid) > vdot ? (lo = mid) : (hi = mid)
  }
  return (lo + hi) / 2
}
export const paceSecPerKm = (vdot, frac) => 60000 / velAtVO2(vdot * frac)
export function paces(vdot) {
  const T = paceSecPerKm(vdot, 0.888)
  return {
    E: [paceSecPerKm(vdot, 0.59), paceSecPerKm(vdot, 0.74)], // slow..fast
    T, subT: T + 12, I: paceSecPerKm(vdot, 1.0), R: raceTime(vdot, 1609.34) / 1.60934, // R ≈ current mile race pace (Daniels)
    M: raceTime(vdot, 42195) / 42.195,
    fiveK: raceTime(vdot, 5000), tenK: raceTime(vdot, 10000),
    half: raceTime(vdot, 21097.5), full: raceTime(vdot, 42195),
  }
}
export const fmtPace = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`
export function fmtTime(s) {
  s = Math.round(s); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60
  return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0')
}
export const parseTime = (str) => str.trim().split(':').map(Number).reduce((a, n) => a * 60 + n, 0)
