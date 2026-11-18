// CLI for Claude Code (or any operator). Usage (from /opt/lumpad):
//   node --env-file=.env server/intel/cli.js context  --intent weekly_review [--question "..."] [--activity coros:123] [--out file.json]
//   node --env-file=.env server/intel/cli.js writeback --run 12 --file answer.json
//   node --env-file=.env server/intel/cli.js run [quick|full]      node --env-file=.env server/intel/cli.js status
// If started as root it drops to the owner of server/data first, so new/updated DB files stay readable by the lumpad service.
import fs from 'node:fs'
import path from 'node:path'
const dir = process.env.DATA_DIR || path.resolve('server/data')
if (process.getuid?.() === 0) { const st = fs.statSync(dir); if (st.uid !== 0) { process.setgid(st.gid); process.setuid(st.uid) } }
const [cmd, ...rest] = process.argv.slice(2), arg = (k) => { const i = rest.indexOf('--' + k); return i >= 0 ? rest[i + 1] : undefined }
const { retrieveRunnerContext, renderPrompt, TASKS, OUTPUT_SCHEMA } = await import('./context.js')
const { newRun, finishRun, recentRuns } = await import('./coach.js')
const out = (o) => console.log(JSON.stringify(o, null, 2))
try {
  if (cmd === 'context') {
    const intent = TASKS[arg('intent')] ? arg('intent') : 'daily_brief', ctx = retrieveRunnerContext({ intent, question: arg('question') || '', activityId: arg('activity') || null }), prompt = renderPrompt(ctx, TASKS[intent])
    const run_id = newRun({ intent, provider: 'claude-code', ctx, prompt, question: arg('question') }), body = { run_id, ...prompt, output_schema: OUTPUT_SCHEMA, item_ids: ctx.item_ids, tokens_est: ctx.tokens_est }
    const f = arg('out') || path.join(dir, 'tmp', `coach-${run_id}.json`); fs.mkdirSync(path.dirname(f), { recursive: true, mode: 0o700 }); fs.writeFileSync(f, JSON.stringify(body, null, 2), { mode: 0o600 })
    out({ run_id, file: f, tokens_est: ctx.tokens_est, items: ctx.item_ids.length, next: `answer as JSON per output_schema, then: writeback --run ${run_id} --file <answer.json>` })
  } else if (cmd === 'writeback') {
    const answer = JSON.parse(fs.readFileSync(arg('file'), 'utf8')), r = finishRun(+arg('run'), answer, { provider: 'claude-code', raw: JSON.stringify(answer) }); out(r)
  } else if (cmd === 'run') { const { runIntel } = await import('./run.js'); out(await runIntel(rest[0] === 'quick' ? 'quick' : 'full', { trigger: 'cli' })) }
  else if (cmd === 'status') out({ runs: recentRuns(5), guard: (await import('./llm.js')).guardStatus() })
  else { console.error('commands: context | writeback | run | status'); process.exit(2) }
} catch (e) { console.error('error:', e.message); process.exit(1) }
