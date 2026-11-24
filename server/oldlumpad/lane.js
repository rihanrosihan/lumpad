// History lane for the coach (blueprint 6.4). A SEPARATE, labelled block of archived old-notes memories, offered only for retrospective free questions ("what happened at ...", "when was ...").
// It never enters the citable item list, never feeds the twin, and is the first thing shed when the context budget is tight. With no old_lumpad rows it returns [] and the context is unchanged.
import { ftsQuery } from './judge.js'

const LABEL = 'HISTORICAL old notes (written before 2026-08-12): context only, never a current threshold, target, zone, plan or status.'
const addDays = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10)
export function historyLane({ mdb, question = '', filters = {}, retroQ = false, intent = 'question', max = 6 }) {
  if (intent !== 'question' || !retroQ) return []
  const have = mdb.prepare("SELECT count(*) c FROM memory WHERE source='old_lumpad' AND status='archived'").get().c; if (!have) return []
  const sel = "SELECT id, tier, kind, evidence_tag, valid_from, title, body FROM memory WHERE source='old_lumpad' AND status='archived' AND kind <> 'old_plan'", seen = new Map()   // old plans are not history: they say what was intended, not what happened
  const take = (rows, why) => { for (const r of rows) if (!seen.has(r.id) && seen.size < max) seen.set(r.id, { r, why }) }
  for (const d of (filters.race_dates || []).slice(0, 4)) take(mdb.prepare(sel + ' AND valid_from BETWEEN ? AND ? ORDER BY ABS(julianday(valid_from) - julianday(?)), id LIMIT 4').all(addDays(d, -3), addDays(d, 3), d), 'race date')   // the race day itself first, then its neighbours
  if (filters.from || filters.to) take(mdb.prepare(sel + ' AND valid_from BETWEEN ? AND ? ORDER BY valid_from, id LIMIT 6').all(filters.from || '2000-01-01', filters.to || '2026-08-12'), 'date window')
  const q = ftsQuery(question, 8)
  if (q && seen.size < max) { try { take(mdb.prepare(`SELECT m.id, m.tier, m.kind, m.evidence_tag, m.valid_from, m.title, m.body FROM memory_fts JOIN memory m ON m.id = memory_fts.rowid WHERE memory_fts MATCH ? AND m.source='old_lumpad' AND m.status='archived' AND m.kind <> 'old_plan' ORDER BY bm25(memory_fts, 3.0, 1.0) LIMIT ?`).all(q, max), 'text match') } catch {} }
  return [...seen.values()].map(({ r, why }) => ({ date: r.valid_from, kind: r.kind, tag: r.evidence_tag, why, text: String(r.body).slice(0, 280), label: LABEL }))
}
