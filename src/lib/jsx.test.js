import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { transformSync } from 'esbuild'

// esbuild only WARNS about invalid JSX text such as a bare '>' (vite prints it and still exits 0), so a warning here is a test failure.
const dir = new URL('..', import.meta.url)
for (const f of readdirSync(dir).filter((n) => n.endsWith('.jsx'))) {
  test(`${f} compiles without warnings`, () => { const r = transformSync(readFileSync(new URL(f, dir), 'utf8'), { loader: 'jsx', jsx: 'automatic' }); assert.deepEqual(r.warnings.map((w) => w.text + ' @' + w.location?.line), [], f) })
}
