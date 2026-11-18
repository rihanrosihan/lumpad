// UI–API contract: every /api path the UI calls must exist as a server route with the same method (three calls had no route in the v5 build).
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : /\.(jsx?|mjs)$/.test(e.name) && !/\.test\./.test(e.name) ? [path.join(d, e.name)] : []))
const server = fs.readFileSync('server/index.js', 'utf8')
const routes = new Set([...server.matchAll(/'(GET|POST|PUT|DELETE) (\/api\/[A-Za-z0-9/_-]+)'/g)].map((m) => `${m[1]} ${m[2]}`))
const pathsOf = (f) => [...fs.readFileSync(f, 'utf8').matchAll(/['"`](\/api\/[A-Za-z0-9/_-]+)/g)].map((m) => m[1])

test('every /api path used by the UI is served (any method)', () => {
  const served = new Set([...routes].map((r) => r.split(' ')[1])), missing = []
  for (const f of walk('src')) for (const p of pathsOf(f)) if (!served.has(p) && !served.has(p.replace(/\/$/, ''))) missing.push(`${p} (${f})`)
  assert.deepEqual([...new Set(missing)], [])
})
test('UI writes use a method the route accepts (fetch POST/PUT/DELETE vs the route table)', () => {
  const bad = []
  for (const f of walk('src')) {
    const t = fs.readFileSync(f, 'utf8')
    for (const m of t.matchAll(/(?:fetch|post)\(\s*['"`](\/api\/[A-Za-z0-9/_-]+)[^)]*?method:\s*['"](POST|PUT|DELETE)['"]/g)) if (!routes.has(`${m[2]} ${m[1]}`)) bad.push(`${m[2]} ${m[1]} (${f})`)
  }
  assert.deepEqual(bad, [])
})
