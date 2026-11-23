import test from 'node:test'
import assert from 'node:assert/strict'
import { expandTerms } from './recall.js'
import { decompose } from './query.js'
import { addContext, getContext } from './sessionctx.js'

test('a sentence-final word still gets synonym expansion', () => {
  assert.deepEqual(expandTerms('how was my sleep.').sort(), expandTerms('how was my sleep').sort())
  assert.ok(expandTerms('how was my sleep.').length > 0)
})
test('"first 5 km of my long run" is not an oldest-first query; "my first half marathon" is', () => {
  assert.ok(!decompose('How did I pace the first 5 km of my long run?').filters.oldest)
  assert.ok(decompose('my first half marathon').filters.oldest)
})
test('"45 min 10 km run" keeps a band around 10 km', () => {
  const d = decompose('45 min 10 km run').filters.dist_km; assert.ok(d && d[1] < 500)
})
test('editing a stretch note rewrites its range; an inverted range is refused', () => {
  const a = addContext({ date: '2026-01-05', km_from: 9, km_to: 12, purpose: 'social_walk', note: 'filming' })
  const b = addContext({ id: a.id, date: '2026-01-05', km_from: 10, km_to: 14, purpose: 'social_walk', note: 'filming' })
  assert.equal(b.id, a.id); assert.equal(getContext(a.id).km_from, 10); assert.equal(getContext(a.id).km_to, 14)
  assert.throws(() => addContext({ date: '2026-01-06', km_from: 12, km_to: 9, purpose: 'social_walk' }), /km_to/)
})
