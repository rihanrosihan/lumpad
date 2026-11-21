import test from 'node:test'
import assert from 'node:assert'
import { mergeOfficial, splitsToText, parseSplits, safeUrl } from './official.js'
const base = { '2026-10-25': { event: 'JRF', bib: '#1', splits: [['5K', '0:33:59', '6:48/km']] } }
test('stored edits override field by field; unknown dates are added; junk is ignored', () => {
  const m = mergeOfficial(base, { '2026-10-25': { bib: '#2', net: '1:00:00' }, '2027-01-01': { event: 'New' }, bad: { event: 'x' }, '2026-01-01': null })
  assert.deepEqual(m['2026-10-25'], { event: 'JRF', bib: '#2', net: '1:00:00', splits: base['2026-10-25'].splits }); assert.equal(m['2027-01-01'].event, 'New'); assert.ok(!m.bad); assert.equal(base['2026-10-25'].bib, '#1')
  assert.equal(mergeOfficial(base, { '2026-10-25': { bib: '' } })['2026-10-25'].bib, '')
})
test('splits round-trip through the text form; bad lines are dropped', () => {
  assert.deepEqual(parseSplits(splitsToText(base['2026-10-25'].splits)), base['2026-10-25'].splits); assert.deepEqual(parseSplits('10K | 1:18:59\n\nnonsense\n | x'), [['10K', '1:18:59', '']])
})
test('safeUrl allows only http(s)', () => { assert.equal(safeUrl('javascript:alert(1)'), ''); assert.equal(safeUrl('https://scorenow.id/x'), 'https://scorenow.id/x'); assert.equal(safeUrl('nope'), '') })
