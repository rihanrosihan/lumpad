import test from 'node:test'
import assert from 'node:assert/strict'
process.env.INTEL_DB = ':memory:'; process.env.MEMORY_DB = ':memory:'; process.env.DATA_DIR = '/tmp/lumpad-test-data-jobs'; process.env.LUMPAD_DB = ':memory:'
const J = await import('./jobledger.js')

test('a failing job is attempted at most twice per day, 30 min then 2 h apart (was: every 5 minutes, 67 paid calls)', () => {
  const key = J.jobKey('session_review', 'session 481762580755415341', '2026-11-18'), t0 = Date.parse('2026-11-18T10:00:00Z')
  let calls = 0
  // simulate the 5-minute scheduler for 24 hours against a provider that always fails
  for (let t = t0; t < t0 + 24 * 3600e3; t += 5 * 60e3) { if (J.canRun(key, t).run) { calls++; J.recordFailure(key, 'session_review', 'response truncated (max_tokens)', t) } }
  assert.equal(calls, 2)
  assert.equal(J.canRun(key, t0 + 23 * 3600e3).why, 'gave_up')
  assert.equal(J.canRun(J.jobKey('session_review', 'session 481762580755415341', '2026-11-19'), t0 + 25 * 3600e3).run, true) // a new day is a new key
})
test('backoff: first retry no sooner than 30 minutes; success closes the job', () => {
  const key = J.jobKey('daily_brief', null, '2026-11-18'), t0 = Date.parse('2026-11-18T01:00:00Z')
  assert.equal(J.canRun(key, t0).run, true)
  J.recordFailure(key, 'daily_brief', 'timeout', t0)
  assert.equal(J.canRun(key, t0 + 29 * 60e3).why, 'backoff'); assert.equal(J.canRun(key, t0 + 31 * 60e3).run, true)
  J.recordSuccess(key, 'daily_brief', t0 + 40 * 60e3)
  assert.equal(J.canRun(key, t0 + 50 * 3600e3).why, 'done')
  assert.equal(J.recentJobs().find((j) => j.key === key).status, 'done')
})
