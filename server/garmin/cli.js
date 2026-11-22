// node server/garmin/cli.js <inventory|vault|report> [zip] [--budget-min=20] [--dry]
// Run as the lumpad user, niced:  sudo -u lumpad nice -n 15 ionice -c3 node --max-old-space-size=384 server/garmin/cli.js vault
import { openDb } from './db.js'
import { inventory, loadVault, report, guard } from './vault.js'
import { stageAll } from './stage.js'
import { dryRun } from './link.js'
import { apply, openLive } from './apply.js'
import { runFitSessions } from './fitsession.js'
import { build as buildHistory, writeMemory } from './history.js'
const [cmd = 'report', ...rest] = process.argv.slice(2)
const zip = rest.find((a) => !a.startsWith('--')) || '/opt/lumpad/garmin_backup.zip'
const opt = (n, d) => { const a = rest.find((x) => x.startsWith(`--${n}=`)); return a ? a.split('=')[1] : d }
const db = openDb()
if (cmd === 'inventory') console.log(JSON.stringify(inventory(zip, { db }), null, 1))
else if (cmd === 'vault') console.log(JSON.stringify(loadVault(zip, { db, budgetMs: Number(opt('budget-min', 20)) * 60e3, log: (...a) => process.stderr.write(a.join(' ') + '\n') }), null, 1))
else if (cmd === 'stage') console.log(JSON.stringify(stageAll(db), null, 1))
else if (cmd === 'link-dry') console.log(JSON.stringify(dryRun({ gdb: db }), null, 1))
else if (cmd === 'apply') console.log(JSON.stringify(apply({ gdb: db, live: openLive(), dry: !rest.includes('--yes') }), null, 1))
else if (cmd === 'fit-sessions') console.log(JSON.stringify(await runFitSessions({ gdb: db, live: openLive(), limit: Number(opt('limit', Infinity)), budgetMs: Number(opt('budget-min', 20)) * 60e3, log: (...a) => process.stderr.write(a.join(' ') + '\n') }), null, 1))
else if (cmd === 'history') console.log(JSON.stringify(buildHistory({ gdb: db }), null, 1))
else if (cmd === 'memory') console.log(JSON.stringify(await writeMemory(), null, 1))
else if (cmd === 'report') console.log(JSON.stringify(report(db), null, 1))
else if (cmd === 'guard') console.log(JSON.stringify(guard()))
else { console.error('usage: inventory|vault|stage|report|guard'); process.exit(2) }
