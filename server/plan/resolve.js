// Render-time zone resolution (P2): sessions store symbolic intensities (z 1..6); the active zone_set turns them into HR and pace.
// Heat adjustment stays a separate render layer (src/lib/prescription.js) and is not applied here.
import { estimate } from '../../src/lib/zones.js'

const one = (s, zs) => {
  const z = s.z || null
  return { t: s.t ?? null, z, m: s.m ?? null, sec: s.sec ?? null,
    hr: s.hr || (z ? zs.hr[z - 1] : null), pace: s.pace || (z ? zs.pace[z - 1] : null), note: s.note ?? null }
}
export const resolveSteps = (steps, zs) => (steps || []).map((s) => (s.rep ? { rep: s.rep, steps: s.steps.map((x) => one(x, zs)) } : one(s, zs)))
// a plan day with its resolved steps and COROS-style estimate at the zone set's own benchmarks
export function resolveDay(day, zs) {
  if (!day?.steps?.length) return { ...day, resolved: null }
  return { ...day, resolved: { zone_set: zs.version ?? null, steps: resolveSteps(day.steps, zs), est: estimate(day.steps, zs.cfg) } }
}
