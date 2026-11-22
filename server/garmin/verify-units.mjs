import { DatabaseSync } from 'node:sqlite'
import zlib from 'node:zlib'
import fs from 'node:fs'
import FitParserMod from 'fit-file-parser'
const FitParser = FitParserMod.default || FitParserMod
import { unzipSync } from 'fflate'
const db = new DatabaseSync('/opt/lumpad/server/data/garmin.db', { readOnly: true })
const acts = db.prepare("select body from raw_record where dataset='Fitness/summarizedActivities'").all().map(r => JSON.parse(zlib.gunzipSync(r.body)))
const fits = db.prepare('select path,time_created_ms from raw_fit where fit_type=4').all()
const parse = (buf) => new Promise((res, rej) => new FitParser({ force: true, mode: 'list', speedUnit: 'm/s', lengthUnit: 'm' }).parse(buf, (e, d) => e ? rej(e) : res(d)))
let n = 0
for (const a of acts.filter(x => /running/.test(x.activityType)).slice(5, 90).filter((_, i) => i % 18 === 0)) {
  const f = fits.reduce((b, x) => Math.abs(x.time_created_ms - a.startTimeGmt) < Math.abs((b?.time_created_ms ?? 1e18) - a.startTimeGmt) ? x : b, null)
  if (!f || Math.abs(f.time_created_ms - a.startTimeGmt) > 3 * 3600e3) { console.log('no fit near', a.activityId, f && (f.time_created_ms - a.startTimeGmt) / 6e4); continue }
  const d = await parse(fs.readFileSync(f.path)), s = d.sessions?.[0] || {}
  console.log(a.activityId, a.activityType, '| json dist', a.distance, 'dur', a.duration, 'spd', a.avgSpeed, 'elev', a.elevationGain, '| fit dist(m)', s.total_distance, 'timer(s)', s.total_timer_time, 'spd', s.avg_speed ?? s.enhanced_avg_speed, 'ascent', s.total_ascent, 'startΔmin', ((f.time_created_ms - a.startTimeGmt) / 6e4).toFixed(1))
  n++
}
// unknown types: message names present
const buf = fs.readFileSync('/opt/lumpad/garmin_backup.zip')
const up = unzipSync(buf, { filter: f => /UploadedFiles/.test(f.name) })
const inner = unzipSync(Buffer.from(Object.values(up)[0]))
import { fitMeta } from './fitmeta.js'
const seen = {}
for (const [k, v] of Object.entries(inner)) { if (!k.endsWith('.fit')) continue; const m = fitMeta(Buffer.from(v)); if (m && [41, 68, 79, 44, 49].includes(m.type) && (seen[m.type] ||= []).length < 2 && v.length > 300) seen[m.type].push(k) }
for (const [t, ks] of Object.entries(seen)) { const d = await parse(Buffer.from(inner[ks[0]])); console.log('type', t, ks[0].slice(-22), Buffer.from(inner[ks[0]]).length, 'B', Object.keys(d).filter(k => Array.isArray(d[k]) && d[k].length).map(k => k + ':' + d[k].length).join(' ')) }
