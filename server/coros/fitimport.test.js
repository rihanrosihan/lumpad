import test from 'node:test'
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lumpad-fitimport-'))
Object.assign(process.env, { LUMPAD_DB: ':memory:', COROS_ARCHIVE_DB: path.join(tmp, 'coros.db'), DATA_DIR: tmp, COROS_FIT_DIR: path.join(tmp, 'fit') })
const { adb } = await import('./archive.js'), { importFits } = await import('./fitimport.js')
const SRC = path.resolve('server/data/fit/2026'), real = fs.existsSync(SRC) ? fs.readdirSync(SRC).filter((f) => f.endsWith('.fit')) : []

test('invalid file is reported, nothing registered', async () => {
  const inbox = path.join(tmp, 'inbox'); fs.mkdirSync(inbox); fs.writeFileSync(path.join(inbox, 'junk.fit'), 'not a fit file at all')
  const r = await importFits({ dirs: [inbox], apply: true })
  assert.equal(r[0].action, 'invalid'); assert.equal(adb.prepare('SELECT COUNT(*) n FROM fit_files').get().n, 0)
})
test('real FIT: dry run writes nothing; apply registers it, matches the activity, closes the task; rerun is a no-op', { skip: !real.length }, async () => {
  const inbox = path.join(tmp, 'inbox2'); fs.mkdirSync(inbox)
  const buf = fs.readFileSync(path.join(SRC, real[0])); fs.writeFileSync(path.join(inbox, 'hash-name.fit'), buf)
  const { parseFitBuffer } = await import('../intel/fit.js'), d = await parseFitBuffer(buf), t = d.sessions[0].start_time
  adb.prepare('INSERT INTO activities (label_id, sport_type, date, start_ts, end_ts, rec, seen_at) VALUES (?,?,?,?,?,?,?)').run('999000111', 100, new Date(t.getTime() + 7 * 3600e3).toISOString().slice(0, 10), Math.round(t / 1000) + 30, 0, '{}', 'x')
  adb.prepare("INSERT INTO tasks (key, tool, args, day, rank, status, created_at) VALUES ('fit:999000111','queryActivityFitFileDownloadUrls','{}','2025-01-01',4,'pending','x')").run()
  const dry = await importFits({ dirs: [inbox] }); assert.equal(dry[0].action, 'import'); assert.equal(dry[0].label, '999000111'); assert.equal(adb.prepare('SELECT COUNT(*) n FROM fit_files').get().n, 0)
  const ap = await importFits({ dirs: [inbox], apply: true }); assert.equal(ap[0].action, 'import')
  const row = adb.prepare('SELECT * FROM fit_files').get(); assert.equal(row.label_id, '999000111'); assert.match(row.path, /^fit\/\d{4}\/999000111\.fit$/)
  assert.equal(fs.statSync(path.join(tmp, row.path)).mode & 0o777, 0o600); assert.equal(fs.readdirSync(inbox).length, 0)
  assert.equal(adb.prepare("SELECT status FROM tasks WHERE key='fit:999000111'").get().status, 'done')
  assert.equal((await importFits({ dirs: [inbox, path.join(tmp, 'fit')], apply: true })).length, 0)
})
test('duplicate content under another name is skipped; unmatched file gets an up- label then is relabelled once its activity exists', { skip: !real.length }, async () => {
  const inbox = path.join(tmp, 'inbox3'); fs.mkdirSync(inbox)
  fs.writeFileSync(path.join(inbox, 'copy.fit'), fs.readFileSync(path.join(tmp, 'fit', fs.readdirSync(path.join(tmp, 'fit'))[0], '999000111.fit')))
  assert.equal((await importFits({ dirs: [inbox], apply: true }))[0].action, 'skip-duplicate')
  const other = fs.readFileSync(path.join(SRC, real[1])); fs.writeFileSync(path.join(inbox, 'other.fit'), other)
  const r = await importFits({ dirs: [inbox], apply: true }); assert.match(r.find((x) => x.file.endsWith('other.fit')).label, /^up-[0-9a-f]{16}$/)
  const { parseFitBuffer } = await import('../intel/fit.js'), t = (await parseFitBuffer(other)).sessions[0].start_time
  adb.prepare('INSERT INTO activities (label_id, sport_type, date, start_ts, end_ts, rec, seen_at) VALUES (?,?,?,?,?,?,?)').run('999000222', 100, '2026-01-01', Math.round(t / 1000), 0, '{}', 'x')
  fs.writeFileSync(path.join(inbox, 'again.fit'), other)
  const r2 = await importFits({ dirs: [inbox], apply: true }); assert.equal(r2[0].action, 'relabel')
  assert.ok(adb.prepare("SELECT 1 FROM fit_files WHERE label_id='999000222'").get()); assert.equal(adb.prepare("SELECT COUNT(*) n FROM fit_files WHERE label_id LIKE 'up-%'").get().n, 0)
})
