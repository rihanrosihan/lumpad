// Golden contexts: the REAL Node retrieveRunnerContext on the data snapshot for a fixed set of intents and questions (personal data → gitignored golden folder).
// Usage: DATA_DIR=<snapshot copy> node tools/export_contexts.mjs [out=tools/golden/out/contexts.json]
import fs from 'node:fs'
const out = process.argv[2] || 'tools/golden/out/contexts.json'
const { idb } = await import('../server/intel/db.js'), C = await import('../server/intel/context.js')
const DATE = '2026-11-18'
const longRun = idb.prepare('SELECT activity_id, label_id FROM fit_session WHERE distance_m >= 16000 AND activity_id IS NOT NULL ORDER BY date DESC LIMIT 1').get()
const fm = idb.prepare('SELECT activity_id, label_id FROM fit_session WHERE distance_m >= 40000 AND activity_id IS NOT NULL ORDER BY date DESC LIMIT 1').get()
const hm = idb.prepare('SELECT activity_id, label_id FROM fit_session WHERE distance_m BETWEEN 20000 AND 23000 AND activity_id IS NOT NULL ORDER BY date DESC LIMIT 1').get()
const cases = [
  { name: 'daily brief', intent: 'daily_brief' }, { name: 'weekly review', intent: 'weekly_review' }, { name: 'race plan', intent: 'race_plan' },
  { name: 'session review: latest long run', intent: 'session_review', activityId: longRun?.activity_id },
  { name: 'session review: latest marathon', intent: 'session_review', activityId: fm?.activity_id },
  { name: 'session review: a half marathon by label id', intent: 'session_review', activityId: hm?.label_id },
  { name: 'HR at 8:00 this week', intent: 'question', question: 'why did my HR at 8:00/km rise this week?' },
  { name: 'leg day and GCT', intent: 'question', question: 'how did leg day affect my GCT?' },
  { name: 'Borobudur vs Jakim', intent: 'question', question: 'compare my Borobudur 2025 and Jakim 2026 marathon' },
  { name: 'HR above 160 last month', intent: 'question', question: 'runs above 160 bpm last month' },
  { name: 'shoes', intent: 'question', question: 'what about my HOKA Clifton shoes?' },
  { name: 'tempo in October', intent: 'question', question: 'tempo or threshold sessions in October' },
  { name: 'Indonesian yesterday', intent: 'question', question: 'kemarin lari berapa km?' },
  { name: 'long runs in heat', intent: 'question', question: 'long runs over 20k in heat' },
  { name: 'sleep and HRV before races', intent: 'question', question: 'sleep and HRV before races' },
  { name: 'free text about durability', intent: 'question', question: 'what limits my marathon durability after km 25?' },
]
const res = cases.map((c) => { try { const ctx = C.retrieveRunnerContext({ intent: c.intent, question: c.question || '', date: DATE, activityId: c.activityId || null }); return { ...c, ctx: JSON.parse(JSON.stringify(ctx)) } } catch (e) { return { ...c, error: e.message } } })
fs.writeFileSync(out, JSON.stringify(res))
console.log(res.map((r) => `${r.error ? 'ERR ' + r.error : 'ok'} ${r.name.padEnd(46)} items ${r.ctx ? r.ctx.item_ids.length : '-'} tokens ${r.ctx?.tokens_est ?? '-'}`).join('\n'))
