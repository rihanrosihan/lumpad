// Renders the Plan engine components to static HTML (react-dom/server) from a real esbuild bundle of the .jsx files. No browser needed.
import test from 'node:test'
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { build } from 'esbuild'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

const base = path.resolve('node_modules/.cache'); fs.mkdirSync(base, { recursive: true })   // inside the repo so 'react' resolves from the bundle
const dir = fs.mkdtempSync(path.join(base, 'pe-render-'))
await build({ entryPoints: [path.resolve('src/PlanEngine.jsx'), path.resolve('src/PlanMenuCard.jsx')], outdir: dir, entryNames: '[name]', bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', outExtension: { '.js': '.mjs' },
  external: ['react', 'react-dom', 'react/jsx-runtime'], loader: { '.css': 'empty', '.woff2': 'empty', '.json': 'json' }, logLevel: 'silent', banner: { js: "globalThis.location = { search: '', pathname: '/' }; globalThis.localStorage = { getItem: () => null, setItem() {} };" } })
const PE = await import(path.join(dir, 'PlanEngine.mjs')), MC = await import(path.join(dir, 'PlanMenuCard.mjs'))
const html = (el) => renderToStaticMarkup(el)
test.after(() => fs.rmSync(dir, { recursive: true, force: true }))

const macro = { id: 7, loop: 'macro', operators: ['macro'], rationale_det: 'Season regenerated from 2026-11-30: weekly volume now starts from your actual 15.9 km.', rules: [{ id: 'R-LOAD-10', status: 'pass' }, { id: 'R-48H', status: 'pass' }],
  summary: { start: '2026-11-30', peak_before: 96, peak_after: 26.4, changed_days: 360, key_session_changes: 40, guard_baseline: 'build', weeks_before: { '2026-11-30': 60.5, '2026-12-07': 61.5 }, weeks_after: { '2026-11-30': 17.5, '2026-12-07': 18 }, conflicts: [{ date: '2027-08-28', label: 'Half-marathon Time Trial', why: 'the checkpoint is longer than the load guard allows that week; postponed' }], kept_violations: 1 },
  diff: [{ date: '2026-12-01', before: { kind: 'quality', label: 'Threshold', km: 13 }, after: { kind: 'easy', label: 'Aerobic Endurance Run', km: 5 } }, { date: '2026-12-02', before: { kind: 'easy', label: 'Run', km: 8 }, after: { kind: 'rest', km: 0 } }] }

test('season proposal card shows the decision-relevant facts and both actions', () => {
  const h = html(React.createElement(PE.Proposal, { p: macro, onDone() {} }))
  for (const s of ['Season plan', 'proposed', '96 → 26.4', '360', 'peak km/week', 'build weeks', 'Checkpoints postponed (1)', 'Half-marathon Time Trial', 'postponed', 'Week of Nov 30', 'Threshold', 'R-LOAD-10', 'already over the load guard']) assert.ok(h.includes(s) || h.includes(s.replace(/ /g, '&nbsp;')), 'missing: ' + s)
  assert.match(h, />Accept</); assert.match(h, />Reject</)
})
test('chart has a text alternative and one old/new bar pair per week; a proposal without weeks renders no chart', () => {
  const h = html(React.createElement(PE.WeekChart, { series: [{ monday: '2026-11-30', before: 60.5, after: 17.5 }, { monday: '2026-12-07', before: 61.5, after: 18 }] }))
  assert.match(h, /role="img"/); assert.match(h, /aria-label="Weekly km, old plan versus proposed, 2 weeks\. Old peak 61\.5 km, proposed peak 18 km\./); assert.equal((h.match(/class="pe-bar old"/g) || []).length, 2); assert.equal((h.match(/class="pe-bar new"/g) || []).length, 2); assert.match(h, /<title>/)
  assert.equal(html(React.createElement(PE.WeekChart, { series: [] })), '')
})
test('micro proposal: no chart, diff visible, tone of the km change', () => {
  const h = html(React.createElement(PE.Proposal, { p: { id: 3, loop: 'micro', operators: ['drop'], rationale_det: 'Dropped.', rules: [], summary: {}, diff: [{ date: '2026-12-01', before: { kind: 'easy', label: 'Run', km: 8 }, after: { kind: 'rest', km: 0 } }] }, onDone() {} }))
  assert.ok(!h.includes('pe-chart')); assert.match(h, /Change · drop/); assert.match(h, /−|-8 km/)
})
test('generate card explains the guard trade-off, is disabled without goals, and form controls are labelled', () => {
  const none = html(React.createElement(PE.Generate, { goals: [], onDone() {} })); assert.match(none, /disabled/); assert.match(none, /Add or seed your goals first/); assert.match(none, /decision for you, not a default/)
  const some = html(React.createElement(PE.Generate, { goals: [{ cls: 'A', params: { guard_baseline: 'build', cutback_ratio: 0.85, peak_cap_km: 50 } }], onDone() {} })); assert.ok(!some.includes('Add or seed your goals first')); assert.match(some, /value="build" selected|<option value="build" selected/)
  for (const l of ['Load guard baseline', 'Cutback week', 'Peak cap km/week']) assert.ok(some.includes(l))
})
test('goals and availability screens render their loading state without data (dormant: no crash, no fake numbers)', () => {
  assert.match(html(React.createElement(PE.Goals, { rev: 0, bump() {} })), /Goals/); assert.match(html(React.createElement(PE.Goals, { rev: 0, bump() {} })), /Seed from the race calendar/)
  assert.match(html(React.createElement(PE.Availability, { rev: 0, bump() {} })), /aria-busy/)
})
test('the default screen shows tabs and is accessible by role; menu card renders nothing until data arrives', () => {
  const h = html(React.createElement(PE.default)); assert.match(h, /role="tablist"/); for (const t of ['Proposals', 'Goals', 'Availability', 'Zones', 'History']) assert.ok(h.includes(t)); assert.match(h, /Plan engine/)
  assert.equal(html(React.createElement(MC.default, { date: '2026-12-01' })), '')
})
