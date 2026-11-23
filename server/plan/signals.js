// Memory -> plan signals (P5). Only memories at VALIDATED or MEASURED evidence may influence ranking (blueprint 9.4); a HYPOTHESIS is shown to the coach as
// context and in rationale, never scored. A signal is structured: memory.payload = { plan_signal: { target: 'coros.P10547' | 'threshold', delta: -0.2 } }.
export const SCORING_TAGS = new Set(['VALIDATED', 'MEASURED'])
export function planSignals(rows = []) {
  const signals = {}, used = [], ignored = []
  for (const r of rows) {
    let p = null; try { p = typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload } catch {}
    const s = p?.plan_signal; if (!s || typeof s.target !== 'string' || !Number.isFinite(s.delta)) continue
    if (r.status !== 'active') { ignored.push({ id: r.id, why: `status ${r.status}` }); continue }
    if (!SCORING_TAGS.has(r.evidence_tag)) { ignored.push({ id: r.id, why: `${r.evidence_tag} evidence is context only` }); continue }
    signals[s.target] = Math.max(-0.25, Math.min(0.25, (signals[s.target] ?? 0) + s.delta)); used.push(r.id)
  }
  return { signals, used, ignored }
}
// short memory lines for the prompt (ids so the model can cite them): rules and measured findings first, hypotheses flagged
export function memoryNotes(rows = [], n = 8) {
  const rank = { VALIDATED: 0, MEASURED: 1, CALCULATED: 2, CLINICIAN: 2, KB: 3, REPORTED: 4, LITERATURE: 5, HYPOTHESIS: 6 }
  return rows.filter((r) => r.status === 'active').sort((a, b) => (rank[a.evidence_tag] ?? 9) - (rank[b.evidence_tag] ?? 9) || b.id - a.id).slice(0, n).map((r) => ({ id: r.id, tag: r.evidence_tag, title: String(r.title || '').slice(0, 90) }))
}
