// Phase 0: full sha256 manifest with a Keep/Transform/Skip decision for every entry, and the text of the 47 keep/transform text files loaded into oldlumpad.db.
// Nothing is extracted to disk. Skipped and quarantined entries are hashed only (never decoded, never stored).
import { openZip, sha256, fileSha256 } from './zip.js'
import { classify, textual } from './classify.js'
import { OLD_HORIZON, nowIso } from './db.js'

const MONTHS = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 }
export function docDate(entry, body, mtime) {
  let m = /(20\d\d-\d\d-\d\d)/.exec(entry) || /(20\d\d)(\d\d)(\d\d)_\d{6}/.exec(entry)
  if (m) return m[1].includes('-') ? m[1] : `${m[1]}-${m[2]}-${m[3]}`
  m = /(?:Last updated|Last Updated|Captured|Updated)[^A-Za-z0-9]{0,4}\s*(?:[A-Za-z]+\s+)?(?:(\d{4}-\d{2}-\d{2})|([A-Za-z]+)\s+(\d{1,2}),?\s+(20\d\d))/.exec(body)
  if (m) { if (m[1]) return m[1]; const mo = MONTHS[(m[2] || '').toLowerCase()]; if (mo) return `${m[4]}-${String(mo).padStart(2, '0')}-${String(+m[3]).padStart(2, '0')}` }
  return mtime
}
export const clampHorizon = (d) => (d && d > OLD_HORIZON ? OLD_HORIZON : d)
const lang = (t) => (/\b(yang|dan|dengan|untuk|saya|tidak|sudah|karena|lari|sepatu)\b/i.test(t) ? 'id+en' : 'en')

export async function stage({ zipPath, db, log = () => {} }) {
  const arch = await fileSha256(zipPath), z = openZip(zipPath)
  const insM = db.prepare('INSERT OR REPLACE INTO ol_manifest VALUES (?,?,?,?,?,?,?)')
  const insD = db.prepare('INSERT OR REPLACE INTO ol_doc VALUES (?,?,?,?,?,?,?,?)')
  const sum = { files: 0, keep: 0, transform: 0, skip: 0, docs: 0, bytes: 0, unclassified: 0 }
  db.exec('BEGIN')
  try {
    for (const e of z.entries) {
      if (e.dir || e.name.endsWith('.pyc')) continue
      const c = classify(e.name), buf = z.read(e.name)
      insM.run(e.name, buf.length, sha256(buf), c.decision, c.rule, c.sensitivity, arch)
      sum.files++; sum[c.decision]++; sum.bytes += buf.length; if (c.rule === 'UNK') sum.unclassified++
      if (textual(c)) {
        const body = buf.toString('utf8'); if (body.includes('\u0000')) continue
        insD.run('ol/' + e.name, e.name, c.rule, c.sensitivity, clampHorizon(docDate(e.name, body, e.mtime)), lang(body), body, sha256(buf)); sum.docs++
      }
    }
    db.exec('COMMIT')
  } catch (err) { db.exec('ROLLBACK'); throw err } finally { z.close() }
  log(`stage: ${sum.files} files hashed, ${sum.docs} text docs loaded; archive sha256 ${arch.slice(0, 16)}…`)
  return { archive_sha256: arch, ...sum }
}
