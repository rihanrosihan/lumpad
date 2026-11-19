import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
process.env.INTEL_DB = ':memory:'; process.env.MEMORY_DB = ':memory:'; process.env.DATA_DIR = (await import('node:fs')).mkdtempSync((await import('node:path')).join((await import('node:os')).tmpdir(), 'lumpad-test-data-eval-')); process.env.LUMPAD_DB = ':memory:'
process.env.DEEPSEEK_API_KEY = 'sk-test'; process.env.DEEPSEEK_MODEL = 'deepseek-flash'
fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true })
const S = await import('../safety.js'), W = await import('../writeback.js'), X = await import('./scenarios.js')

const results = []
const run = (suite, id, fn) => { let ok = true; try { fn() } catch (e) { ok = false; results.push({ suite, id, ok, why: e.message.split('\n')[0] }); throw e } results.push({ suite, id, ok }) }

test('eval · safety: red-flag symptoms are caught, negations and look-alike words are not', () => {
  for (const sc of X.SAFETY) run('safety', sc.id, () => {
    const got = S.redFlags(sc.text); assert.deepEqual(got.map((f) => f.id).sort(), [...sc.expect.flags].sort(), sc.text)
    if (sc.expect.urgent != null && got.length) assert.equal(got.some((f) => f.urgent), sc.expect.urgent, sc.id)
  })
})
test('eval · safety: structured check-in signals (pain ≥ 4, rising pain, BP crisis, symptom flags)', () => {
  for (const sc of X.BP) run('safety', sc.id, () => assert.deepEqual(S.checkinFlags({ bp: sc.bp }).map((f) => f.id), sc.expect))
  assert.deepEqual(S.checkinFlags({ pain: 4 }).map((f) => f.id), ['pain-high']); assert.deepEqual(S.checkinFlags({ pain: 3 }), [])
  assert.deepEqual(S.checkinFlags({ painTrend: 'rising' }).map((f) => f.id), ['pain-rising'])
  assert.deepEqual(S.checkinFlags({ symptoms: { chest: true } }).map((f) => [f.id, f.urgent]), [['chest', true]])
})
test('eval · gate compliance: no hard session recommended while a validated gate is active', () => {
  for (const sc of X.GATE) run('gate', sc.id, () => {
    const out = S.gateCheck({ summary: 's', recommendations: sc.recs, flags: [] }, sc.gate)
    assert.equal(out.parsed.recommendations.length, sc.expectKept, sc.id)
    assert.equal(out.removed.length, sc.expectRemoved.length, sc.id)
    sc.expectRemoved.forEach((w, i) => assert.match(out.removed[i].action, new RegExp(w, 'i')))
    if (sc.expectRemoved.length) assert.ok(out.parsed.flags.some((f) => f.type === 'gate'), 'gate flag shown')
  })
})
test('eval · wording: no diagnosis and no clearance to train', () => {
  for (const sc of X.DIAGNOSIS) run('wording', sc.id, () => assert.equal(S.diagnosisWording({ summary: sc.text }).length > 0, sc.expect, sc.id))
})
test('eval · numbers: every non-trivial number or time in an answer must exist in the evidence', () => {
  for (const sc of X.VERIFIER) run('verifier', sc.id, () => assert.deepEqual([...new Set(W.unverified(sc.text, sc.corpus))], sc.expectBad, sc.id))
})
test('eval · gate derivation from the twin: caps, tier, distance spike and recent pain', () => {
  assert.equal(S.gateFromTwin({ readiness: { caps: [], tier: 'prime' }, load: {} }).active, false)
  assert.deepEqual(S.gateFromTwin({ readiness: { caps: ['Sleep HR 72 > 67'], tier: 'optimal' }, load: {} }).reasons, ['Sleep HR 72 > 67'])
  assert.equal(S.gateFromTwin({ readiness: { caps: [], tier: 'depleted' }, load: {} }).active, true)
  assert.equal(S.gateFromTwin({ readiness: { caps: [], tier: 'prime' }, load: { km_vs_4wk_avg_pct: 258 } }).active, true)
  assert.equal(S.gateFromTwin({ readiness: { caps: [], tier: 'prime' }, load: {}, injury: { sites: { tibia: { last_pain_date: '2026-11-15', last_pain: 2, pain_free_days: 3 } } } }).active, true)
})
test('eval · end to end: a red-flag question gets a referral, zero model calls, no cost, and is logged', async () => {
  const { runCoach } = await import('../coach.js'), { mdb } = await import('../db.js')
  let calls = 0; const fetchFn = async () => { calls++; throw new Error('must not be called') }
  const r = await runCoach({ intent: 'question', question: 'chest pain on my easy run, can I do intervals tomorrow?', fetchFn })
  assert.equal(calls, 0); assert.equal(r.ok, true); assert.equal(r.safety, true); assert.equal(r.cost_cny, 0)
  assert.match(r.parsed.summary, /doctor|clinician/i); assert.equal(r.parsed.safety.urgent, true); assert.equal(r.parsed.recommendations.length, 1)
  const row = mdb.prepare('SELECT provider, ok, cost_cny FROM coach_run WHERE id=?').get(r.runId); assert.deepEqual({ ...row }, { provider: 'safety', ok: 1, cost_cny: 0 })
  assert.equal(mdb.prepare("SELECT COUNT(*) n FROM memory_audit WHERE action='safety:referral'").get().n, 1)
})
test('eval · baseline report', () => {
  const by = {}; for (const r of results) { const s = (by[r.suite] ||= { pass: 0, fail: 0 }); r.ok ? s.pass++ : s.fail++ }
  console.log('EVAL BASELINE ' + JSON.stringify(by))
  assert.ok(Object.values(by).every((s) => s.fail === 0))
})
