import test from 'node:test'
import assert from 'node:assert'
import fs from 'node:fs'
import { openPlanDb } from './db.js'
import { importPlan, renderDays, activeVersion } from './store.js'
import { generate, checkCandidate, dayAvail, inFreeze } from './macro.js'
import { validate, downWeeks } from './kernel.js'
import { seedGoals, listGoals, upsertGoal, validateGoal, setAvailability, getAvailability, validateAvailability, proposeMacro, handleMacroTriggers, macroHold } from './macroflow.js'
import { accept, revert, openProposals } from './proposals.js'
import { raise } from './triggers.js'
import { addDays, mondayOf, diffDays, dowOf } from '../../src/lib/dates.js'
import { RACES } from '../../src/lib/season.js'
import { estimate } from '../../src/lib/zones.js'

const PLAN = JSON.parse(fs.readFileSync(new URL('../../src/data/plan.json', import.meta.url), 'utf8'))
const GOALS = [{ race_date: '2027-06-13', name: 'Jakim FM', cls: 'B', distance_m: 42195 }, { race_date: '2027-06-20', name: 'MJM FM', cls: 'D', distance_m: 42195 }, { race_date: '2027-10-24', name: 'JRF Full', cls: 'A', distance_m: 42195 }, { race_date: '2027-11-14', name: 'Bormar FM', cls: 'C', distance_m: 42195 }].map((g, i) => ({ id: i + 1, status: 'active', params: {}, ...g }))
const T = '2026-11-23', CTX = { weekly4w: 15.9, longest30: 36.9 }
const rng = (s) => () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32)
const fresh = () => { const db = openPlanDb(':memory:'); importPlan(db, PLAN); seedGoals(db, T); return db }

function checkInvariants(g, args, label) {
  const { today, goals, availability, ctx } = args, start = g.report.start, c = checkCandidate(g.days, ctx, start)
  assert.equal(c.violations.length, 0, `${label}: kernel violations ${JSON.stringify(c.violations.slice(0, 2))}`)
  const pre = validate(g.days, { seed: true, weekly4w: ctx.weekly4w, longest30: ctx.longest30, raceExempt: true, guardBaseline: ctx.guardBaseline }).filter((v) => v.date >= start)   // the full plan counts (30-day windows reach back before the horizon); only the horizon is ours to fix
  assert.equal(pre.length, 0, `${label}: generator output needed repair ${JSON.stringify(pre.slice(0, 2))} ${pre[0] ? JSON.stringify(g.days.filter((d) => d.date >= pre[0].date && d.date <= addDays(pre[0].date, 1)).map((d) => [d.date, d.kind, d.km, d.label, d.phase])) : ''}`)   // clean without repair
  // frozen horizon and past: identical
  const by = Object.fromEntries(PLAN.map((d) => [d.date, d]))
  for (const d of g.days) if (d.date < start) assert.deepEqual(d, by[d.date], `${label}: frozen day ${d.date} changed`)
  assert.equal(g.days.length, PLAN.length); assert.deepEqual(g.days.map((d) => d.date), PLAN.map((d) => d.date))
  // availability: nothing on a closed day, session length inside the window
  for (const d of g.days) { if (d.date < start || !(d.km > 0) || ['race', 'tt'].includes(d.kind)) continue; const a = dayAvail(d.date, availability); assert.ok(a.open, `${label}: run on closed day ${d.date}`); if (d.steps?.length && !d.steps.some((s) => s.t === 'free')) assert.ok(estimate(d.steps).sec / 60 <= a.maxMin + 0.01, `${label}: ${d.date} too long for ${a.maxMin} min (${d.kind} ${d.km} km ${d.template || d.label} ${Math.round(estimate(d.steps).sec / 60)} min)`) }
  // intensity: quality km (zone 3+) at most 20 % of a week's km (time-trial weeks excluded)
  const weeks = new Map(); for (const d of g.days) if (d.date >= start) { const m = mondayOf(d.date); (weeks.get(m) || weeks.set(m, []).get(m)).push(d) }
  const down = downWeeks(g.days.filter((d) => d.date >= start)); let run = 0, maxRun = 0
  for (const [m, ds] of weeks) {
    const isDown = down.has(m); run = isDown ? 0 : run + 1; maxRun = Math.max(maxRun, run)   // counted for every week, including time-trial weeks
    const tot = ds.filter((d) => d.kind !== 'race').reduce((s, d) => s + (d.km || 0), 0); if (!tot || ds.some((d) => d.kind === 'tt')) continue
    const hi = ds.filter((d) => d.kind !== 'race').flatMap((d) => (d.steps || []).flatMap((s) => (s.rep ? Array.from({ length: s.rep }, () => s.steps).flat() : [s]))).filter((s) => (s.z || 0) >= 3 && s.m).reduce((a, s) => a + s.m / 1000, 0)
    assert.ok(hi <= tot * 0.2 + 0.3, `${label}: ${m} intensity share ${(hi / tot).toFixed(2)}`)
  }
  assert.ok(maxRun <= 3, `${label}: ${maxRun} build weeks in a row without a cutback`)   // at most 3 build weeks, then a flagged cutback week
  // taper: weeks inside 21 days of an A/B race are at most 60 % of the block peak
  for (const gl of goals.filter((x) => ['A', 'B'].includes(x.cls) && x.race_date >= start)) {
    const wk = [...weeks].map(([m, ds]) => [m, ds.filter((d) => d.kind !== 'race').reduce((s, d) => s + (d.km || 0), 0)]).sort(), inHorizon = wk.filter(([m]) => m < addDays(gl.race_date, -21)).filter(([m]) => !down.has(m)).map(([, k]) => k), peak = inHorizon.length ? Math.max(...inHorizon) : ctx.weekly4w   // no build week inside the horizon: the block peak is the athlete's actual volume
    for (const [m, k] of wk) { const dd = diffDays(gl.race_date, m); if (dd > 0 && dd <= 21 && m > addDays(gl.race_date, -22) && !down.has(m) === false) assert.ok(k <= Math.max(peak * 0.6 + 0.2, 7) || peak === 0,   // a week below ~7 km (two 3 km runs + a shakeout) is the minimum viable week, so tiny peaks cannot taper further
         `${label}: taper week ${m} ${k} km > 60 % of ${peak} goal ${gl.race_date} ${gl.cls}; weeks ${JSON.stringify(g.report.weeks.filter((x) => x.monday <= gl.race_date).slice(-6).map((x) => [x.monday.slice(5), x.phase, x.target_km, x.km, x.cutback]))} ctx ${JSON.stringify(ctx)}`) }
  }
}
test('AC-P4-1 property: random goals × availability × start volume × guard mode × cutback → clean, frozen, available, low-intensity, tapered (default 150, PLAN_PROP_N for more)', () => {
  const R = rng(11), N = +process.env.PLAN_PROP_N || 150
  for (let i = 0; i < N; i++) {
    const today = addDays(T, Math.floor(R() * 200)), future = (n) => addDays(today, 30 + Math.floor(R() * n))
    const goals = Array.from({ length: 1 + Math.floor(R() * 3) }, (_, k) => ({ id: k + 1, status: 'active', params: {}, name: 'R' + k, cls: 'ABCD'[Math.floor(R() * 4)], distance_m: R() < 0.7 ? 42195 : 21097, race_date: (() => { let d = future(300); while (dowOf(d) !== 0) d = addDays(d, 1); return d })() }))
    const seen = new Set(); const gl = goals.filter((g) => !seen.has(g.race_date) && seen.add(g.race_date)).sort((a, b) => a.race_date.localeCompare(b.race_date))
    const rules = R() < 0.5 ? [] : Array.from({ length: 7 }, (_, dow) => ({ dow, windows: R() < 0.2 ? [] : [{ max_min: [45, 60, 90, 150, 240][Math.floor(R() * 5)] }], pref: R() < 0.2 ? { rest: true } : R() < 0.2 ? { long: true } : {} }))
    const exceptions = Object.fromEntries(Array.from({ length: Math.floor(R() * 10) }, () => [addDays(today, Math.floor(R() * 120)), R() < 0.6 ? [] : [{ max_min: 40 }]]))
    const ctx = { weekly4w: 6 + R() * 40, longest30: R() * 30, guardBaseline: R() < 0.5 ? 'literal' : 'build', cutbackRatio: 0.75 + R() * 0.2, peakCap: 30 + R() * 40 }, args = { today, plan: PLAN, goals: gl, availability: { rules, exceptions }, ctx }
    const a = generate(args), b = generate(args); assert.deepEqual(a.days, b.days, 'not deterministic')
    checkInvariants(a, { ...args }, `case ${i}`)
  }
})
test('AC-P4-1 the real calendar: both guard interpretations are kernel-clean; build baseline reaches a much higher peak than the rule read literally', () => {
  const out = {}
  for (const mode of ['literal', 'build']) {
    const ctx = { ...CTX, guardBaseline: mode }, args = { today: T, plan: PLAN, goals: GOALS, availability: {}, ctx }, g = generate(args); checkInvariants(g, args, mode)
    const w = g.report.weeks, preJrf = Math.max(...w.filter((x) => x.monday > '2027-06-21' && x.monday < '2027-10-04').map((x) => x.km)); out[mode] = { peak: g.report.peak_km, preJrf, conflicts: g.report.conflicts.length }
    assert.ok(w[0].km <= 17.5 + 0.1, 'first week starts from the ACTUAL volume (15.9 km), not the plan'); assert.equal(g.report.start, '2026-11-30')
    for (const c of g.report.conflicts) assert.match(c.why, /postponed/)
  }
  assert.ok(out.build.preJrf > out.literal.preJrf * 1.5, JSON.stringify(out))
  console.log('Plan v2 projection', JSON.stringify(out))
})
test('freeze windows and goal-race tapers hold macro proposals', () => {
  assert.equal(inFreeze('2027-06-01'), true); assert.equal(inFreeze('2027-07-01'), false)
  const db = fresh()
  assert.equal(macroHold(db, '2027-06-01').hold, true); assert.match(macroHold(db, '2027-06-01').why, /freeze/)
  assert.match(macroHold(db, '2027-05-25').why, /taper/)   // 19 days to Jakim (B), before the 30 May freeze
  assert.match(macroHold(db, '2027-10-10').why, /freeze/)  // the JRF taper sits inside the October freeze
  assert.equal(proposeMacro(db, { today: '2027-06-01', ctx: CTX }).held, true)
  assert.equal(macroHold(db, T).hold, false)
})
test('AC-P4-4/2/3 Plan v2 end to end: propose → diff + summary → duplicate is idempotent → plan untouched → accept → revert restores version 1', () => {
  const db = fresh(), r = proposeMacro(db, { today: T, ctx: CTX })
  assert.equal(r.ok, true, JSON.stringify(r)); assert.ok(r.summary.peak_after < r.summary.peak_before); assert.equal(r.summary.start, '2026-11-30')
  assert.deepEqual(renderDays(db), PLAN)   // a proposal changes nothing
  const open = openProposals(db); assert.equal(open.length, 1); assert.equal(open[0].loop, 'macro'); assert.ok(open[0].summary.weeks_after && open[0].summary.weeks_before); assert.match(open[0].rationale_det, /actual 15\.9 km/)
  assert.ok(open[0].diff.every((d) => d.date >= '2026-11-30'), 'nothing before the horizon is proposed')
  const dup = proposeMacro(db, { today: T, ctx: CTX, force: true }); assert.equal(dup.duplicate, true); assert.equal(openProposals(db).length, 1)
  accept(db, r.adjustment, { today: T })
  const active = renderDays(db); assert.equal(active.length, PLAN.length)
  for (const d of active.filter((x) => x.date < '2026-11-30')) assert.deepEqual(d, PLAN.find((p) => p.date === d.date))   // frozen horizon untouched
  assert.deepEqual(active.filter((x) => ['race'].includes(x.kind)).map((x) => x.date), PLAN.filter((x) => x.kind === 'race').map((x) => x.date))
  assert.equal(validate(active, { seed: true, weekly4w: 15.9, longest30: 36.9, raceExempt: true, guardBaseline: 'literal' }).filter((v) => v.date >= '2026-11-30').length, 0)
  const second = proposeMacro(db, { today: T, ctx: CTX }); assert.ok(second.no_change || second.held || second.duplicate, 'regenerating the accepted plan changes nothing: ' + JSON.stringify(second).slice(0, 120))
  revert(db, r.adjustment, { today: T }); assert.deepEqual(renderDays(db), PLAN)
})
test('AC-P4-7 goals: validated, seeded from the race calendar, raise a macro trigger that the handler turns into one proposal', () => {
  const db = openPlanDb(':memory:'); importPlan(db, PLAN); assert.deepEqual(seedGoals(db, T), { seeded: RACES.length }); assert.deepEqual(seedGoals(db, T), { seeded: 0 })
  const gl = listGoals(db); assert.equal(gl.find((g) => g.cls === 'A').target_s, 14400); assert.equal(gl.find((g) => g.name === 'Jakim FM').target_s, 18000)
  const bad = (g, re) => assert.throws(() => upsertGoal(db, { race_date: '2027-12-12', name: 'X', cls: 'A', distance_m: 42195, ...g }, { today: T }), re)
  bad({ race_date: '2027-02-30' }, /real/); bad({ race_date: '2026-01-01' }, /future/); bad({ cls: 'Z' }, /cls/); bad({ distance_m: 5 }, /distance/); bad({ name: '' }, /name/); bad({ race_date: '2027-10-24' }, /already exists/); bad({ params: { peak_cap_km: 5 } }, /peak_cap/); bad({ params: { guard_baseline: 'x' } }, /guard_baseline/); bad({ target_s: 5 }, /target_s/)
  assert.equal(db.prepare('SELECT count(*) n FROM plan_goal').get().n, RACES.length)   // rejected edits stored nothing
  const r = upsertGoal(db, { race_date: '2027-12-12', name: 'Test 10K', cls: 'C', distance_m: 10000 }, { today: T }); assert.ok(r.id && r.trigger)
  assert.equal(db.prepare("SELECT route FROM plan_trigger WHERE id=?").get(r.trigger).route, 'macro')
  const h = handleMacroTriggers(db, { today: T, ctx: CTX }); assert.equal(h.handled >= 1, true, JSON.stringify(h.result)); assert.equal(openProposals(db).length, 1)
  assert.equal(db.prepare("SELECT count(*) n FROM plan_trigger WHERE route='macro' AND status='new'").get().n, 0)
  assert.equal(handleMacroTriggers(db, { today: T, ctx: CTX }).handled, 0)
})
test('FR-INP-2/4 availability: validated, versioned, raises triggers; the generator respects it', () => {
  const db = fresh()
  assert.throws(() => validateAvailability({ rules: [{ dow: 9, windows: [] }] }), /dow/); assert.throws(() => validateAvailability({ rules: [{ dow: 1, windows: [{ max_min: 5 }] }] }), /max_min/); assert.throws(() => validateAvailability({ exceptions: { '2027-13-01': [] } }), /valid date/)
  assert.throws(() => validateAvailability({ rules: [{ dow: 1, windows: [] }, { dow: 1, windows: [] }] }), /duplicate/); assert.throws(() => validateAvailability({ rules: [{ dow: 1, windows: [], pref: { fly: true } }] }), /preference/)
  const rules = [{ dow: 6, windows: [{ max_min: 60 }], pref: {} }, { dow: 0, windows: [{ max_min: 240 }], pref: { long: true } }, { dow: 1, windows: [], pref: { rest: true } }]
  const r = setAvailability(db, { rules, exceptions: { '2026-12-15': [] } }, { today: T }); assert.equal(r.triggers.length, 2)
  assert.deepEqual(getAvailability(db, T).rules.map((x) => x.dow), [0, 1, 6]); assert.deepEqual(getAvailability(db, T).exceptions, { '2026-12-15': [] })
  setAvailability(db, { rules: [{ dow: 3, windows: [{ max_min: 60 }] }] }, { today: addDays(T, 1) }); assert.deepEqual(getAvailability(db, T).rules.map((x) => x.dow), [3])   // new pattern supersedes
  const g = generate({ today: T, plan: PLAN, goals: GOALS, availability: { rules, exceptions: { '2026-12-15': [] } }, ctx: CTX })
  assert.equal(g.days.find((d) => d.date === '2026-12-15').km, 0)
  for (const d of g.days.filter((x) => x.date >= '2026-11-30' && dowOf(x.date) === 1)) assert.ok(!(d.km > 0) || d.kind === 'race' || d.kind === 'tt', 'Monday is closed')
  const longs = g.days.filter((d) => d.date >= '2026-11-30' && d.kind === 'long'); assert.ok(longs.length > 5); assert.ok(longs.filter((d) => dowOf(d.date) === 0).length > longs.length * 0.6, 'long run prefers Sunday')
})
