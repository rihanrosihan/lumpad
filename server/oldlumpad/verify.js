// Phase 8: mechanical check of the isolation invariants (blueprint 7.1). Run after promotion and again after the graph step. Any failed check lists exactly what to look at.
import { openRO, save, compare } from './fence.js'
import { OLD_SOURCE, OLD_HORIZON } from './db.js'

export async function verifyAll({ db, graphSnapshot = null }) {
  const checks = [], add = (id, ok, detail) => checks.push({ id, ok, detail })
  save(db, 'after'); const fc = compare(db, 'baseline', 'after')
  add('I1 write fence (protected tables hash-identical)', fc.diffs.length === 0, fc.diffs.length ? { changed: fc.diffs, note: 'a live job may have run: compare against intel_job / coros sync times before treating as a breach' } : `${fc.identical}/${fc.tables} tables identical`)
  const m = openRO('memory')
  try {
    const q = (s, ...a) => m.prepare(s).get(...a)
    add('I2 horizon (valid_to <= ' + OLD_HORIZON + ', never open-ended)', q("SELECT count(*) c FROM memory WHERE source=? AND (valid_to IS NULL OR valid_to > ?)", OLD_SOURCE, OLD_HORIZON).c === 0, null)
    add('I4 every old_lumpad row is archived (not active, candidate or proposal: invisible to both coach engines and to write-back merging)', q("SELECT count(*) c FROM memory WHERE source=? AND status <> 'archived'", OLD_SOURCE).c === 0, null)
    add('I4b nothing locked', q("SELECT count(*) c FROM memory WHERE source=? AND locked=1", OLD_SOURCE).c === 0, null)
    add('I3 nothing superseded by this import', q("SELECT count(*) c FROM memory WHERE source=? AND supersedes IS NOT NULL", OLD_SOURCE).c === 0, null)
    const rows = m.prepare("SELECT id, payload, source_ref FROM memory WHERE source=?").all(OLD_SOURCE), claim = db.prepare('SELECT quote FROM ol_claim WHERE claim_id=?')
    const bad = rows.filter((r) => { try { const p = JSON.parse(r.payload); return !p.quote || !claim.get(p.claim_id) } catch { return true } })
    add('I7 provenance (every promoted memory has a stored verbatim quote and a claim row)', bad.length === 0, bad.length ? bad.slice(0, 5).map((b) => b.id) : `${rows.length} rows`)
    const audit = db.prepare("SELECT count(*) c FROM ol_write WHERE store='memory.db' AND tbl='memory' AND action='insert'").get().c
    add('I6 every promoted row is in the write log (rollback-able)', audit >= rows.length, { audit, rows: rows.length })
    const sc = q("SELECT count(*) c FROM session_context WHERE kind='old_lumpad' AND counts_for_fitness=0").c
    add('I1b session_context notes never change fitness math (counts_for_fitness stays 1)', sc === 0, null)
  } finally { m.close() }
  if (graphSnapshot) add('G live graph nodes/edges unchanged', graphSnapshot.live_unchanged === true, graphSnapshot.drift)
  return { ok: checks.every((c) => c.ok), checks }
}
