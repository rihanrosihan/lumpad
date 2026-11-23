// Tiny JSON-file store (single user). Health data stays on the VPS.
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
// a test process without DATA_DIR gets a throwaway directory: tests must never read or overwrite the real settings files
const dir = process.env.DATA_DIR || (process.env.NODE_TEST_CONTEXT ? fs.mkdtempSync(path.join(os.tmpdir(), 'lumpad-test-')) : path.resolve('server/data'))
fs.mkdirSync(dir, { recursive: true })
export function load(name, init) { try { return JSON.parse(fs.readFileSync(path.join(dir, name + '.json'), 'utf8')) } catch { return init } }
export function save(name, v) { // atomic: write temp, then rename
  const f = path.join(dir, name + '.json'), tmp = f + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(v, null, 2), { mode: 0o600 }); fs.renameSync(tmp, f)
}
