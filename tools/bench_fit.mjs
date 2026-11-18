// Node counterpart of lumpadd/cmd/fitbench: decode only (fit-file-parser, as the current pipeline does), time and peak RSS.
import fs from 'node:fs'
import path from 'node:path'
import { parseFitFile } from '../server/intel/fit.js'
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.fit') ? [path.join(d, e.name)] : []))
const files = walk(process.argv[2] || '.'), t0 = performance.now()
let records = 0, failed = 0
for (const f of files) { try { const r = await parseFitFile(f); records += (r?.records || r?.activity?.records || []).length } catch { failed++ } }
const ms = performance.now() - t0, hwm = Number(/VmHWM:\s+(\d+)/.exec(fs.readFileSync('/proc/self/status', 'utf8'))?.[1] || 0)
console.log(`node: ${files.length} files (${failed} failed), ${records} records, ${ms.toFixed(0)} ms, ${(ms / files.length).toFixed(1)} ms/file, peak RSS ${Math.round(hwm / 1024)} MB`)
