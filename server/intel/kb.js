// Imports the exported Running knowledge base (36 docs) into intel.db (kb_docs) and memory.db (semantic chunks). Idempotent by doc-id + content hash.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { idb, mdb, tx } from './db.js'
import { addMemory } from './memory.js'

const dataDir = () => process.env.DATA_DIR || path.resolve('server/data')
export function extractZip(zip, dest = path.join(dataDir(), 'kb')) { fs.mkdirSync(dest, { recursive: true, mode: 0o700 }); execFileSync('unzip', ['-q', '-o', zip, '-d', dest]); return dest }
function* walk(dir) { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) yield* walk(p); else if (e.name.endsWith('.md')) yield p } }
export function parseDoc(text) {
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(text), fm = {}; if (m) for (const line of m[1].split('\n')) { const k = /^([\w-]+):\s*(.*)$/.exec(line); if (k) fm[k[1]] = k[2].replace(/^"|"$/g, '').trim() }
  return { fm, body: m ? text.slice(m[0].length) : text }
}
// chunk by "## " headings (the doc's own structure), merge tiny sections, split huge ones at paragraph breaks (~1800 chars)
export function chunk(body, max = 1800) {
  const parts = body.split(/\n(?=#{1,3} )/), out = []; let cur = ''
  const flush = () => { if (cur.trim().length > 80) out.push(cur.trim()); cur = '' }
  for (const p of parts) { if (p.length > max) { flush(); let buf = ''; for (const para of p.split(/\n\n/)) { if ((buf + para).length > max && buf) { out.push(buf.trim()); buf = '' } buf += para + '\n\n' } if (buf.trim().length > 80) out.push(buf.trim()) } else if ((cur + p).length > max) { flush(); cur = p } else cur += '\n' + p }
  flush()
  // a single paragraph can still exceed max (tables, long lines): hard-split at whitespace
  return out.flatMap((c) => { if (c.length <= max * 1.3) return [c]; const r = []; let i = 0; while (i < c.length) { let j = Math.min(c.length, i + max); if (j < c.length) { const sp = c.lastIndexOf(' ', j); if (sp > i + max * 0.5) j = sp } r.push(c.slice(i, j).trim()); i = j } return r.filter((x) => x.length > 80) })
}
const statusOf = (s) => (/^(SUPERSEDED|ARCHIVE|RETIRED)/i.test(s || '') ? 'archived' : 'active')

export function importKb(dir) {
  let docs = 0, chunks = 0, skipped = 0
  for (const file of walk(dir)) {
    if (/MANIFEST\.md$/.test(file)) continue
    const text = fs.readFileSync(file, 'utf8'), { fm, body } = parseDoc(text), id = fm['doc-id'] || path.basename(file).split(' ')[0], hash = crypto.createHash('sha256').update(text).digest('hex')
    const prev = idb.prepare('SELECT hash FROM kb_docs WHERE doc_id=?').get(id)
    if (prev?.hash === hash) { skipped++; continue }
    tx(idb, () => idb.prepare('INSERT INTO kb_docs (doc_id, title, status, source_date, supersedes, path, body, hash, imported_at) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(doc_id) DO UPDATE SET title=excluded.title, status=excluded.status, source_date=excluded.source_date, supersedes=excluded.supersedes, path=excluded.path, body=excluded.body, hash=excluded.hash, imported_at=excluded.imported_at')
      .run(id, fm.title || path.basename(file), fm.status || '', fm['source-date'] || null, fm.supersedes || null, path.relative(dir, file), body, hash, new Date().toISOString()))
    docs++
    // replace this doc's chunks (retire old ones, never leave stale text active)
    mdb.prepare("UPDATE memory SET status='archived', updated_at=? WHERE source='kb' AND source_ref LIKE ? AND status='active'").run(new Date().toISOString(), id + '#%')
    chunk(body).forEach((c, i) => { const head = /^#{1,3} (.+)$/m.exec(c)?.[1] || fm.title || id; mdb.prepare("DELETE FROM memory WHERE source='kb' AND source_ref=?").run(`${id}#${i}`)
      addMemory({ tier: 'semantic', kind: 'kb', title: `${id} · ${head}`.slice(0, 160), body: c, payload: { doc: id, doc_status: fm.status, source_date: fm['source-date'] }, evidence_tag: 'KB', status: statusOf(fm.status), source: 'kb', source_ref: `${id}#${i}`, created_by: 'kb', valid_from: fm['source-date'] || null }); chunks++ })
  }
  return { docs, chunks, skipped, total: idb.prepare('SELECT COUNT(*) n FROM kb_docs').get().n }
}
