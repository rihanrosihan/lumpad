import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
for (const k of ['NEO4J_URI', 'NEO4J_USER', 'NEO4J_PASSWORD', 'NEO4J_DATABASE']) delete process.env[k]
const N = await import('./neo4j.js')
const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'neo-')), 'env'); fs.writeFileSync(file, 'NEO4J_URI="neo4j+s://abc.databases.neo4j.io"\nNEO4J_USER=neo4j\nNEO4J_PASSWORD=secret\nOTHER=1\n')
test('env: read from the file, quotes stripped, cached', () => {
  N.resetEnvCache(); const e = N.neoEnv({ file }); assert.deepEqual([e.uri, e.user, e.pass, e.db], ['neo4j+s://abc.databases.neo4j.io', 'neo4j', 'secret', 'neo4j'])
  fs.writeFileSync(file, ''); assert.equal(N.neoEnv({ file }).user, 'neo4j') // within a minute the file is not read again
})
test('node(): only named queries run; an unknown name falls back, the browser never supplies Cypher', async () => {
  N.resetEnvCache(); fs.writeFileSync(file, 'NEO4J_URI=https://h.example\nNEO4J_USER=u\nNEO4J_PASSWORD=p\n'); const sent = []
  const fetchFn = async (url, opt) => { sent.push([String(url), JSON.parse(opt.body).statement]); return { ok: true, json: async () => ({ data: { fields: ['a'], values: [[1]] } }) } }
  const env = N.neoEnv({ file }); const r = await N.node('MATCH (n) DETACH DELETE n', { fetchFn, env })
  assert.equal(r.kind, 'races'); assert.equal(sent[0][1], N.QUERIES.races); assert.ok(sent[0][0].startsWith('https://h.example/db/neo4j/query/v2'))
})
test('no settings: reports not connected without calling out', async () => {
  const none = { uri: undefined, user: undefined, pass: undefined, db: 'neo4j' }, fetchFn = async () => { throw new Error('must not be called') }
  assert.equal((await N.node('races', { fetchFn, env: none })).connected, false); assert.equal((await N.overview({ fetchFn, env: none })).configured, false)
})

test('live(): fixed views only; rows become de-duplicated, direction-correct nodes and edges; capped', async () => {
  N.resetEnvCache(); fs.writeFileSync(file, 'NEO4J_URI=https://h.example\nNEO4J_USER=u\nNEO4J_PASSWORD=p\n'); const sent = []
  const rows = [['Session', 'S1', 'Run 1', 'WORE', true, 'Shoe', 'g1', 'Vaporfly'], ['Session', 'S1', 'Run 1', 'WORE', true, 'Shoe', 'g1', 'Vaporfly'], ['Session', 'S1', 'Run 1', 'SIMILAR_TO', false, 'Session', 'S0', 'Run 0'], ['Memory', 7, 'm', null, null, null, null, null]]
  const fetchFn = async (url, opt) => { sent.push(JSON.parse(opt.body).statement); return { ok: true, json: async () => ({ data: { fields: [], values: rows } }) } }
  const g = await N.live('MATCH (n) DETACH DELETE n', { fetchFn, env: N.neoEnv({ file }) })
  assert.equal(g.view, 'sessions'); assert.equal(sent[0], N.LIVE_VIEWS.sessions); assert.ok(!/DELETE|SET |CREATE|MERGE/i.test(sent[0]))
  assert.equal(g.nodes.length, 4); assert.equal(g.edges.length, 2)
  assert.deepEqual(g.edges.find((e) => e.type === 'SIMILAR_TO'), { from: 'Session:S0', to: 'Session:S1', type: 'SIMILAR_TO' })   // direction flag false = the other node points at this one
  for (const v of Object.values(N.LIVE_VIEWS)) assert.ok(!/DELETE|SET |CREATE|MERGE|REMOVE|DROP/i.test(v), 'live views are read-only')
})
test('toGraph caps nodes; live() with no settings does not call out', async () => {
  const many = Array.from({ length: 300 }, (_, i) => ['Day', '2026-01-' + i, 'd', 'NEXT_DAY', true, 'Day', 'x' + i, 'd'])
  assert.ok(N.toGraph(many).nodes.length <= N.LIVE_MAX.nodes)
  const none = { uri: undefined, user: undefined, pass: undefined, db: 'neo4j' }; assert.equal((await N.live('sessions', { fetchFn: async () => { throw new Error('no') }, env: none })).connected, false)
})
