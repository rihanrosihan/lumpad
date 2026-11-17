import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { GLOSSARY } from './glossary.js'

const src = readdirSync(new URL('..', import.meta.url)).filter((f) => f.endsWith('.jsx')).map((f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8')).join('\n')
const used = [...src.matchAll(/<Info k="([A-Za-z0-9]+)"/g)].map((m) => m[1])

test('every <Info k> points at a glossary entry', () => { for (const k of used) assert.ok(GLOSSARY[k], 'missing glossary entry: ' + k) })
test('core abbreviations are defined, one sentence-ish each', () => {
  for (const k of ['CTL', 'ATL', 'TSB', 'ACWR', 'EWMA', 'HRV', 'RHR', 'PMC', 'CV', 'TE', 'GAP', 'EF', 'TL']) {
    assert.ok(GLOSSARY[k], k); assert.ok(GLOSSARY[k][1].length > 30 && GLOSSARY[k][1].length < 300, k + ' length')
  }
})
test('abbreviations shown as metric labels carry a "?"', () => {
  for (const k of ['CTL', 'ATL', 'TSB', 'ACWR', 'HRV', 'RHR', 'CV', 'GAP', 'EF']) assert.ok(used.includes(k), k + ' has no <Info> in the UI')
})
