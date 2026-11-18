// Jakim 2026 → 2027: what the 2026 race says about the 2027 goal. Pure → unit-tested.
import { splits, clock, FM } from './courseplan.js'
import { vdotFromRace } from './vdot.js'

export const OFFICIAL_2026 = 6 * 3600 + 53 * 60 + 3 // 6:53:03, from your own records
export const GOAL_OFFICIAL = 5 * 3600 - 1             // sub-5:00 on the official time
export const WATCH_PLAN = [4 * 3600 + 50 * 60, 4 * 3600 + 52 * 60] // plan to a watch time of 4:50–4:52 so the official time is safely under 5:00
export const PLAN_MID = 4 * 3600 + 51 * 60
export const CLASSES = [['run', 'Running kilometres (≤ 8:30/km in 2026)', 510], ['rw', 'Run–walk kilometres (8:30–12:00)', 720], ['walk', 'Walking and stops (> 12:00)', Infinity]]

export function benchmark(L, planSec = PLAN_MID) {
  const sp = splits(planSec, 'even'), cl = clock(sp), planAt = (k) => { const i = Math.floor(k), base = i ? cl[i - 1] : 0; return base + (k - i) * (sp[i] || 0) / (i < 42 ? 1 : FM - 42) }
  const edges = [0, 5, 10, 15, 20, 25, 30, 35, 40, FM]
  const five = edges.slice(1).map((b, j) => { const a = edges[j], t26 = L.clockAt(b) - L.clockAt(a), t27 = planAt(b) - planAt(a); return { a, b, t26, t27, saved: t26 - t27 } })
  // where the saving comes from: every 2026 lap against the plan pace over the same official distance
  const pace27 = planSec / FM, cls = CLASSES.map(([id, label]) => ({ id, label, km: 0, saved: 0 }))
  L.per.forEach((p) => { const d = p.partial ? 0.2657 * L.f : L.f, c = cls[p.pace <= 510 ? 0 : p.pace <= 720 ? 1 : 2]; c.km += d; c.saved += (p.pace - pace27) * d })
  const marks = [5, 10, 21.0975, 30, 35, 40, FM].map((k) => ({ k, t26: L.clockAt(k), t27: planAt(k), diff: L.clockAt(k) - planAt(k) }))
  return { planSec, pace27, pace26: OFFICIAL_2026 / FM, cut: OFFICIAL_2026 - planSec, cutGoal: OFFICIAL_2026 - GOAL_OFFICIAL, five, cls, marks, buffer: GOAL_OFFICIAL - planSec,
    vdot27: vdotFromRace(FM * 1000, planSec), vdot26: vdotFromRace(FM * 1000, OFFICIAL_2026), vdotGoal: vdotFromRace(FM * 1000, GOAL_OFFICIAL) }
}
