import test from 'node:test'
import assert from 'node:assert/strict'
import { tileSpec, KEY_RE } from './tiles.js'

test('tileSpec: keyed Voyager tiles with a valid key, free tiles otherwise', () => {
  const k = tileSpec('cb1_example_key_123', false)
  assert.equal(k.url, 'https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png?key=cb1_example_key_123'); assert.equal(k.keyed, true); assert.equal(k.subdomains, ''); assert.equal(k.filter, false)
  assert.equal(tileSpec('cb1_example_key_123', true).filter, true) // dark mode: same style, dimmed by CSS
  for (const bad of ['', null, undefined, 'short', 'has space in it', 'a'.repeat(81), 'x/../y"onerror=1']) { const f = tileSpec(bad, false); assert.equal(f.keyed, false); assert.equal(f.url, 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'); assert.ok(!f.url.includes('key=')); assert.ok(!f.url.includes('cartocdn')) } // CARTO's key-less tiles say API KEY REQUIRED
  assert.equal(tileSpec(' ', true).filter, true); assert.ok(KEY_RE.test('cb1_example_1_abc') && !KEY_RE.test('a b'))
})
