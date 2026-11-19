// The Go engine embeds copies of the athlete baseline and the plan; they must match the JS sources (run node tools/sync_go_data.mjs).
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { goData } from '../../tools/sync_go_data.mjs'

test('Go copies of athlete.js and plan.json are current', () => {
  for (const [f, body] of Object.entries(goData())) assert.equal(fs.readFileSync(`lumpadd/internal/athlete/data/${f}`, 'utf8'), body, `${f} is stale: run node tools/sync_go_data.mjs`)
})
