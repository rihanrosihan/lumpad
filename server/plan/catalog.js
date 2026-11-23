// Template catalog (P0): the 7 COROS plan-A courses + Lumpad builders as parametrised templates with symbolic zones.
// expand(id, dose) must reproduce src/lib/workouts.js exactly (tested). Paces/HR are never stored here: z stays symbolic.
import crypto from 'node:crypto'
import { fromCoros } from '../../src/lib/workouts.js'

const WU = { t: 'wu', sec: 300 }, CD = { t: 'cd', sec: 300 }
const near = (a, b) => Math.abs(a - b) < 0.01
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex')

export const TEMPLATES = [
  { id: 'coros.P10540', kind: 'easy', purpose: 'aerobic', name: 'Aerobic Endurance Run', phases: ['BASE', 'BUILD', 'PEAK', 'TAPER', 'RECOVERY'], dose: { km: [3, 20] }, steps: [WU, { t: 'run', m: '$km', z: 2 }, CD], src: 'coros:P10540', variants: { easier: 'coros.P10546' } },
  { id: 'coros.P10594', kind: 'long', purpose: 'durability', name: 'Long Run', phases: ['BASE', 'BUILD', 'PEAK'], dose: { km: [8, 32] }, steps: [WU, { t: 'run', m: '$km', z: 2 }, CD], src: 'coros:P10594', variants: { easier: 'coros.P10540' } },
  { id: 'coros.P10541', kind: 'quality', purpose: 'aerobic_power', name: 'Steady Run · Aerobic Power', phases: ['BASE', 'BUILD', 'PEAK'], dose: { km: [6, 20] }, steps: [WU, { t: 'run', m: 3000, z: 2 }, { t: 'run', m: '$km-3000', z: 3 }, CD], src: 'coros:P10541', variants: { easier: 'coros.P10540' } },
  { id: 'coros.P10545', kind: 'long', purpose: 'durability', name: 'Long Run · Aerobic Power finish', phases: ['BUILD', 'PEAK'], dose: { km: [10, 32] }, steps: [WU, { t: 'run', m: 3000, z: 2 }, { t: 'run', m: '$km-3000', z: 3 }, CD], src: 'coros:P10545', variants: { easier: 'coros.P10594' } },
  { id: 'coros.P10547', kind: 'quality', purpose: 'threshold', name: 'Threshold Intervals', phases: ['BUILD', 'PEAK'], dose: { km: [8, 20] }, steps: [WU, { rep: '$n', steps: [{ t: 'run', m: '$r', z: 2 }, { t: 'run', m: 3000, z: 4 }] }, CD], src: 'coros:P10547', variants: { easier: 'coros.P10541' } },
  { id: 'coros.P10544', kind: 'quality', purpose: 'aerobic_power', name: 'Aerobic Power Alternations', phases: ['BASE', 'BUILD'], dose: { km: [6.4, 20] }, steps: [WU, { rep: '$n', steps: [{ t: 'run', m: 1600, z: 2 }, { t: 'run', m: '$per', z: 3 }] }, CD], src: 'coros:P10544', variants: { easier: 'coros.P10541' } },
  { id: 'coros.P10546', kind: 'easy', purpose: 'aerobic', name: 'Free Run (by feel)', phases: ['BASE', 'BUILD', 'PEAK', 'RECOVERY'], dose: {}, steps: [{ t: 'free', z: 2, note: 'COROS free mode: run easy, end with the lap button' }], src: 'coros:P10546' },
  { id: 'lumpad.recovery', kind: 'easy', purpose: 'recovery', name: 'Recovery Run', phases: ['RECOVERY', 'RACE WEEK', 'TAPER', 'BASE'], dose: { km: [3, 8] }, steps: [{ t: 'run', m: '$km', z: 1 }], src: 'lumpad:workouts.recovery' },
]
export const byId = Object.fromEntries(TEMPLATES.map((t) => [t.id, t]))

// dose binding that mirrors fromCoros() for the derived templates (threshold reps, alternation reps)
export function bindDose(id, km) {
  if (id === 'coros.P10547') {
    const [r, per] = [[1600, 4.6], [800, 3.8], [500, 3.5], [3000, 6]].find(([, p]) => near(km / p, Math.round(km / p))) || [1600, 4.6]
    return { km, r, n: Math.max(1, Math.round(km / per)) }
  }
  if (id === 'coros.P10544') { const per = near(km / 3.2, Math.round(km / 3.2)) ? 1600 : 3000; return { km, per, n: Math.round(km / ((1600 + per) / 1000)) } }
  return { km }
}
const num = (v, d) => (typeof v === 'string' ? (v.startsWith('$') ? (v.includes('-') ? (d[v.slice(1).split('-')[0]] * 1000 - +v.split('-')[1]) : d[v.slice(1)] * (v === '$km' ? 1000 : 1)) : v) : v)
const sub = (s, d) => (s.rep != null ? { rep: num(s.rep, d), steps: s.steps.map((x) => sub(x, d)) } : s.m != null ? { ...s, m: Math.round(num(s.m, d)) } : { ...s })
export function expand(id, dose) {
  const t = byId[id]; if (!t) throw new Error('unknown template ' + id)
  const d = { ...bindDose(id, dose.km ?? 0), ...dose }
  return t.steps.map((s) => sub(s, d))
}
export const templateRows = () => TEMPLATES.map((t) => { const body = JSON.stringify(t); return { id: t.id, version: 1, kind: t.kind, purpose: t.purpose, body, src: t.src, hash: sha(body) } })
export function seedCatalog(db) {
  const ins = db.prepare('INSERT OR IGNORE INTO workout_template (id, version, kind, purpose, body, src, hash, created_at) VALUES (?,?,?,?,?,?,?,?)'); let n = 0
  for (const r of templateRows()) n += Number(ins.run(r.id, r.version, r.kind, r.purpose, r.body, r.src, r.hash, new Date().toISOString()).changes)
  return n
}
export { fromCoros }
