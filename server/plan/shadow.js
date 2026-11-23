// Shadow mode (P3 gate AC-P3-6): after each COROS job, work out what the engine WOULD propose today and log it as an (unapplied) proposal. Never accepts anything, never
// writes outside plan.db. Proposals expire at the end of the day, like real ones; shadowReport() lines each up with what the athlete actually did, for the 14-day review.
import { renderDays, wibDate } from './store.js'
import { raise, markHandled, kernelNightly } from './triggers.js'
import { downgrade } from './operators.js'
import { propose, expireProposals } from './proposals.js'
import { addDays } from '../../src/lib/dates.js'

export function runShadow(db, { today = wibDate(), twinState = null, now = new Date() } = {}) {
  const days = renderDays(db), plan = Object.fromEntries(days.map((d) => [d.date, d])), out = { today, kernel: null, gate: null }
  expireProposals(db, today)
  const s = twinState, kctx = { seed: true, weekly4w: s?.load?.weekly_km_4w, longest30: s?.load?.longest_run_km_30d }
  out.kernel = kernelNightly(db, { today, days, ctx: kctx, now })
  const gate = { tierId: s?.readiness?.tier ?? null, caps: s?.readiness?.caps?.length ?? 0, progPct: s?.load?.km_vs_4wk_avg_pct ?? null }
  const patch = downgrade(plan, today, gate)
  if (patch) {
    const t = raise(db, { type: 'readiness_gate', source: 'shadow', key: `gate:${today}`, payload: { tier: gate.tierId, caps: gate.caps, progPct: gate.progPct }, now })
    if (t.created) { const r = propose(db, { patches: [patch], trigger: t.id, today, inputs: { shadow: true, gate }, autoApply: false }); out.gate = r.ok ? { proposed: r.adjustment, days: patch.changes.map((c) => c.date) } : (markHandled(db, t.id, 'ignored', r.reason || 'refused'), { refused: r.reason }) }
    else out.gate = { duplicate: true }
  }
  return out
}
// every shadow proposal with what actually happened that day (planned vs run), plus counts. runsByDate: {date: [{km, avgHR}]}
export function shadowReport(db, runsByDate = {}) {
  const rows = db.prepare("SELECT a.id, a.created_at, a.operators, a.diff, a.rationale_det, (SELECT event FROM plan_adjustment_event WHERE adjustment_id=a.id ORDER BY id DESC LIMIT 1) last FROM plan_adjustment a WHERE a.inputs LIKE '%\"shadow\":true%' ORDER BY a.id").all()
  const list = rows.map((r) => { const diff = JSON.parse(r.diff); return { id: r.id, at: r.created_at, ops: JSON.parse(r.operators), status: r.last, rationale: r.rationale_det, days: diff.map((d) => ({ date: d.date, planned: d.before, proposed: d.after, ran: (runsByDate[d.date] || []).map((x) => ({ km: Math.round(x.km * 10) / 10, avgHR: x.avgHR ?? null })) })) } })
  const refused = db.prepare("SELECT COUNT(*) n FROM plan_trigger WHERE source='shadow' AND status='ignored'").get().n, kernel = db.prepare("SELECT COUNT(*) n FROM plan_trigger WHERE source='kernel'").get().n
  return { proposals: list.length, expired: list.filter((x) => x.status === 'expired').length, applied: list.filter((x) => ['applied', 'evaluated'].includes(x.status)).length, refused, kernel_drift_days: kernel, first: list[0]?.at ?? null, list }
}
