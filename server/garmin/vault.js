// Stage 0 (inventory/manifest) + Stage 1 (raw vault). Read-only on the zip; one entry in memory at a time (plus the open zip buffers).
// Resumable: every entry is a manifest row; done entries are skipped. Idempotent: raw_record is INSERT .. DO NOTHING keyed by natural key.
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import zlib from 'node:zlib'
import { unzipSync } from 'fflate'
import { openDb, GARMIN_FIT_DIR } from './db.js'
import { sha256, datasetName, records, recKey } from './names.js'
import { fitMeta } from './fitmeta.js'

const nowIso = () => new Date().toISOString()
const gz = (s) => zlib.gzipSync(Buffer.from(s), { level: 6 })
const BACKUP_ZIPS = /(LhaBackup|PrimaryTrainingBackup|device-backups)/
const names = (buf) => { const out = []; unzipSync(buf, { filter: (f) => { out.push({ name: f.name, size: f.originalSize }); return false } }); return out }
const one = (buf, name) => Buffer.from(unzipSync(buf, { filter: (f) => f.name === name })[name])

// decision for a top-level entry
export function decide(entry) {
  if (entry.endsWith('/')) return { kind: 'dir', decision: 'skip' }
  if (!entry.startsWith('DI_CONNECT/')) return { kind: 'other_domain', decision: 'exclude', note: 'account/billing/aviation/other: not athletic, never parsed' }
  if (/\.png$/i.test(entry)) return { kind: 'image', decision: 'exclude', note: 'profile image' }
  if (/\.zip$/i.test(entry)) return { kind: 'nested_zip', decision: 'ingest' }
  if (/\.json$/i.test(entry)) return { kind: 'json_dataset', decision: 'ingest' }
  return { kind: 'other', decision: 'vault' }
}

export function guard({ minFreeGb = 5, maxLoad = 1.5, dir = path.resolve('server/data') } = {}) {
  const st = fs.statfsSync(dir), freeGb = (st.bavail * st.bsize) / 1e9
  if (freeGb < minFreeGb) throw new Error(`disk guard: ${freeGb.toFixed(1)} GB free < ${minFreeGb}`)
  return { freeGb, load1: os.loadavg()[0], busy: os.loadavg()[0] > maxLoad }
}

// Stage 0: manifest of every entry (top-level + nested). Safe to re-run; keeps status of unchanged entries.
export function inventory(zipPath, { db = openDb() } = {}) {
  const buf = fs.readFileSync(zipPath), archive = sha256(buf)
  const ins = db.prepare(`INSERT INTO import_manifest (entry, bytes, kind, decision, note, archive_sha256, updated_at) VALUES (?,?,?,?,?,?,?)
    ON CONFLICT(entry) DO UPDATE SET bytes=excluded.bytes, kind=excluded.kind, decision=excluded.decision, note=excluded.note,
      status=CASE WHEN import_manifest.archive_sha256=excluded.archive_sha256 THEN import_manifest.status ELSE 'pending' END, archive_sha256=excluded.archive_sha256, updated_at=excluded.updated_at`)
  const stats = { entries: 0, nested: 0, byKind: {} }
  db.exec('BEGIN')
  try {
    for (const { name, size } of names(buf)) {
      const d = decide(name); if (d.decision === 'skip') continue
      ins.run(name, size, d.kind, d.decision, d.note || null, archive, nowIso()); stats.entries++; stats.byKind[d.kind] = (stats.byKind[d.kind] || 0) + 1
      if (d.kind === 'nested_zip') {
        const inner = one(buf, name)
        for (const n of names(inner)) {
          const key = `${name}!${n.name}`, ext = n.name.split('.').pop().toLowerCase()
          ins.run(key, n.size, ext === 'fit' ? 'fit' : ext === 'csv' || ext === 'gpx' ? 'upload_' + ext : 'backup_blob', 'ingest', null, archive, nowIso())
          stats.nested++; stats.byKind[ext] = (stats.byKind[ext] || 0) + 1
        }
      }
    }
    db.exec('COMMIT')
  } catch (e) { db.exec('ROLLBACK'); throw e }
  return { archive, ...stats }
}

// Stage 1: raw vault. Returns counters; stops cleanly at the time budget or when the machine is busy.
export function loadVault(zipPath, { db = openDb(), budgetMs = 20 * 60e3, fitDir = GARMIN_FIT_DIR, batch = 400, log = () => {}, g = guard } = {}) {
  const t0 = Date.now(), buf = fs.readFileSync(zipPath), c = { json_records: 0, dup_same: 0, conflicts: 0, fits_saved: 0, fits_vaulted: 0, files: 0, stopped: null }
  const put = db.prepare('INSERT INTO raw_record (dataset, rec_key, day, body, sha256, entry) VALUES (?,?,?,?,?,?) ON CONFLICT(dataset, rec_key) DO NOTHING')
  const get = db.prepare('SELECT sha256 FROM raw_record WHERE dataset=? AND rec_key=?')
  const confl = db.prepare('INSERT INTO raw_conflict (dataset, rec_key, kept_sha, new_sha, entry, at) VALUES (?,?,?,?,?,?)')
  const done = db.prepare("UPDATE import_manifest SET status='done', sha256=COALESCE(?, sha256), updated_at=? WHERE entry=?")
  const putFit = db.prepare(`INSERT INTO raw_fit (fit_id, upload_entry, path, bytes, sha256, fit_type, manufacturer, product, time_created_ms) VALUES (?,?,?,?,?,?,?,?,?)
    ON CONFLICT(fit_id) DO NOTHING`)
  const addRec = (dataset, r, text, entry) => {
    const k = recKey(dataset, r, text), res = put.run(dataset, k.key, k.day, gz(text), k.sha, entry)
    if (res.changes) c.json_records++
    else { const kept = get.get(dataset, k.key); if (kept?.sha256 === k.sha) c.dup_same++; else { c.conflicts++; confl.run(dataset, k.key, kept?.sha256 || null, k.sha, entry, nowIso()) } }
  }
  const pending = (dec) => db.prepare("SELECT entry, kind FROM import_manifest WHERE status!='done' AND decision=? ORDER BY entry").all(dec)
  const stopNow = () => { if (Date.now() - t0 > budgetMs) return 'budget'; const s = g(); return s.busy ? 'busy' : null }

  // top-level JSON and 'vault' files
  for (const { entry, kind } of pending('ingest').filter((p) => p.kind === 'json_dataset')) {
    if ((c.stopped = stopNow())) return c
    const data = one(buf, entry), text = data.toString('utf8'), ds = datasetName(entry)
    db.exec('BEGIN')
    try { for (const r of records(JSON.parse(text))) addRec(ds, r, JSON.stringify(r), entry); done.run(sha256(data), nowIso(), entry); db.exec('COMMIT') } catch (e) { db.exec('ROLLBACK'); throw new Error(`${entry}: ${e.message}`) }
    c.files++; log('json', entry)
  }
  // nested zips: process entry-by-entry in batches
  for (const { entry: zname } of pending('ingest').filter((p) => p.kind === 'nested_zip')) {
    const inner = one(buf, zname), backup = BACKUP_ZIPS.test(zname)
    const todo = db.prepare("SELECT entry FROM import_manifest WHERE entry LIKE ? ESCAPE '\\' AND status!='done' ORDER BY entry").all(zname.replace(/[%_\\]/g, '\\$&') + '!%')
    for (let i = 0; i < todo.length; i += batch) {
      if ((c.stopped = stopNow())) return c
      db.exec('BEGIN')
      try {
        for (const { entry } of todo.slice(i, i + batch)) {
          const iname = entry.slice(zname.length + 1), data = one(inner, iname), ext = iname.split('.').pop().toLowerCase(), h = sha256(data)
          if (ext === 'fit') {
            const m = fitMeta(data) || {}, id = (/_(\d{6,})[^/]*\.fit$/i.exec(iname) || [])[1] || (backup ? iname.replace(/[^\w.-]/g, '_').slice(-60) : h.slice(0, 16))
            let p = null
            if (m.type === 4 || backup) { // activity files and the 3 backup FITs go to disk; wellness FITs stay inside the zip (blueprint 3.1)
              fs.mkdirSync(fitDir, { recursive: true }); p = path.join(fitDir, `${h.slice(0, 16)}-${id}.fit`)
              if (!fs.existsSync(p)) fs.writeFileSync(p, data, { mode: 0o600 }); c.fits_saved++
            } else c.fits_vaulted++
            putFit.run(id, entry, p, data.length, h, m.type ?? null, m.manufacturer ?? null, m.product ?? null, m.time_created_ms ?? null)
          } else if (ext === 'csv' || ext === 'gpx' || ext === 'bak') {
            const ds = 'upload/' + ext; db.prepare('INSERT INTO raw_record (dataset, rec_key, day, body, sha256, entry) VALUES (?,?,?,?,?,?) ON CONFLICT DO NOTHING').run(ds, iname, null, zlib.gzipSync(data), h, entry); c.json_records++
          }
          done.run(h, nowIso(), entry)
        }
        db.exec('COMMIT')
      } catch (e) { db.exec('ROLLBACK'); throw e }
      log('nested', zname, Math.min(i + batch, todo.length) + '/' + todo.length)
    }
    db.prepare("UPDATE import_manifest SET status='done', updated_at=? WHERE entry=?").run(nowIso(), zname)
  }
  db.prepare("UPDATE import_manifest SET status='done' WHERE decision IN ('exclude','vault') AND status!='done'").run()
  try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)') } catch {}
  return c
}

// Reconciliation: manifest vs vault. Counts only (no content).
export function report(db = openDb()) {
  const q = (s, ...a) => db.prepare(s).all(...a)
  return {
    manifest: q('SELECT kind, decision, status, COUNT(*) n FROM import_manifest GROUP BY 1,2,3 ORDER BY 1,2,3'),
    raw_by_dataset: q('SELECT dataset, COUNT(*) n, MIN(day) d0, MAX(day) d1 FROM raw_record GROUP BY 1 ORDER BY 1'),
    fit_types: q('SELECT fit_type, COUNT(*) n, SUM(path IS NOT NULL) on_disk FROM raw_fit GROUP BY 1 ORDER BY 2 DESC'),
    conflicts: q('SELECT COUNT(*) n FROM raw_conflict')[0].n,
  }
}
