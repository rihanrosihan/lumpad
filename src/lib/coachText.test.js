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

test('cleanCoachText: the belum-ditarik fix leaves Indonesian answers alone', () => {
  assert.equal(cleanCoachText('Data belum ditarik.'), 'Data not yet extracted.')
  assert.equal(cleanCoachText('Hasil resmi belum ditarik, jadi saya tidak bisa menilai untuk hari ini dan kamu sudah lari dengan baik.'), 'Hasil resmi belum ditarik, jadi saya tidak bisa menilai untuk hari ini dan kamu sudah lari dengan baik.')
})
