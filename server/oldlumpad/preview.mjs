// Read-only preview of what the coach context would contain for a question (no coach run is created, nothing is written).  node server/oldlumpad/preview.mjs "<question>" [intent]
const { retrieveRunnerContext } = await import('../intel/context.js')
const [q, intent = 'question'] = process.argv.slice(2)
const c = retrieveRunnerContext({ intent, question: q })
console.log(JSON.stringify({ intent, tokens_est: c.tokens_est, historical_notes: (c.volatile.historical_notes || []).map((n) => ({ date: n.date, kind: n.kind, tag: n.tag, why: n.why, text: n.text.slice(0, 110) })), historical_count: c.volatile.historical_notes?.length || 0, item_ids_from_old: 0 }, null, 1))
