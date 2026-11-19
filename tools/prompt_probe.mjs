// Sentinel contexts → rendered prompts by the CURRENT Node renderer. Used by tools/sync_go_data.mjs (checked-in probe the Go renderer must reproduce
// byte for byte) and by the drift test. Synthetic content only; the stable athlete block is the one that already lives in the repo.
import { STABLE_ATHLETE, DEFINITIONS, TASKS, renderPromptPure } from '../server/intel/prompt.js'

const rules = [{ id: 1, title: 'Pain ≥ 2/10 = durability event', rule: 'Stop the hard session; "finish first". Never <override>.', locked: true, tag: 'VALIDATED' }, { id: 2, title: 'Sleep HR > 67', rule: 'No hard running\nthe next morning', locked: true, tag: 'VALIDATED' },
  { id: 7, title: 'Easy means easy', rule: 'Z2 ceiling 148 bpm & no strides on heavy-leg days', locked: false, tag: 'MEASURED' }, { id: 9, title: 'Café stop 🙂', rule: 'Jakarta — pagi hari', locked: false, tag: 'HYPOTHESIS' }]
const twin = { schema: 'twin/1', as_of: '2026-11-18', load: { ctl: 34.2, atl: 28, tsb: 6.2, acwr: null, ramp_7d: -0.4 }, readiness: { score: 71, caps: [], tier: 'optimal' }, note: 'He said "go" \\ then <stop> & left now\u0001', tiny: 1e-7, big: 1.5e21, neg: -0.5, list: [1, 2.5, null, true, 'x'], empty: {}, nothing: [] }
const edges = [{ exposure: 'strength_lower', outcome: 'gct_fade', window_days_before: [1, 3], partial_rho: -0.42, n: 31, status: 'supported' }]
const episodes = [{ id: 11, tier: 'episodic', kind: 'session', title: 'Run 2026-11-14 21.1 km', body: 'EF 0.789 · run share 48 % — heat 29 °C', tag: 'MEASURED', why: 'recent', date: '2026-11-14' }]
const facts = [{ id: 3, tier: 'semantic', kind: 'insight', title: 'Durability', body: 'Run share falls after km 20', tag: 'HYPOTHESIS', why: 'text match', date: null }]
const telemetry = [{ label_id: '1', date: '2026-11-14', km_total: 21.1, cols: 'km, pace', km: [[1, 361, 148]] }]
const ctxOf = (intent, question, over = {}) => ({ stable: { schema: 'context/1', athlete: STABLE_ATHLETE, definitions: DEFINITIONS, rules, ...over.stable }, volatile: { as_of: '2026-11-18', intent, question, query: { filters: { from: '2026-11-01', shoes: ['HOKA Clifton 10'] }, topics: ['drift', 'shoes'] }, twin_version: 9, twin, correlation_edges: edges, episodes, facts, telemetry, ...over.volatile } })

export const probeCases = () => {
  const cases = []
  for (const intent of Object.keys(TASKS)) for (const lang of ['en', 'id']) cases.push({ intent, lang, ctx: ctxOf(intent, intent === 'question' ? 'Why did my GCT rise after leg day, café run 🙂?' : '') })
  cases.push({ intent: 'question', lang: 'en', ctx: ctxOf('question', 'multi\nline "quoted" <q> & done') })
  cases.push({ intent: 'daily_brief', lang: 'en', ctx: ctxOf('daily_brief', '', { stable: { rules: [] } }) })
  cases.push({ intent: 'daily_brief', lang: 'id', ctx: ctxOf('daily_brief', '', { stable: { rules: rules.filter((r) => r.locked) }, volatile: { correlation_edges: [], episodes: [], facts: [], telemetry: [] } }) })
  return cases
}
// the JSON pieces exactly as JSON.stringify writes them (Go gets them as raw text and must not re-encode)
export const rawOf = (v) => ({ query: JSON.stringify(v.query), twin: JSON.stringify(v.twin), correlation_edges: JSON.stringify(v.correlation_edges), episodes: JSON.stringify(v.episodes), facts: JSON.stringify(v.facts), telemetry: JSON.stringify(v.telemetry) })
export const probe = () => probeCases().map(({ intent, lang, ctx }) => ({ intent, lang, task: TASKS[intent], rules: ctx.stable.rules, volatile: { intent: ctx.volatile.intent, as_of: ctx.volatile.as_of, question: ctx.volatile.question, raw: rawOf(ctx.volatile) }, out: renderPromptPure(ctx, TASKS[intent], lang) }))
