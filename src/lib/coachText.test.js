import test from 'node:test'
import assert from 'node:assert/strict'
import { stripCites, cleanCoachText } from './coachText.js'

test('citation markers never reach the reader', () => {
  assert.equal(stripCites('Your step stayed steady even as you got tired [834].'), 'Your step stayed steady even as you got tired.')
  assert.equal(stripCites('A pattern [858] now [834, 858] and [1;2] more'), 'A pattern now and more')
  assert.equal(stripCites('Keep 8 km, HR under 148 [x]. Km 5 [5] stays; list [1,2,3].'), 'Keep 8 km, HR under 148 [x]. Km 5 stays; list.')
  assert.equal(cleanCoachText('belum ditarik [12]'), 'not yet extracted')
  assert.equal(stripCites(null), '')
})
