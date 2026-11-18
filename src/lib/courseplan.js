// Pacing plan for a course: even, negative split, or run–walk, as km splits that add up to the goal time. Pure → unit-tested.
export const FM = 42.195
export const parseHMS = (s) => { const p = String(s || '').trim().split(':').map(Number); if (p.some((x) => !Number.isFinite(x)) || p.length < 2 || p.length > 3) return null; return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + p[1] }
export const hms = (s) => { s = Math.round(s); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` }
export const mss = (s) => `${Math.floor(Math.round(s) / 60)}:${String(Math.round(s) % 60).padStart(2, '0')}`

// seconds per km for each of the 43 slots (42 full km + the last 0.195 km), summing to total
export function splits(total, strategy = 'even', { neg = 0.015 } = {}) {
  const avg = total / FM, slots = Array.from({ length: 43 }, (_, i) => (i < 42 ? 1 : FM - 42))
  if (strategy !== 'negative') return slots.map((d) => avg * d)
  const half = FM / 2, a = avg * (1 + neg), b = (total - a * half) / half // first half slower by `neg`, second half takes the rest
  let at = 0; return slots.map((d) => { const first = Math.max(0, Math.min(d, half - at)), sec = first * a + (d - first) * b; at += d; return sec })
}
export const clock = (sp) => { let t = 0; return sp.map((s) => (t += s)) }
// run–walk: runMin run / walkMin walk repeating, walk pace walkPace s/km; returns the pace to run at so the average equals avg
export function runWalk(avg, runMin = 4, walkMin = 1, walkPace = 630) {
  const cycle = (runMin + walkMin) * 60, dist = cycle / avg, walkDist = (walkMin * 60) / walkPace, runDist = dist - walkDist
  if (runDist <= 0 || (runMin * 60) / runDist < 180) return null // nobody runs faster than 3:00/km to make up the walking
  return { runPace: (runMin * 60) / runDist, walkPace, cycleKm: dist, runKm: runDist, walkKm: walkDist }
}
const DIR = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
export const compass = (deg) => DIR[Math.round((((deg % 360) + 360) % 360) / 45) % 8]
export const segmentAt = (segments, km) => segments.find((s) => km >= s.from && km < s.to) || segments.at(-1)
