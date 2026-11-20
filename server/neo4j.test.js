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
