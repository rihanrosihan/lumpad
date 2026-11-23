import test from 'node:test'
import assert from 'node:assert'
import fs from 'node:fs'
process.env.MEMORY_DB = ':memory:'; process.env.INTEL_DB = ':memory:'; process.env.DATA_DIR = fs.mkdtempSync('/tmp/lumpad-coach-test-'); process.env.LUMPAD_DB = ':memory:'
const { mdb } = await import('../intel/db.js')
const { openPlanDb } = await import('./db.js'), { importPlan, renderDays } = await import('./store.js'), { seedGoals } = await import('./macroflow.js')
const R = await import('./rank.js'), S = await import('./stats.js'), SG = await import('./signals.js'), L = await import('./planllm.js'), CF = await import('./coachflow.js'), M = await import('./macro.js')
const { validate } = await import('./kernel.js'), { addDays } = await import('../../src/lib/dates.js'), { accept } = await import('./proposals.js')
const PLAN = JSON.parse(fs.readFileSync(new URL('../../src/data/plan.json', import.meta.url), 'utf8')), T = '2026-11-23', CTX = { weekly4w: 15.9, longest30: 36.9, guardBaseline: 'build' }
const fresh = () => { const db = openPlanDb(':memory:'); importPlan(db, PLAN); seedGoals(db, T); mdb.exec('DELETE FROM coach_run'); return db }
const ON = { PLAN_COACH: '1' }
// a scripted model: gets the prompt, returns what the test wants
const model = (fn) => { const calls = []; const f = async (o) => { calls.push(o); const body = JSON.parse(o.user.slice('INPUT JSON:\n'.length)); const json = fn(body, o); return { text: JSON.stringify(json), json, usage: { prompt_tokens: 1500, completion_tokens: 200, total_tokens: 1700 }, model: 'deepseek-flash', effort: 'low', cost_cny: 0.01 } }; f.calls = calls; return f }
const pickAlt = (body) => ({ picks: body.slots.map((s) => ({ slot: s.slot, option: s.options.at(-1).id })), summary: 'A steady build.' })

// ---------- ranking and eligibility
test('eligibility: phase, injury, volume and availability gates; every option fits the slot without more load', () => {
  const days = M.generate({ today: T, plan: PLAN, goals: [{ race_date: '2027-06-13', name: 'J', cls: 'B', distance_m: 42195, status: 'active', id: 1, params: {} }], ctx: { ...CTX } }).days
  const q = days.find((d) => d.kind === 'quality' && d.phase === 'BUILD' && d.km >= 6) || days.find((d) => d.kind === 'quality')
  assert.ok(q, 'a quality day exists')
  for (const tpl of ['coros.P10541', 'coros.P10547', 'coros.P10544']) { const e = R.eligible(q, tpl, { weeklyKm: () => 30 }); if (e.ok) assert.ok(e.built.km <= q.km + 0.05) }
  assert.equal(R.eligible({ ...q, phase: 'BASE' }, 'coros.P10547', { weeklyKm: () => 40 }).ok, false)   // threshold not used in base
  assert.match(R.eligible({ ...q, phase: 'BUILD' }, 'coros.P10547', { weeklyKm: () => 40, injuredRecently: true }).why, /pain in the last 14 days/)
  assert.match(R.eligible({ ...q, phase: 'BUILD' }, 'coros.P10547', { weeklyKm: () => 20 }).why, /below 25 km/)
  assert.match(R.eligible({ ...q, phase: 'BUILD', km: 12 }, 'coros.P10541', { weeklyKm: () => 30, availMin: () => 20 }).why, /available/)
  assert.equal(R.eligible({ date: '2027-01-01', kind: 'long', km: 20, phase: 'PEAK', steps: [] }, 'coros.P10545', { weeklyKm: () => 30 }).ok, false)   // Z3-finish long run needs 40 km weeks
})
test('score: personal response matters only with enough data (n >= 3); measured memory can penalise, a hypothesis cannot', () => {
  const day = { date: '2027-02-02', kind: 'quality', km: 10, phase: 'BUILD', steps: [] }, b = M.rebuildSlot(day, 'coros.P10547', 10)
  const good = { 'coros.P10547': { n: 5, adherence: 95, pain48h_rate: 0, skip_rate: 0, last_done: '2027-01-12', last_km: 10 } }, bad = { 'coros.P10547': { n: 5, adherence: 40, pain48h_rate: 0.6, skip_rate: 0.4, last_done: '2027-01-30', last_km: 10 } }
  assert.ok(R.score(day, 'coros.P10547', b, { stats: good }).total > R.score(day, 'coros.P10547', b, { stats: bad }).total)
  assert.equal(R.score(day, 'coros.P10547', b, { stats: { 'coros.P10547': { n: 2, adherence: 0, pain48h_rate: 1, skip_rate: 1 } } }).parts.personal, 0.5)   // n < 3: neutral
  const rows = [{ id: 1, status: 'active', evidence_tag: 'MEASURED', payload: { plan_signal: { target: 'coros.P10547', delta: -0.2 } } }, { id: 2, status: 'active', evidence_tag: 'HYPOTHESIS', payload: { plan_signal: { target: 'coros.P10541', delta: -0.25 } } }, { id: 3, status: 'archived', evidence_tag: 'VALIDATED', payload: JSON.stringify({ plan_signal: { target: 'threshold', delta: -0.2 } }) }]
  const s = SG.planSignals(rows); assert.deepEqual(s.signals, { 'coros.P10547': -0.2 }); assert.deepEqual(s.used, [1]); assert.equal(s.ignored.length, 2)
  assert.ok(R.score(day, 'coros.P10547', b, { signals: s.signals }).total < R.score(day, 'coros.P10547', b, {}).total)
  assert.equal(R.score(day, 'coros.P10541', M.rebuildSlot(day, 'coros.P10541', 10), { signals: s.signals }).parts.penalty, 0)
  assert.equal(SG.memoryNotes([{ id: 9, status: 'active', evidence_tag: 'HYPOTHESIS', title: 'h' }, { id: 8, status: 'active', evidence_tag: 'VALIDATED', title: 'rule' }, { id: 7, status: 'retracted', evidence_tag: 'VALIDATED', title: 'x' }])[0].id, 8)
})
test('applyPicks: offered ids apply; unknown ids and picks that would make the week too hard keep the default; load never rises', () => {
  const g = M.generate({ today: T, plan: PLAN, goals: [{ race_date: '2027-06-13', name: 'J', cls: 'B', distance_m: 42195, status: 'active', id: 1, params: {} }], ctx: CTX }), slots = R.slotOptions(g.days, { from: g.report.start, weeks: 20, ctx: { weeklyKm: () => 45 }, today: T })
  assert.ok(slots.length > 0); const multi = slots.filter((s) => s.options.length > 1); assert.ok(multi.length > 0, 'some slots have a real choice')
  const s0 = multi[0], alt = s0.options.at(-1)
  const ok = R.applyPicks(g.days, slots, [{ slot: s0.date, option: alt.id }]); assert.equal(ok.days.find((d) => d.date === s0.date).template, alt.id); assert.ok(ok.applied.some((a) => a.how === 'coach' || a.date === s0.date))
  const bad = R.applyPicks(g.days, slots, [{ slot: s0.date, option: 'coros.NOPE' }, { slot: '1999-01-01', option: 'x' }, null, { slot: 5 }]); assert.ok(bad.fallback.some((f) => /not offered/.test(f.why))); assert.equal(bad.days.find((d) => d.date === s0.date).template, s0.options[0].id)
  const by = Object.fromEntries(g.days.map((d) => [d.date, d])); for (const d of ok.days) assert.ok(d.km <= by[d.date].km + 0.05, 'km raised on ' + d.date)
  assert.deepEqual(g.days.find((d) => d.date === s0.date), by[s0.date])   // the input plan is not mutated
})

// ---------- statistics
test('adherence matches adherence.go; template stats from sessions, runs, pain and skips', () => {
  assert.ok(S.adherenceScore({ plannedKm: 12, targetPaceSK: 360 }, { actualKm: 12, paceSK: 360, tizPct: 90 }) >= 95); assert.equal(S.adherenceScore({ plannedKm: 10 }, { actualKm: 0 }), 0)
  assert.equal(S.adherenceScore({ plannedKm: 0 }, { actualKm: 0 }), 100); assert.equal(S.adherenceScore({ plannedKm: 0 }, { actualKm: 5 }), 70)
  assert.equal(S.adherenceScore({ plannedKm: 10 }, { actualKm: 15, tizPct: 100 }), Math.round((0.45 * 0 + 35 + 20) * 10) / 10)   // +50 % distance scores 0 on distance
  const steps = [{ t: 'wu', sec: 300 }, { t: 'run', m: 8000, z: 2 }, { t: 'cd', sec: 300 }], z6 = [0, 100, 800, 100, 0, 0, 0]; assert.equal(S.tizOf(steps, z6), 80)
  const rows = S.computeTemplateStats({ today: '2027-01-20', sessions: [{ date: '2027-01-05', template_id: 'coros.P10540', km: 8, steps }, { date: '2027-01-07', template_id: 'coros.P10540', km: 8, steps }, { date: '2027-01-09', template_id: 'coros.P10540', km: 8, steps }, { date: '2027-01-30', template_id: 'coros.P10540', km: 8, steps }],
    runs: { '2027-01-05': [{ km: 8, paceSK: 400, z6 }], '2027-01-07': [{ km: 7.5, z6 }] }, pain: { '2027-01-06': 3, '2027-01-08': 0 } })
  const r = rows[0]; assert.equal(r.n, 2); assert.equal(r.skip_rate, 0.33); assert.equal(r.pain48h_rate, 0.5); assert.equal(r.last_done, '2027-01-07'); assert.equal(r.tiz, 80)   // the 30 Jan session is in the future: ignored
  const db = openPlanDb(':memory:'); assert.equal(S.saveTemplateStats(db, rows), 1); assert.equal(S.loadStats(db)['coros.P10540'].n, 2)
})

// ---------- the model boundary
test('reply validation: only offered ids, bounded text; nothing is guessed', () => {
  const slots = [{ date: '2027-01-12', options: [{ id: 'coros.P10541' }, { id: 'coros.P10547' }] }], long = Array(121).fill('word').join(' ')
  assert.deepEqual(L.validateReply({ picks: [{ slot: '2027-01-12', option: 'coros.P10547' }], summary: 'Fine.' }, slots), { picks: [{ slot: '2027-01-12', option: 'coros.P10547' }], summary: 'Fine.', errors: [] })
  const v = L.validateReply({ picks: [{ slot: '2027-01-12', option: 'coros.P99999' }, { slot: '2030-01-01', option: 'x' }, { slot: 3 }, null], summary: long }, slots); assert.equal(v.picks.length, 0); assert.equal(v.summary, null); assert.equal(v.errors.length, 5)
  assert.match(L.validateReply(null, slots).errors[0], /not a JSON/); assert.match(L.validateReply({ picks: 'x' }, slots).errors[0], /not a list/); assert.match(L.validateReply({ picks: [], summary: 7 }, slots).errors[0], /not text/)
})
test('grounding: numbers must come from the evidence', () => {
  assert.equal(L.groundText('Peak 26.4 km per week.', { plan: { peak_after: 26.4 } }).text, 'Peak 26.4 km per week.')
  const bad = L.groundText('Peak 41.7 km per week.', { plan: { peak_after: 26.4 } }); assert.equal(bad.text, null); assert.deepEqual(bad.unverified, ['41.7'])
  assert.equal(L.groundText('Small numbers like 3 weeks are fine.', {}).text, 'Small numbers like 3 weeks are fine.'); assert.equal(L.groundText('', {}).text, null)
})
test('coachSelect: off by default; one logged call; token cap; reuse by request hash; failures are engine-only and logged', async () => {
  const db = fresh(), g = M.generate({ today: T, plan: renderDays(db), goals: [{ race_date: '2027-06-13', name: 'J', cls: 'B', distance_m: 42195, status: 'active', id: 1, params: {} }], ctx: CTX }), slots = R.slotOptions(g.days, { from: g.report.start, weeks: 20, ctx: { weeklyKm: () => 45 }, today: T }).filter((s) => s.options.length > 1).slice(0, 4)
  const m = model(pickAlt), args = { slots, header: { weekly_km_now: 15.9 }, complete: m, mdb }
  const off = await L.coachSelect({ ...args, env: {} }); assert.equal(off.engineOnly, true); assert.match(off.reason, /PLAN_COACH is off/); assert.equal(m.calls.length, 0)
  const on = await L.coachSelect({ ...args, env: ON }); assert.equal(on.engineOnly, false); assert.equal(on.picks.length, slots.length); assert.equal(on.tokens, 1700); assert.equal(m.calls.length, 1)
  const row = mdb.prepare("SELECT intent, ok, req_hash FROM coach_run WHERE id=?").get(on.runId); assert.equal(row.intent, 'plan_macro'); assert.equal(row.ok, 1)
  const again = await L.coachSelect({ ...args, env: ON }); assert.equal(again.reused, true); assert.equal(again.tokens, 0); assert.equal(m.calls.length, 1)   // no second call for the same request
  assert.equal(L.planTokensThisMonth(mdb), 1700)
  const capped = await L.coachSelect({ ...args, env: { ...ON, PLAN_TOKEN_CAP: '1000' } }); assert.match(capped.reason, /token cap/); assert.equal(m.calls.length, 1)
  mdb.exec('DELETE FROM coach_run')
  const fail = await L.coachSelect({ ...args, complete: async () => { throw Object.assign(new Error('monthly cap ¥15 reached'), { status: 429 }) }, env: ON }); assert.equal(fail.engineOnly, true); assert.match(fail.reason, /monthly cap/); assert.equal(mdb.prepare("SELECT ok FROM coach_run").get().ok, 0)
  const junk = await L.coachSelect({ ...args, complete: async () => ({ text: 'sorry', json: null, usage: { total_tokens: 50 }, model: 'x' }), env: ON }); assert.equal(junk.picks.length, 0); assert.ok(junk.errors.length)
  assert.ok(L.buildPrompt({ slots, header: {}, twin: null, memories: [] }).tokens_est < 14000)
})

// ---------- end to end
test('AC-P5 season plan with the coach: picks applied, summary grounded, audit row links the run and tokens; the plan is untouched until accepted', async () => {
  const db = fresh(), before = renderDays(db), m = model(pickAlt)
  const r = await CF.proposeMacroCoach(db, { today: T, ctx: CTX }, { complete: m, mdb, env: ON })
  assert.equal(r.ok, true, JSON.stringify(r).slice(0, 300)); assert.equal(r.coach.engine_only, false); assert.deepEqual(renderDays(db), before)
  assert.ok(r.coach.slots > 0); assert.equal(m.calls.length, 1); const adj = db.prepare('SELECT * FROM plan_adjustment WHERE id=?').get(r.adjustment)
  assert.equal(adj.coach_run_id, mdb.prepare('SELECT id FROM coach_run ORDER BY id DESC LIMIT 1').get().id); assert.equal(adj.llm_tokens, 1700); assert.equal(adj.loop, 'macro')
  accept(db, r.adjustment, { today: T }); const after = renderDays(db)
  assert.equal(validate(after, { seed: true, weekly4w: 15.9, longest30: 36.9, raceExempt: true, guardBaseline: 'build' }).filter((v) => v.date >= r.summary.start).length, 0)
  for (const d of after) assert.ok(d.km <= (before.find((x) => x.date === d.date)?.km ?? 99) + 0.05 || d.date >= r.summary.start, 'frozen days unchanged')
})
test('a hallucinated number in the model summary is dropped; the engine rationale stays; a hallucinated option falls back per slot', async () => {
  const db = fresh(), lie = model((b) => ({ picks: [{ slot: b.slots[0].slot, option: 'coros.NOPE' }], summary: 'Peak 88.8 km per week, a big jump.' }))
  const r = await CF.proposeMacroCoach(db, { today: T, ctx: CTX }, { complete: lie, mdb, env: ON }); assert.equal(r.ok, true)
  assert.equal(db.prepare('SELECT rationale_llm FROM plan_adjustment WHERE id=?').get(r.adjustment).rationale_llm, null); assert.deepEqual(r.coach.summary_unverified, ['88.8'])
  assert.ok(r.coach.fallbacks.length + r.coach.reply_errors.length >= 1); assert.match(db.prepare('SELECT rationale_det FROM plan_adjustment WHERE id=?').get(r.adjustment).rationale_det, /Season regenerated/)
})
test('engine-only (no model, model down, or coach off) still yields the same kernel-clean proposal shape', async () => {
  for (const [label, deps] of [['off', { complete: model(pickAlt), mdb, env: {} }], ['down', { complete: async () => { throw new Error('provider down') }, mdb, env: ON }]]) {
    const db = fresh(), r = await CF.proposeMacroCoach(db, { today: T, ctx: CTX }, deps); assert.equal(r.ok, true, label); assert.equal(r.coach.engine_only, true, label); assert.ok(r.summary.peak_after < r.summary.peak_before)
    assert.equal(db.prepare('SELECT coach_run_id, rationale_llm FROM plan_adjustment WHERE id=?').get(r.adjustment).rationale_llm, null)
  }
})
test('AC-P5-1 offline eval: 120 scripted model behaviours (valid, wrong ids, greedy, junk, truncated, hostile) never produce a kernel violation or more load', async () => {
  const db0 = fresh(), base = (await CF.proposeMacroCoach(db0, { today: T, ctx: CTX }, { complete: model(() => ({ picks: [], summary: 'ok' })), mdb, env: ON }))
  let valid = 0, fell = 0, total = 0
  const behaviours = [(b) => pickAlt(b), (b) => ({ picks: b.slots.map((s) => ({ slot: s.slot, option: s.options[0].id })), summary: 'Keeping the default.' }), (b) => ({ picks: b.slots.map((s) => ({ slot: s.slot, option: 'coros.' + s.options[0].id })), summary: 'x' }), () => ({ picks: 'all', summary: null }), () => null, (b) => ({ picks: b.slots.map((s) => ({ slot: s.slot, option: s.options.at(-1).id, km: 999 })), summary: 'Peak 100 km.' }), (b) => ({ picks: [...b.slots, ...b.slots].map((s, i) => ({ slot: s.slot, option: s.options[i % s.options.length].id })), summary: '' })]
  for (let i = 0; i < 120; i++) {
    const db = fresh(), f = model(behaviours[i % behaviours.length]), r = await CF.proposeMacroCoach(db, { today: addDays(T, i % 3), ctx: { ...CTX, cutbackRatio: i % 2 ? 0.9 : 0.85 } }, { complete: f, mdb, env: ON }); assert.equal(r.ok, true, `case ${i}: ${JSON.stringify(r).slice(0, 200)}`)
    accept(db, r.adjustment, { today: addDays(T, i % 3) }); const after = renderDays(db)
    assert.equal(validate(after, { seed: true, weekly4w: 15.9, longest30: 36.9, raceExempt: true, guardBaseline: 'build' }).filter((v) => v.date >= r.summary.start).length, 0, `case ${i} violated the kernel`)
    total++; if (r.coach.applied > 0) valid++; if (r.coach.fallbacks.length || r.coach.reply_errors.length) fell++
  }
  assert.ok(base.ok); assert.equal(total, 120); assert.ok(valid > 0 && fell > 0)
})
test('"why?": grounded explanation kept, hallucinated numbers fall back, coach off falls back, over-long answer falls back', async () => {
  const adj = { scope_from: '2026-12-01', scope_to: '2026-12-01', operators: ['drop'], rules: [{ id: 'R-NO-MAKEUP' }], rationale_det: 'Dropped the 8 km run on 12-01.', diff: [{ date: '2026-12-01', before: { km: 8 }, after: { km: 0 } }] }
  const good = await L.explainAdjustment({ adjustment: adj, complete: model(() => ({ text: 'The 8 km run was dropped and nothing is added elsewhere.' })), mdb, env: ON }); assert.equal(good.source, 'coach')
  const lie = await L.explainAdjustment({ adjustment: { ...adj, rationale_det: 'Dropped.' }, complete: model(() => ({ text: 'The 42 km run was dropped.' })), mdb, env: ON }); assert.equal(lie.source, 'engine'); assert.match(lie.reason, /numbers not found/)
  assert.equal((await L.explainAdjustment({ adjustment: adj, complete: model(() => ({ text: 'x' })), mdb, env: {} })).source, 'engine')
  assert.match((await L.explainAdjustment({ adjustment: { ...adj, rationale_det: 'Dropped for the long case.' }, complete: model(() => ({ text: Array(90).fill('w').join(' ') })), mdb, env: ON })).reason, /too long/)
  const calls = model(() => ({ text: 'The 8 km run was dropped and nothing is added elsewhere.' })); const again = await L.explainAdjustment({ adjustment: adj, complete: calls, mdb, env: ON }); assert.equal(again.source, 'coach'); assert.equal(calls.calls.length, 0)   // same request: reused, no new call
})
