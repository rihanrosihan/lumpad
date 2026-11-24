// Write fence (blueprint 7.1 I1). The pipeline opens every live database READ-ONLY except the two write handles in promote.js. This module records a content hash per protected table
// before the run and compares it after. Live nightly jobs legitimately change some tables, so a difference is reported with the last job times for attribution, never silently accepted.
import { DatabaseSync } from 'node:sqlite'
import crypto from 'node:crypto'
import path from 'node:path'
import fs from 'node:fs'
import { DATA_DIR, nowIso } from './db.js'

export const dbFile = (name) => process.env[{ lumpad: 'LUMPAD_DB', intel: 'INTEL_DB', memory: 'MEMORY_DB', plan: 'PLAN_DB' }[name]] || path.join(DATA_DIR, name + '.db')
export const openRO = (name) => new DatabaseSync(dbFile(name), { readOnly: true })
// tables whose content must not change because of this import; filters exclude the rows this import is allowed to add
export const PROTECTED = {
  lumpad: { tables: ['activities', 'activity_enrichment', 'health_daily', 'health_daily_garmin', 'fitness_daily', 'gear', 'laps'] },
  intel: { tables: ['fit_session', 'daily_feat', 'athlete_baseline', 'twin_state', 'twin_history', 'corr_edge', 'kb_docs', 'fit_session_hist', 'daily_feat_hist', 'history_month'] },
  memory: { tables: ['memory', 'session_context'], filter: { memory: "COALESCE(source,'') <> 'old_lumpad'", session_context: "COALESCE(kind,'') <> 'old_lumpad'" } },
  plan: { tables: null },   // every table
}
export function hashTable(db, tbl, where = '1=1') {
  const h = crypto.createHash('sha256'); let n = 0
  for (const r of db.prepare(`SELECT * FROM "${tbl}" WHERE ${where} ORDER BY rowid`).iterate()) { h.update(JSON.stringify(r)); n++ }
  return { n, sha: h.digest('hex') }
}
export function snapshot() {
  const out = []
  for (const [name, spec] of Object.entries(PROTECTED)) {
    if (!fs.existsSync(dbFile(name))) continue
    const db = openRO(name)
    try {
      const tables = spec.tables || db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map((r) => r.name)
      for (const t of tables) { try { out.push({ db: name, tbl: t, ...hashTable(db, t, spec.filter?.[t]) }) } catch { /* table absent in this build */ } }
    } finally { db.close() }
  }
  return out
}
export function save(db, phase) {
  const at = nowIso(), ins = db.prepare('INSERT OR REPLACE INTO ol_fence VALUES (?,?,?,?,?,?)'), snap = snapshot()
  for (const s of snap) ins.run(phase, s.db, s.tbl, s.n, s.sha, at)
  return snap.length
}
export function compare(db, a = 'baseline', b = 'after') {
  const get = (p) => new Map(db.prepare('SELECT db, tbl, n, sha FROM ol_fence WHERE phase=?').all(p).map((r) => [r.db + '.' + r.tbl, r]))
  const A = get(a), B = get(b), diffs = []
  for (const [k, x] of A) { const y = B.get(k); if (!y) diffs.push({ table: k, change: 'missing-after' }); else if (x.sha !== y.sha) diffs.push({ table: k, change: 'content', rows: [x.n, y.n] }) }
  return { tables: A.size, identical: A.size - diffs.length, diffs }
}
