// Diagnostic twin of lumpadd/cmd/fitdump: node tools/fitdump.mjs <file.fit>
import { parseFitFile, toSeries } from '../server/intel/fit.js'
import * as M from '../server/intel/metrics.js'
const S = toSeries(await parseFitFile(process.argv[2]))
const cls = M.classify(S), grade = M.gradeSeries(S)
const fp = (name, a) => { let s = 0, nan = 0; for (const x of a) { if (Number.isNaN(x)) nan++; else s += x } console.log(`${name} sum=${s.toFixed(6)} nan=${nan}`) }
console.log('n', S.n); fp('speed', S.speed); fp('dist', S.dist); fp('hr', S.hr); fp('cad', S.cad); fp('alt', S.alt); fp('grade', grade)
const c = [0, 0, 0]; for (const k of cls) c[k]++
console.log('classes', `[${c.join(' ')}]`)
for (const b of M.steadyBlocks(S, cls, grade)) console.log(`block at=${b.at} pace=${b.pace.toFixed(6)} hr=${b.hr.toFixed(6)}`)
