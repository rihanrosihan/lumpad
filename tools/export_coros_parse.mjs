// Replay fixture for the Go COROS parsers: every archived COROS response (lumpad.db raw_pulls + coros.db responses, both gzip) with the
// output of the CURRENT Node parsers. Personal data → write it only to the gitignored golden folder.
// Usage: DATA_DIR=… node tools/export_coros_parse.mjs [out=tools/golden/out/coros_parse.json]
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { DatabaseSync } from 'node:sqlite'
import * as P from '../server/coros/parse.js'

const dir = process.env.DATA_DIR || path.resolve('server/data'), out = process.argv[2] || 'tools/golden/out/coros_parse.json'
const PARSER = { queryDailyHealthData: P.parseDailyHealth, querySleepHrv: P.parseSleepHrv, queryRestingHeartRate: P.parseResting, querySportRecords: P.parseSportRecords,
  queryActivityLapData: P.parseLaps, queryTrainingLoadAssessment: P.parseTrainingLoad, queryRecoveryStatus: P.parseRecovery, queryDevices: P.parseDevices,
  querySleepOverview: P.parseSleepOverview, getActivityDetail: P.parseActivityDetail, queryFitnessAssessmentOverview: P.parseFitness }
const cases = [], seen = new Set()
const add = (tool, body) => {
  if (!PARSER[tool]) return
  const text = zlib.gunzipSync(body).toString('utf8'); if (seen.has(tool + '\u0000' + text)) return; seen.add(tool + '\u0000' + text)
  cases.push({ tool, text, out: PARSER[tool](text) ?? null })
}
const app = new DatabaseSync(path.join(dir, 'lumpad.db'), { readOnly: true })
for (const r of app.prepare("SELECT tool, body FROM raw_pulls WHERE source='coros' AND body IS NOT NULL ORDER BY id").all()) add(r.tool, r.body)
if (fs.existsSync(path.join(dir, 'coros.db'))) { const c = new DatabaseSync(path.join(dir, 'coros.db'), { readOnly: true }); for (const r of c.prepare('SELECT tool, body FROM responses ORDER BY key').all()) add(r.tool, r.body) }
fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, JSON.stringify(cases))
const by = {}; for (const c of cases) by[c.tool] = (by[c.tool] || 0) + 1
console.log(`${cases.length} distinct responses →`, out, by)
