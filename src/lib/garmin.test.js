import test from 'node:test'
import assert from 'node:assert/strict'
import { garminFacts } from './garmin.js'

test('garminFacts: zones as percentages, RPE x10 and feel scale decoded, strength grams to kg, empty values dropped', () => {
  const v = garminFacts({ primary_source: 'garmin', aerobic_te: 3.4, te_label: 'AEROBIC_BASE', rpe: 30, feel: 50, sweat_ml: 1356, anaerobic_te: 0, hr_zone_s: '[0,0,567,1948,990,5,0]',
    exercise_sets_json: JSON.stringify([{ category: 'LEG_CURL', subCategory: 'WEIGHTED_LEG_CURL', sets: 4, reps: 40, maxWeight: 16000, volume: 640000 }]) })
  assert.equal(v.primary, true); assert.equal(v.zones.find((z) => z.z === 3).pct, 55); assert.equal(v.facts.find((f) => f.k === 'Perceived effort').v, '3/10'); assert.equal(v.facts.find((f) => f.k === 'How it felt').v, 'Normal')
  assert.equal(v.facts.find((f) => f.k === 'Aerobic training effect').note, 'aerobic base'); assert.ok(!v.facts.some((f) => f.k === 'Anaerobic training effect'))
  assert.deepEqual(v.sets[0], { name: 'weighted leg curl', sets: 4, reps: 40, max_kg: 16, volume_kg: 640 }); assert.equal(garminFacts(null), null)
})
