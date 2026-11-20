// Usage (from /opt/lumpad):  npm run fit:import -- [dir ...] [--apply] [--keep] [--analyze]
//   Default dirs: server/data/fit-inbox and server/data/fit (finds files in fit/ that are not registered yet).
//   Without --apply it only reports what it would do. --analyze runs the quick intelligence job afterwards.
// Started as root it first hands the FIT folders to the data owner, then drops to that user, so nothing it writes is root-owned.
import fs from 'node:fs'
import path from 'node:path'
const dir = process.env.DATA_DIR || path.resolve('server/data')
const args = process.argv.slice(2), flag = (k) => args.includes('--' + k), dirs0 = args.filter((a) => !a.startsWith('--'))
const dirs = dirs0.length ? dirs0.map((d) => path.resolve(d)) : [path.join(dir, 'fit-inbox'), path.join(dir, 'fit')]
if (process.getuid?.() === 0) {
  const st = fs.statSync(dir)
  if (st.uid !== 0) {
    if (flag('apply')) {
      const fix = (p) => { for (const e of fs.readdirSync(p, { withFileTypes: true })) { const q = path.join(p, e.name); if (e.isDirectory()) { fix(q) } fs.chownSync(q, st.uid, st.gid) } fs.chownSync(p, st.uid, st.gid) }
      for (const d of dirs) if (fs.existsSync(d) && path.resolve(d).startsWith(path.resolve(dir))) fix(d)
    }
    process.setgid(st.gid); process.setuid(st.uid)
  }
}
const { importFits } = await import('./fitimport.js')
try {
  const res = await importFits({ dirs, apply: flag('apply'), keep: flag('keep') })
  const by = {}; for (const r of res) by[r.action] = (by[r.action] || 0) + 1
  for (const r of res) console.log((r.action || '?').padEnd(15), (r.label || '-').padEnd(22), r.date || '-', r.matched ? 'matched' : 'no-match', path.basename(r.file), r.note || '')
  console.log(flag('apply') ? 'APPLIED' : 'DRY RUN (add --apply to write)', JSON.stringify(by))
  if (flag('apply') && flag('analyze') && (by.import || by.relabel)) { const { runIntel } = await import('../intel/run.js'); console.log(JSON.stringify(await runIntel('quick', { trigger: 'fit-import' }))) }
  else if (flag('apply') && (by.import || by.relabel)) console.log('next: npm run intel -- quick   (or wait for the nightly job)')
} catch (e) { console.error('error:', e.message); process.exit(1) }
