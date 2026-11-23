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
  const rows = [['Session', 'S1', 'Run 1', '2026-11-01', 1.5, 120, null, 'WORE', true, 'Shoe', 'g1', 'Vaporfly', null, null, null, null], ['Session', 'S1', 'Run 1', '2026-11-01', 1.5, 120, null, 'WORE', true, 'Shoe', 'g1', 'Vaporfly', null, null, null, null], ['Session', 'S1', 'Run 1', '2026-11-01', 1.5, 120, null, 'SIMILAR_TO', false, 'Session', 'S0', 'Run 0', '2026-10-20', 1.4, 90, null], ['Memory', 7, 'm', null, null, null, null, null, null, null, null, null, null, null, null, null]]
  const fetchFn = async (url, opt) => { sent.push(JSON.parse(opt.body).statement); return { ok: true, json: async () => ({ data: { fields: [], values: rows } }) } }
  const g = await N.live('MATCH (n) DETACH DELETE n', { fetchFn, env: N.neoEnv({ file }) })
  assert.equal(g.view, 'performance'); assert.equal(sent[0], N.LIVE_VIEWS.performance); assert.ok(!/DELETE|SET |CREATE|MERGE/i.test(sent[0]))
  assert.equal(g.nodes.length, 4); assert.equal(g.edges.length, 2)
  assert.deepEqual(g.edges.find((e) => e.type === 'SIMILAR_TO'), { from: 'Session:S0', to: 'Session:S1', type: 'SIMILAR_TO' })   // direction flag false = the other node points at this one
  for (const v of Object.values(N.LIVE_VIEWS)) assert.ok(!/DELETE|SET |CREATE|MERGE|REMOVE|DROP/i.test(v), 'live views are read-only')
})
test('toGraph caps nodes; live() with no settings does not call out', async () => {
  const many = Array.from({ length: 300 }, (_, i) => ['Day', '2026-01-' + i, 'd', null, null, null, null, 'NEXT_DAY', true, 'Day', 'x' + i, 'd', null, null, null, null])
  assert.ok(N.toGraph(many).nodes.length <= N.LIVE_MAX.nodes)
  const none = { uri: undefined, user: undefined, pass: undefined, db: 'neo4j' }; assert.equal((await N.live('sessions', { fetchFn: async () => { throw new Error('no') }, env: none })).connected, false)
})

test('node properties for colouring are carried; every view is read-only and bounded', () => {
  const g = N.toGraph([['Session', 'S1', 'Run', '2026-11-01T06:00', 1.5, 120, 28.1, 'WORE', true, 'Shoe', 'g1', 'Vaporfly', null, null, null, null]])
  assert.deepEqual(g.nodes[0], { id: 'Session:S1', label: 'Session', name: 'Run', date: '2026-11-01', ef: 1.5, tl: 120, wbgt: 28.1 })
  assert.deepEqual(Object.keys(N.LIVE_VIEWS).sort(), ['chains', 'context', 'days', 'memory', 'performance', 'plan', 'races', 'sessions', 'topics', 'trace'])
  for (const [k, v] of Object.entries(N.LIVE_VIEWS)) assert.match(v, /LIMIT \d+/, k + ' must be bounded')
})
test('the default views also carry every race, from one extra read-only query', async () => {
  assert.ok(!/DELETE|SET |CREATE|MERGE|REMOVE|DROP/i.test(N.RACES_ALWAYS))
  const sent = []; const fetchFn = async (_u, o) => { const s = JSON.parse(o.body).statement; sent.push(s); return { ok: true, json: async () => ({ data: { values: s === N.RACES_ALWAYS ? [['Race', 'r1', 'Old Race', '2025-01-12', null, null, null, null, null, null, null, null, null, null, null, null]] : [] } }) } }
  const g = await N.live('sessions', { fetchFn, env: { uri: 'neo4j+s://x.databases.neo4j.io', user: 'u', pass: 'p', db: 'x' } })
  assert.equal(sent.length, 2); assert.ok(g.nodes.some((n) => n.label === 'Race' && n.name === 'Old Race')); assert.equal(g.hub, undefined, 'the sessions view keeps its own layout')
  const sent2 = sent.length; await N.live('topics', { fetchFn, env: { uri: 'neo4j+s://x.databases.neo4j.io', user: 'u', pass: 'p', db: 'x' } }); assert.equal(sent.length, sent2 + 1, 'other views stay a single query')
})

import { anchorGraph, raceDomain, HUB } from './neo4j.js'
test('raceDomain: long races test durability, short ones speed', () => {
  for (const [n, d] of [['myBCA JRF FM 2026', 'durability'], ['Urbana Qualifier HM', 'durability'], ['Sentul Ultra 17K', 'durability'], ['Bogor City Trail Run', 'durability'], ['Milo Active Race 10K', 'speed'], ['Starbucks 5K', 'speed'], ['Guardian Run', 'speed'], ['LPS Monas Half Marathon', 'durability']]) assert.equal(raceDomain(n).to, 'PerfDomain:' + d, n)
})
test('anchorGraph ties every race, personal best and session to the performance hub with marked derived links; the rest is reported as unlinked', () => {
  const node = (label, key, name, extra = {}) => ({ id: `${label}:${key}`, label, name, date: null, ef: null, tl: null, wbgt: null, ...extra })
  const nodes = ['performance', 'vdot', 'running_fitness', 'cardio', 'durability', 'speed', 'load'].map((k) => node('PerfDomain', k, k)).concat([node('Race', 'r1', 'Starbucks 5K'), node('Race', 'r2', 'JRF FM 2026'), node('Race', 'r3', 'Milo 10K'), node('PB', 'p1', 'FIT best 1 km'), node('Session', 's1', 'run', { ef: 0.9 }), node('Session', 's2', 'run2', { tl: 120 }), node('Session', 's3', 'bare'), node('Shoe', 'x', 'orphan shoe'), node('PerfPoint', 'pp', 'vdot point')])
  const edges = ['vdot', 'running_fitness', 'cardio', 'durability', 'speed', 'load'].map((k) => ({ from: `PerfDomain:${k}`, to: HUB, type: 'PART_OF' })).concat([{ from: 'PerfPoint:pp', to: 'PerfDomain:vdot', type: 'OF_DOMAIN' }, { from: 'Race:r3', to: 'PerfPoint:pp', type: 'IMPLIES' }, { from: 'PB:p1', to: 'Session:s3', type: 'ACHIEVED_IN' }])
  const a = anchorGraph({ nodes, edges })
  const derived = a.edges.filter((e) => e.derived).map((e) => `${e.from}>${e.to}`).sort()
  assert.deepEqual(derived, ['PB:p1>PerfDomain:speed', 'PerfDomain:load>PerfDomain:running_fitness', 'PerfDomain:speed>PerfDomain:vdot', 'Race:r1>PerfDomain:speed', 'Race:r2>PerfDomain:durability', 'Session:s1>PerfDomain:cardio', 'Session:s2>PerfDomain:load', 'Shoe:x>PerfDomain:load'])
  assert.ok(a.edges.filter((e) => e.derived).every((e) => e.type === 'INFORMS' && e.why)); assert.equal(a.hub, HUB)
  assert.deepEqual(a.unlinked, []) // s3 is reached through the PB; r3 already reached the hub through its VDOT point and is not touched
  assert.ok(!a.edges.some((e) => e.derived && e.from === 'Race:r3'))
  assert.deepEqual(anchorGraph({ nodes: [node('Memory', 'm', 'note')], edges: [] }).unlinked, []); assert.equal(anchorGraph({ nodes: [node('Race', 'r', '5K')], edges: [] }).hub, null)
})

test('the races view also reads the hub skeleton (read-only) and comes back anchored to PERFORMANCE', async () => {
  const sent = [], fetchFn = async (_u, o) => { const s = JSON.parse(o.body).statement; sent.push(s); return { ok: true, json: async () => ({ data: { values: /PART_OF/.test(s) ? [['PerfDomain', 'vdot', 'VDOT', null, null, null, null, 'PART_OF', true, 'PerfDomain', 'performance', 'PERFORMANCE', null, null, null, null], ['PerfDomain', 'speed', 'Speed', null, null, null, null, 'PART_OF', true, 'PerfDomain', 'performance', 'PERFORMANCE', null, null, null, null]] : [['Race', '2026-05-24', 'Starbucks 5K', '2026-05-24', null, null, null, null, null, null, null, null, null, null, null, null]] } }) } }
  const g = await N.live('races', { fetchFn, env: { uri: 'neo4j+s://x.databases.neo4j.io', user: 'u', pass: 'p', db: 'x' } })
  assert.equal(g.hub, 'PerfDomain:performance'); assert.ok(sent.some((q) => /PART_OF/.test(q))); assert.ok(sent.every((q) => !/DELETE|SET |CREATE|MERGE|REMOVE|DROP/i.test(q)), 'every query is read-only')
  assert.ok(g.edges.some((e) => e.derived && e.from === 'Race:2026-05-24' && e.to === 'PerfDomain:speed')); assert.deepEqual(g.unlinked, [])
})

import { enrichDomain } from './neo4j.js'
test('enrichDomain ties shoes, weather, plan weeks, checkpoints, topics and rules to the domain they inform; unknown topics stay unlinked', () => {
  const d = (label, name) => enrichDomain({ label, name, ef: null, tl: null })?.to
  assert.equal(d('Shoe', 'Nike Pegasus'), 'PerfDomain:load'); assert.equal(d('HeatBand', 'hot'), 'PerfDomain:cardio'); assert.equal(d('Checkpoint', 'CP3'), 'PerfDomain:durability')
  assert.equal(d('Topic', 'gct_fade'), 'PerfDomain:durability'); assert.equal(d('Topic', 'sleep_min'), 'PerfDomain:cardio'); assert.equal(d('Rule', 'Cap easy pace by HRV'), 'PerfDomain:cardio')
  assert.equal(d('Topic', 'strength_lower'), 'PerfDomain:load'); assert.equal(d('Topic', 'zzz'), undefined); assert.equal(d('Memory', 'note'), undefined)
})

test('toGraph caps: one label cannot take more than its share of the node budget', () => {
  const rows = Array.from({ length: 30 }, (_, i) => ['Memory', 'm' + i, 'mem', null, null, null, null, null, null, null, null, null, null, null, null, null]).concat([['Topic', 't', 'gct_fade', null, null, null, null, null, null, null, null, null, null, null, null, null]])
  const g = N.toGraph(rows, { caps: { Memory: 5 } })
  assert.equal(g.nodes.filter((n) => n.label === 'Memory').length, 5); assert.ok(g.nodes.some((n) => n.label === 'Topic'))
})
test('expand sends the node as parameters (never in the Cypher), refuses odd labels, and ties new nodes to a domain', async () => {
  const sent = []; const env = { uri: 'neo4j+s://x.databases.neo4j.io', user: 'u', pass: 'p', db: 'x' }
  const fetchFn = async (_u, o) => { const b = JSON.parse(o.body); sent.push(b); return { ok: true, json: async () => ({ data: { values: [['Shoe', '7', 'Pegasus', null, null, null, null, 'WORE', false, 'Session', 's1', 'run', '2026-01-01', 0.9, null, null]] } }) } }
  const g = await N.expand('Shoe', "7' OR 1=1 //", { fetchFn, env })
  assert.deepEqual(sent[0].parameters, { label: 'Shoe', key: "7' OR 1=1 //" }); assert.ok(!sent[0].statement.includes('OR 1=1'))
  assert.ok(g.edges.some((e) => e.derived && e.from === 'Shoe:7' && e.to === 'PerfDomain:load')); assert.ok(sent[0].statement.indexOf('DELETE') < 0)
  assert.equal((await N.expand('Sh oe);DROP', 'x', { fetchFn, env })).error, 'bad node id'); assert.equal(sent.length, 1)
})
