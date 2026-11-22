import test from 'node:test'
import assert from 'node:assert/strict'
import { layout, degrees } from './graphlayout.js'
const nodes = Array.from({ length: 60 }, (_, i) => ({ id: 'n' + i })), edges = Array.from({ length: 59 }, (_, i) => ({ from: 'n' + i, to: 'n' + (i + 1) }))
test('deterministic, inside the frame, no two nodes on top of each other', () => {
  const a = layout(nodes, edges), b = layout(nodes, edges); assert.deepEqual(a, b)
  const P = Object.values(a); for (const p of P) { assert.ok(p.x >= 18 && p.x <= 742 && p.y >= 18 && p.y <= 402) }
  let min = Infinity; for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++) min = Math.min(min, Math.hypot(P[i].x - P[j].x, P[i].y - P[j].y)); assert.ok(min > 4, 'min distance ' + min)
})
test('connected nodes end up closer than the average pair (the springs work)', () => {
  const L = layout(nodes, edges), d = (a, b) => Math.hypot(L[a].x - L[b].x, L[a].y - L[b].y), adj = edges.reduce((s, e) => s + d(e.from, e.to), 0) / edges.length
  let all = 0, c = 0; for (let i = 0; i < 60; i++) for (let j = i + 1; j < 60; j++) { all += d('n' + i, 'n' + j); c++ } assert.ok(adj < all / c, `adjacent ${adj.toFixed(0)} vs average ${(all / c).toFixed(0)}`)
})
test('empty and degrees', () => { assert.deepEqual(layout([], []), {}); assert.deepEqual(degrees([{ id: 'a' }, { id: 'b' }], [{ from: 'a', to: 'b' }, { from: 'a', to: 'x' }]), { a: 2, b: 1 }) })

import { egoGraph, matchIds, dateRange, colorScale } from './graphlayout.js'
const G = { nodes: [{ id: 'a', name: 'Alpha run', label: 'Session', date: '2026-10-01', ef: 1.2, tl: 100, wbgt: 24 }, { id: 'b', name: 'Beta', label: 'Shoe', date: null }, { id: 'c', name: 'Gamma', label: 'Session', date: '2026-11-01', ef: 1.6, tl: 200, wbgt: 30 }, { id: 'd', name: 'Delta', label: 'Memory', date: '2026-09-01' }],
  edges: [{ from: 'a', to: 'b', type: 'WORE' }, { from: 'c', to: 'b', type: 'WORE' }, { from: 'c', to: 'd', type: 'ABOUT' }] }
test('focus: the node, its neighbours and the edges among them only', () => {
  const e = egoGraph(G, 'b'); assert.deepEqual(e.nodes.map((n) => n.id).sort(), ['a', 'b', 'c']); assert.equal(e.edges.length, 2)
  assert.equal(egoGraph(G, null), G)
})
test('search matches name, type and date; empty text highlights nothing', () => {
  assert.deepEqual([...matchIds(G.nodes, 'alpha')], ['a']); assert.deepEqual([...matchIds(G.nodes, 'session')].sort(), ['a', 'c']); assert.deepEqual([...matchIds(G.nodes, '2026-11')], ['c']); assert.equal(matchIds(G.nodes, '  '), null)
})
test('date range and colour scale (blue low → red high, null without a value)', () => {
  assert.deepEqual(dateRange(G.nodes), ['2026-09-01', '2026-11-01']); assert.equal(dateRange([{ id: 'x' }]), null)
  const c = colorScale(G.nodes, 'efficiency'); assert.equal(c(G.nodes[0]), 'hsl(220 75% 50%)'); assert.equal(c(G.nodes[2]), 'hsl(0 75% 50%)'); assert.equal(c(G.nodes[1]), null); assert.equal(colorScale(G.nodes, 'nope')(G.nodes[0]), null)
})
