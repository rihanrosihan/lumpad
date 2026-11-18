import test from 'node:test'
import assert from 'node:assert/strict'
import { RACE_CALENDAR, RACE_CALENDAR_TEXT } from './racecal.js'

test('race calendar given to the coach: Jakim is the B-race with the 2026 benchmark, MJM D, JRF A (full only), Bormar C', () => {
  assert.equal(RACE_CALENDAR.length, 4)
  assert.match(RACE_CALENDAR[0], /^Jakim FM 2027-06-13 = B-race, target sub 5:00 \(official time\); plan the watch for 4:50–4:52.*2026 official 6:53:03; registered/)
  assert.match(RACE_CALENDAR[1], /MJM FM 2027-06-20 = D-race, no time target/); assert.match(RACE_CALENDAR[2], /JRF Full 2027-10-24 = A-race, target sub 4:00.*registration not open/); assert.match(RACE_CALENDAR[3], /Bormar FM 2027-11-14 = C-race/)
  assert.match(RACE_CALENDAR_TEXT, /supersedes older notes/); assert.match(RACE_CALENDAR_TEXT, /G-MJM jog.*not a race/); assert.match(RACE_CALENDAR_TEXT, /half marathon is cancelled/)
  assert.ok(!/C-race, run-walk/.test(RACE_CALENDAR_TEXT))
})
