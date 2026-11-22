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
