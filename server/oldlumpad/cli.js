// node server/oldlumpad/cli.js <command> [--dry] [--yes] ...      Run as the lumpad user (it owns the data and the Neo4j env):
//   sudo -u lumpad bash -c 'cd /opt/lumpad && nice -n 15 ionice -c3 node --env-file=.env --max-old-space-size=384 server/oldlumpad/cli.js <command>'
import { openDb, OLD_HORIZON } from './db.js'

const [cmd = 'help', ...rest] = process.argv.slice(2)
const flag = (n) => rest.includes('--' + n), opt = (n, d) => { const a = rest.find((x) => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d }
const ZIP = opt('zip', '/opt/lumpad/old_lumpad.zip'), log = (...a) => process.stderr.write(a.join(' ') + '\n')
const out = (o) => console.log(JSON.stringify(o, null, 1))
const db = openDb()

if (cmd === 'stage') { const { stage } = await import('./stage.js'); out(await stage({ zipPath: ZIP, db, log })) }
else if (cmd === 'parse') { const { parseAll } = await import('./parse.js'); out(parseAll(db, { log })) }
else if (cmd === 'extract') {
  const { runExtract } = await import('./extract.js'), { complete } = await import('../intel/llm.js'), { quotaLevel } = await import('../intel/llmconfig.js')
  const pass = opt('pass', 'p1'), P = { p1: { size: 6000, model: null }, p2: { size: 2500, model: null }, p3: { size: 6000, model: 'deepseek-v4-pro' } }[pass]
  if (!P) { console.error('--pass=p1|p2|p3'); process.exit(2) }
  out(await runExtract({ db, pass, size: Number(opt('size', P.size)), model: opt('model', P.model), limit: Number(opt('limit', Infinity)), conc: Number(opt('conc', 2)), dry: flag('dry'), effort: opt('effort', 'high'), ceiling: Number(opt('ceiling', 5e6)), log, complete, quotaStop: () => quotaLevel() !== 'ok' }))
}
else if (cmd === 'judge') {
  const { runJudge } = await import('./judge.js'), { complete } = await import('../intel/llm.js'), { quotaLevel } = await import('../intel/llmconfig.js')
  out(await runJudge({ db, batchSize: Number(opt('batch', 8)), limit: Number(opt('limit', Infinity)), conc: Number(opt('conc', 2)), dry: flag('dry'), model: opt('model', null), ceiling: Number(opt('ceiling', 6e6)), log, complete, quotaStop: () => quotaLevel() !== 'ok' }))
}
else if (cmd === 'qa') {
  const { runQa } = await import('./qa.js'), { complete } = await import('../intel/llm.js'), { quotaLevel } = await import('../intel/llmconfig.js')
  out(await runQa({ db, batchSize: Number(opt('batch', 6)), limit: Number(opt('limit', Infinity)), conc: Number(opt('conc', 2)), dry: flag('dry'), model: opt('model', 'deepseek-v4-pro'), ceiling: Number(opt('ceiling', 8e6)), log, complete, quotaStop: () => quotaLevel() !== 'ok' }))
}
else if (cmd === 'promote' || cmd === 'rollback-memory') {
  const mem = await import('../intel/memory.js'), { mdb } = await import('../intel/db.js'), P = await import('./promote.js')
  out(cmd === 'promote' ? await P.runPromote({ db, yes: flag('yes'), log, mem, mdb }) : await P.rollback({ db, mdb, batch: opt('batch', null) }))
}
else if (cmd === 'graph' || cmd === 'graph-rollback' || cmd === 'graph-relink') { const G = await import('./graph.js'); out(cmd === 'graph' ? await G.apply({ db, dry: !flag('yes') }) : cmd === 'graph-relink' ? await G.relink() : await G.rollback()) }
else if (cmd === 'golden') { const { runGolden } = await import('./golden.js'), { complete } = await import('../intel/llm.js'); out(await runGolden({ db, zipPath: ZIP, complete, model: opt('model', 'deepseek-v4-pro'), log })) }
else if (cmd === 'verify') { const { verifyAll } = await import('./verify.js'); out(await verifyAll({ db })) }
else if (cmd === 'field') { const F = await import('./field.js'), dir = opt('dir'); if (!dir) { console.error('--dir=<dir with jakim2026/milo2025/guardian2025.sqlite>'); process.exit(2) } out(F.runField({ db, events: F.EVENTS(dir), log })) }
else if (cmd === 'fence') { const f = await import('./fence.js'); const phase = rest.find((a) => !a.startsWith('--')) || 'baseline'; if (phase === 'compare') out(f.compare(db, opt('a', 'baseline'), opt('b', 'after'))); else out({ phase, tables: f.save(db, phase) }) }
else if (cmd === 'quota') { const { getQuota, saveQuota } = await import('../intel/llmconfig.js'); if (opt('used')) out(saveQuota({ used_m: Number(opt('used')) })); else out(getQuota()) }
else if (cmd === 'status') {
  const n = (t, w = '1=1') => db.prepare(`SELECT count(*) c FROM ${t} WHERE ${w}`).get().c
  out({ horizon: OLD_HORIZON, manifest: n('ol_manifest'), docs: n('ol_doc'), chunks: n('ol_chunk'), claims: n('ol_claim'), claims_by_novelty: db.prepare('SELECT novelty, count(*) c FROM ol_claim GROUP BY 1').all(), events: n('ol_event'),
    runs: db.prepare('SELECT phase, sum(calls) calls, sum(tokens) tokens FROM ol_run GROUP BY 1').all() })
} else { console.error('commands: stage | parse | extract --pass=p1|p2|p3 [--limit=N --conc=N --dry] | judge [--batch=N --dry] | qa [--batch=N --dry] | promote [--yes] | rollback-memory [--batch=ID] | golden | verify | field --dir=<dir> | graph [--yes] | graph-relink | graph-rollback | fence <baseline|after|compare> | quota [--used=M] | status'); process.exit(2) }
