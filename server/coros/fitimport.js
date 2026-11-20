// Import FIT files that were put on disk by hand (no COROS call, no quota): validate, identify the activity by start time,
// store as fit/<year>/<labelId>.fit (mode 600) and register in fit_files so the intelligence pipeline (intel/pipeline.js) reads it.
// Dry run unless apply=true. Idempotent: a file whose sha256 is already registered is skipped (or relabelled, see below).
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { adb, ARCHIVE_PATH, FIT_DIR, jakartaDate } from './archive.js'
import { parseFitBuffer } from '../intel/fit.js'

const SPORT = { running: 100, walking: 900, hiking: 104, training: 402, cycling: 200, swimming: 300 }
const wibDate = (ms) => new Date(ms + 7 * 3600e3).toISOString().slice(0, 10)
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex')
const nowIso = () => new Date().toISOString()
const rel = (f) => path.relative(path.dirname(ARCHIVE_PATH), f)

function* walk(dir) {
  let ents = []; try { ents = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const e of ents) { const p = path.join(dir, e.name); if (e.isDirectory()) yield* walk(p); else if (/\.fit$/i.test(e.name)) yield p }
}

// What a file is: { label, sport_type, date, matched } — matched=true when an archived activity starts within matchSec of the FIT start.
export function identify(startMs, sportName, matchSec = 120, hash = '') {
  const s = Math.round(startMs / 1000)
  const a = adb.prepare('SELECT label_id, sport_type, date FROM activities WHERE start_ts BETWEEN ? AND ? ORDER BY ABS(start_ts - ?) LIMIT 1').get(s - matchSec, s + matchSec, s)
  if (a) return { label: a.label_id, sport_type: a.sport_type, date: a.date, matched: true }
  return { label: 'up-' + hash.slice(0, 16), sport_type: SPORT[sportName] ?? 9999, date: wibDate(startMs), matched: false }
}

export async function importFits({ dirs, apply = false, keep = false, matchSec = 120, today = jakartaDate() } = {}) {
  const have = new Set(adb.prepare('SELECT path FROM fit_files').all().map((r) => r.path))
  const results = []
  for (const dir of dirs) for (const file of walk(dir)) {
    if (have.has(rel(file))) continue // already registered at this very path
    const r = { file, action: null, label: null, date: null, matched: false, note: null }
    results.push(r)
    try {
      const buf = fs.readFileSync(file)
      if (buf.length < 12 || buf.toString('ascii', 8, 12) !== '.FIT') { r.action = 'invalid'; r.note = 'not a FIT file'; continue }
      const hash = sha(buf), d = await parseFitBuffer(buf), ses = d.sessions?.[0], t = ses?.start_time ?? d.records?.[0]?.timestamp
      if (!(t instanceof Date) || isNaN(t)) { r.action = 'invalid'; r.note = 'no start time in file'; continue }
      const id = identify(t.getTime(), ses?.sport, matchSec, hash)
      Object.assign(r, { label: id.label, date: id.date, matched: id.matched, sport_type: id.sport_type, sha: hash, bytes: buf.length })
      const dup = adb.prepare('SELECT label_id, path FROM fit_files WHERE sha256=?').get(hash)
      const dest = path.join(FIT_DIR, id.date.slice(0, 4), id.label + '.fit')
      if (dup && !(dup.label_id.startsWith('up-') && id.matched && dup.label_id !== id.label)) { r.action = 'skip-duplicate'; r.note = 'already registered as ' + dup.label_id; continue }
      const clash = adb.prepare('SELECT sha256 FROM fit_files WHERE label_id=?').get(id.label)
      if (clash && clash.sha256 !== hash) { r.action = 'invalid'; r.note = `label ${id.label} already has a different file`; continue }
      r.action = dup ? 'relabel' : 'import'; r.dest = dest
      if (!apply) continue
      fs.mkdirSync(path.dirname(dest), { recursive: true })
      if (path.resolve(file) !== path.resolve(dest)) { fs.writeFileSync(dest + '.tmp', buf, { mode: 0o600 }); fs.renameSync(dest + '.tmp', dest) }
      fs.chmodSync(dest, 0o600)
      adb.prepare('BEGIN').run()
      try {
        if (dup) adb.prepare('DELETE FROM fit_files WHERE label_id=?').run(dup.label_id)
        adb.prepare('INSERT INTO fit_files (label_id, sport_type, date, path, bytes, sha256, fetched_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(label_id) DO UPDATE SET sport_type=excluded.sport_type, date=excluded.date, path=excluded.path, bytes=excluded.bytes, sha256=excluded.sha256, fetched_at=excluded.fetched_at')
          .run(id.label, id.sport_type, id.date, rel(dest), buf.length, hash, nowIso())
        // the file is here, so COROS must not be asked for it
        adb.prepare("UPDATE tasks SET status='done', error='imported from file', done_day=?, updated_at=? WHERE key IN (?,?) AND status IN ('pending','failed')")
          .run(today, nowIso(), 'fit:' + id.label, 'fitdl:' + id.label)
        adb.prepare('COMMIT').run()
      } catch (e) { adb.prepare('ROLLBACK').run(); throw e }
      // remove the source (and the old file of a relabel) only after the row is committed
      if (!keep && path.resolve(file) !== path.resolve(dest)) { try { fs.unlinkSync(file) } catch (e) { r.note = 'imported; could not remove source: ' + e.code } }
      if (dup && dup.path !== rel(dest)) { try { fs.unlinkSync(path.join(path.dirname(ARCHIVE_PATH), dup.path)) } catch {} }
    } catch (e) { r.action = 'invalid'; r.note = String(e.message).slice(0, 100) }
  }
  return results
}
