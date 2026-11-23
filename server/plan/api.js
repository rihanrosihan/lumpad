// HTTP handlers for the micro loop (P3). Reads are open like the other plan routes; every WRITE needs an authenticated user (principal), so none of them
// works while the proxy login is off (audit C1/C2). Nothing here changes the plan unless the athlete accepts, or PLAN_AUTOAPPLY=1 and the change is safety-direction.
import { planDb } from './db.js'
import { renderDays, wibDate } from './store.js'
import { dailyMenu } from './menu.js'
import { fromMissed } from './operators.js'
import { raise, openTriggers } from './triggers.js'
import { propose, accept, reject, revert, openProposals, expireProposals } from './proposals.js'
import { syncPlan } from './read.js'
import { listGoals, upsertGoal, seedGoals, getAvailability, setAvailability, proposeMacro } from './macroflow.js'

const err = (status, message) => Object.assign(new Error(message), { status })
export const needUser = (user) => { if (!user) throw err(401, 'authentication required for plan changes'); return user }
const DATE = /^\d{4}-\d{2}-\d{2}$/
const planMap = (db) => Object.fromEntries(renderDays(db).map((d) => [d.date, d]))
// gate and load context from the latest twin (same numbers the coach uses); missing twin -> no gate
function twinCtx(latestTwin) {
  const s = latestTwin?.()?.state
  return { gate: { tierId: s?.readiness?.tier ?? null, caps: s?.readiness?.caps?.length ?? 0, progPct: s?.load?.km_vs_4wk_avg_pct ?? null }, load: { tsb: s?.load?.tsb ?? null, acwr: s?.load?.acwr_uncoupled ?? null }, weekly4w: s?.load?.weekly_km_4w ?? null, tier: s?.readiness?.tier ?? null }
}
const after = (db) => { expireProposals(db); return syncPlan({ db }) }

export function handlers({ latestTwin }) {
  return {
    proposals: () => { const db = planDb(); expireProposals(db); return { proposals: openProposals(db), triggers: openTriggers(db) } },
    audit: (q) => { const db = planDb(), lim = Math.min(+q.get('limit') || 50, 200)
      return db.prepare(`SELECT a.id, a.created_at, a.loop, a.scope_from, a.scope_to, a.operators, a.rules, a.rationale_det, a.rationale_llm, a.auto, a.from_version, a.to_version,
        (SELECT event FROM plan_adjustment_event WHERE adjustment_id=a.id ORDER BY id DESC LIMIT 1) status, t.type trigger_type FROM plan_adjustment a LEFT JOIN plan_trigger t ON t.id=a.trigger_id
        WHERE a.created_at >= ? AND a.created_at <= ? ORDER BY a.id DESC LIMIT ?`).all(q.get('from') || '0000', (q.get('to') || '9999') + 'Z', lim).map((r) => ({ ...r, operators: JSON.parse(r.operators), rules: JSON.parse(r.rules) })) },
    menu: (q) => { const date = q.get('date'); if (!DATE.test(date || '')) throw err(400, 'date must be YYYY-MM-DD')
      const c = twinCtx(latestTwin); return dailyMenu(planMap(planDb()), date, { gate: c.gate, availMin: +q.get('avail') || undefined, wbgt: +q.get('wbgt') || undefined, aqiBad: q.get('aqi') === 'bad', redFlag: q.get('redflag') === '1' }) },
    accept: (body, user) => { needUser(user); const db = planDb(), r = accept(db, +body.adjustment_id, { by: 'athlete' }); return { ...r, sync: after(db), by: user } },
    reject: (body, user) => { needUser(user); return reject(planDb(), +body.adjustment_id, { by: 'athlete' }) },
    revert: (body, user) => { needUser(user); const db = planDb(), r = revert(db, +body.adjustment_id, { by: 'athlete' }); return { ...r, sync: after(db), by: user } },
    // the missed-run card's choice -> trigger -> kernel-checked proposal (never applied here)
    missed: (body, user) => {
      needUser(user); const date = body.date; if (!DATE.test(date || '')) throw err(400, 'date must be YYYY-MM-DD'); const db = planDb(), plan = planMap(db), c = twinCtx(latestTwin)
      const ctx = { hour: +body.hour || 15, reason: body.reason || 'time', pain: body.pain != null ? +body.pain : null, tier: c.tier, load: c.load, weekly4w: c.weekly4w, chose: body.chose || null }
      const r = fromMissed(plan, date, ctx, body.choice || null); if (!r.missed) return { ok: false, reason: 'nothing missed yet (before 11:00 WIB, rest day or race day)' }
      const day = plan[date], trig = raise(db, { type: 'missed_session', source: 'missed_check', key: `missed:${date}:${r.choice || 'rec'}`, payload: { date, kind: day.kind, choice: r.choice, reason: ctx.reason } })
      if (!r.patch) return { ok: true, proposal: null, choice: r.choice, refused: r.refused ?? null, trigger: trig.id, note: r.refused || 'No plan change needed for this choice.' }
      return { ...propose(db, { patches: [r.patch], trigger: trig.id, today: wibDate(), inputs: { missed: date, choice: r.choice } }), choice: r.choice, trigger: trig.id }
    },
    goals: () => ({ goals: listGoals(planDb()), archived: listGoals(planDb(), { status: 'archived' }) }),
    goal: (body, user) => { needUser(user); return upsertGoal(planDb(), body, { by: 'athlete' }) },
    seedGoals: (_b, user) => { needUser(user); return seedGoals(planDb()) },
    availability: () => getAvailability(planDb()),
    setAvailability: (body, user) => { needUser(user); return setAvailability(planDb(), body) },
    // Plan v2 / regeneration: builds a kernel-checked macro PROPOSAL from the actual 4-week volume; nothing changes until it is accepted
    macro: (body, user) => { needUser(user); const c = twinCtx(latestTwin), s = latestTwin?.()?.state
      return proposeMacro(planDb(), { ctx: { weekly4w: s?.load?.weekly_km_4w ?? 15, longest30: s?.load?.longest_run_km_30d ?? 0, guardBaseline: body.guard_baseline, cutbackRatio: body.cutback_ratio, peakCap: body.peak_cap_km }, force: body.force === true, by: 'engine' }) },
    feedback: (body, user) => { needUser(user); if (!DATE.test(body.date || '')) throw err(400, 'date must be YYYY-MM-DD')
      const rpe = body.rpe == null ? null : +body.rpe; if (rpe != null && !(rpe >= 1 && rpe <= 10)) throw err(400, 'rpe must be 1-10'); if (body.verdict && !['too_easy', 'right', 'too_hard'].includes(body.verdict)) throw err(400, 'verdict must be too_easy, right or too_hard')
      const db = planDb(), id = Number(db.prepare('INSERT INTO session_feedback (date, rpe, verdict, text, created_at) VALUES (?,?,?,?,?)').run(body.date, rpe, body.verdict ?? null, String(body.text ?? '').slice(0, 500) || null, new Date().toISOString()).lastInsertRowid)
      if (body.verdict === 'too_hard') raise(db, { type: 'coach_feedback', source: 'athlete', key: `fb:${id}`, payload: { date: body.date, verdict: 'too_hard', rpe } })
      return { ok: true, id } },
  }
}
