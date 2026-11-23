// Garmin's own fitness numbers (VO2max, race predictions, acute/chronic load) as a small JSON file for the Go graph sync, which turns them into PerfPoints tagged source='garmin'.
// They are NOT merged into the COROS series: the two watches compute these on different scales, so the graph and the Performance panel show them side by side, each with its watch and period.
// Weekly samples (the last reading of each ISO week) keep the graph small. Training data only; no sleep / HRV / pain.
import fs from 'node:fs'
import path from 'node:path'
import { openDb } from './db.js'

const dir = () => process.env.DATA_DIR || path.resolve('server/data')
export const DEVICE_FILE = () => path.join(dir(), 'garmin_device.json')
const week = (d) => { const t = new Date(d + 'T00:00:00Z'); const j = new Date(Date.UTC(t.getUTCFullYear(), 0, 1)); return `${t.getUTCFullYear()}-${String(Math.floor(((t - j) / 864e5 + j.getUTCDay()) / 7)).padStart(2, '0')}` }
const lastPerWeek = (rows) => { const m = new Map(); for (const r of rows) m.set(week(r.date), r); return [...m.values()].sort((a, b) => a.date.localeCompare(b.date)) }
const num = (x) => (x == null || !Number.isFinite(+x) ? null : +(+x).toFixed(2))
export function build({ gdb = openDb() } = {}) {
  const vo2 = gdb.prepare("SELECT date, vo2max FROM g_maxmet WHERE sport='RUNNING' AND vo2max IS NOT NULL ORDER BY date").all()
  const pred = lastPerWeek(gdb.prepare('SELECT date, t5k_s, t10k_s, thalf_s, tmar_s FROM g_race_pred WHERE t5k_s > 0 ORDER BY date, ts').all())
  const acwr = lastPerWeek(gdb.prepare('SELECT date, acute, chronic, ratio FROM g_acwr WHERE chronic IS NOT NULL ORDER BY date, ts').all())
  const points = []
  for (const r of vo2) points.push({ metric: 'garmin_vo2max', domain: 'running_fitness', unit: 'ml/kg/min', date: r.date, value: num(r.vo2max) })
  for (const r of pred) for (const [k, key] of [['garmin_pred_5k', 't5k_s'], ['garmin_pred_10k', 't10k_s'], ['garmin_pred_hm', 'thalf_s'], ['garmin_pred_marathon', 'tmar_s']]) if (r[key] > 0) points.push({ metric: k, domain: 'running_fitness', unit: 's', date: r.date, value: num(r[key]) })
  for (const r of acwr) for (const [k, key, unit] of [['garmin_load_acute', 'acute', 'load'], ['garmin_load_chronic', 'chronic', 'load'], ['garmin_load_ratio', 'ratio', 'ratio']]) if (r[key] != null) points.push({ metric: k, domain: 'load', unit, date: r.date, value: num(r[key]) })
  const doc = { generated: new Date().toISOString(), source: 'garmin', note: 'Garmin scale; not comparable with COROS values', points }
  return doc
}
export function write(opts) { const d = build(opts); fs.mkdirSync(dir(), { recursive: true, mode: 0o700 }); fs.writeFileSync(DEVICE_FILE(), JSON.stringify(d), { mode: 0o640 }); return { points: d.points.length, file: DEVICE_FILE() } }
if (process.argv[1]?.endsWith('deviceexport.js')) console.log(JSON.stringify(write()))
