// Daily workout menu (P3): 2-3 validated options for one planned day. A as planned, B the safe variant, C a time/length alternative.
// Every option is derived by an operator (which only lowers load) and carries the patch that applies it; A needs no patch.
import { gateActive } from '../../src/lib/scaler.js'
import { downgrade, trim, variant, hrCap, LOCKED } from './operators.js'
import { estimate } from '../../src/lib/zones.js'
import { REFERRAL } from '../intel/safety.js'

const HARD = new Set(['quality', 'tt', 'long'])
// ctx: { gate:{tierId,caps,progPct}, availMin, wbgt, aqiBad, redFlag }
export function dailyMenu(plan, date, ctx = {}) {
  const day = plan[date]
  if (!day || !(day.km > 0) || day.kind === 'rest') return { date, blocked: false, options: [], note: 'No run planned.' }
  if (ctx.redFlag) return { date, blocked: true, options: [], referral: REFERRAL, note: 'Red-flag symptom: no training options today.' }
  const gate = gateActive(ctx.gate || {}), hard = HARD.has(day.kind), locked = LOCKED(day), opts = []
  const A = { id: 'A', title: 'As planned', km: day.km, patch: null, warning: gate.active && hard && !locked ? `Readiness gate active (${gate.reasons.join('; ')}): the safe version is recommended.` : null }
  opts.push(A)
  if (!locked) {
    let B = null
    if (gate.active && hard) { B = downgrade(plan, date, ctx.gate); if (B) { B.changes = B.changes.filter((c) => c.date === date); if (!B.changes.length) B = null } } // only today's day belongs in today's menu
    if (!B && (ctx.wbgt >= 28)) B = variant(plan, date, 'heat')
    if (!B && ctx.aqiBad) B = variant(plan, date, 'aqi')
    if (!B && hard) B = hrCap(plan, [date]) || trim(plan, date, 0.75)
    if (!B && day.kind === 'easy') B = hrCap(plan, [date])
    if (B) opts.push({ id: 'B', title: 'Safer version', km: B.changes.find((c) => c.date === date)?.after.km ?? day.km, patch: B })
    const mins = ctx.availMin, est = day.steps?.length && !day.steps.some((s) => s.t === 'free') ? estimate(day.steps).sec / 60 : null
    const f = mins && est && est > mins ? Math.max(0.4, Math.floor((mins / est) * 20) / 20) : mins ? null : 0.7
    const C = f && f < 1 && day.km * f >= 3 ? trim(plan, date, f) : null
    if (C) opts.push({ id: 'C', title: mins ? `Fits ${mins} min` : 'Shorter', km: C.changes[0].after.km, patch: C })
  }
  const seen = new Set(), options = opts.filter((o) => { const k = JSON.stringify([o.km, o.patch?.operator]); if (seen.has(k)) return false; seen.add(k); return true })
  return { date, blocked: false, options, locked }
}
