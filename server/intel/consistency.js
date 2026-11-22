// Cross-store invariants (audit M9). Read-only; returns violations so the nightly job can report them (counts and ids only).
import { idb, mdb } from './db.js'
import { load } from '../db.js'

export function consistencyJob(kv = load('kv', {})) {
  const v = []
  // 1) every fit_session has exactly one active episodic card, and no active card points at a missing session
  const sess = new Set(idb.prepare('SELECT label_id FROM fit_session').all().map((r) => r.label_id))
  const cards = mdb.prepare("SELECT source_ref r, COUNT(*) n FROM memory WHERE source='fit' AND status='active' GROUP BY 1").all(), byRef = new Map(cards.map((c) => [c.r, c.n]))
  for (const l of sess) if ((byRef.get(l) || 0) !== 1) v.push({ inv: 'card_per_session', ref: l, cards: byRef.get(l) || 0 })
  for (const [r] of byRef) if (!sess.has(r)) v.push({ inv: 'orphan_card', ref: r })
  // 2) every daily check-in in kv has a daily_log row with the same pain
  const logs = new Map(idb.prepare('SELECT date, pain FROM daily_log').all().map((r) => [r.date, r.pain]))
  for (const [k, e] of Object.entries(kv)) {
    const m = /^lumpad\.daily\.(\d{4}-\d{2}-\d{2})$/.exec(k); if (!m) continue
    const f = e.value || {}, want = f.painSites && Object.keys(f.painSites).length ? JSON.stringify(f.painSites) : f.pain !== '' && f.pain != null ? JSON.stringify({ all: f.pain }) : null
    if (want !== (logs.get(m[1]) ?? null)) v.push({ inv: 'checkin_projection', ref: m[1] })
  }
  // 3) active KB chunks belong to a known doc
  const docs = new Set(idb.prepare('SELECT doc_id FROM kb_docs').all().map((r) => r.doc_id))
  for (const r of mdb.prepare("SELECT DISTINCT substr(source_ref,1,instr(source_ref,'#')-1) d FROM memory WHERE source='kb' AND status='active'").all()) if (!docs.has(r.d)) v.push({ inv: 'kb_doc_missing', ref: r.d })
  return { violations: v.length, sample: v.slice(0, 10) }
}
