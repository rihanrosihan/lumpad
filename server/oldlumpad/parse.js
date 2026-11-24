// Phase 1: deterministic parsing (no LLM) of the structured parts of the kept documents into ol_event. Every event is joined to an existing fit_session by date (+ nearest distance) so
// old context ATTACHES to live sessions instead of describing them again. Events whose session cannot be found keep label_id NULL and are reported.
import crypto from 'node:crypto'
import { openRO } from './fence.js'
import { OLD_HORIZON } from './db.js'

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 20)
const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 }
export function csv(text) {
  const rows = []; let row = [], f = '', q = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++ } else q = false } else f += c }
    else if (c === '"') q = true
    else if (c === ',') { row.push(f); f = '' }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(f); f = ''; if (row.some((x) => x !== '')) rows.push(row); row = [] }
    else f += c
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row) }
  const [h, ...b] = rows; return b.map((r) => Object.fromEntries(h.map((k, i) => [k, r[i] ?? ''])))
}
const tableRows = (body, headRe) => {
  const lines = body.split('\n'), i = lines.findIndex((l) => headRe.test(l)); if (i < 0) return []
  const out = []; for (let j = i + 2; j < lines.length && /^\|/.test(lines[j]); j++) out.push(lines[j].replace(/^\||\|\s*$/g, '').split('|').map((x) => x.trim()))
  return out
}
const isoDate = (s) => { const m = /([A-Za-z]{3})[a-z]*\s+(\d{1,2}),\s*(20\d\d)/.exec(s || ''); return m && MON[m[1].toLowerCase()] ? `${m[3]}-${String(MON[m[1].toLowerCase()]).padStart(2, '0')}-${String(+m[2]).padStart(2, '0')}` : null }
const num = (s) => { const m = /-?\d+(?:\.\d+)?/.exec(String(s || '').replace(',', '.')); return m ? Number(m[0]) : null }

export function sessionFinder() {
  const idb = openRO('intel'), q = idb.prepare("SELECT label_id, distance_m, sport FROM fit_session WHERE date=? AND distance_m>=500 ORDER BY distance_m DESC")
  return { find(date, km) { const rows = q.all(date); if (!rows.length) return null; if (!km) return rows[0].label_id; return rows.map((r) => ({ r, d: Math.abs(r.distance_m / 1000 - km) })).sort((a, b) => a.d - b.d)[0].r.label_id }, close: () => idb.close() }
}
const JAKIM = '478193614051115313'

export function parseAll(db, { log = () => {} } = {}) {
  const docs = new Map(db.prepare('SELECT entry, body, doc_date FROM ol_doc').all().map((d) => [d.entry, d]))
  const sf = sessionFinder(), ins = db.prepare('INSERT OR REPLACE INTO ol_event (event_id, kind, event_date, label_id, payload, doc_id, batch_id) VALUES (?,?,?,?,?,?,NULL)')
  const counts = {}, unmatched = []
  const put = (kind, date, label, payload, entry, key) => { if (date && date > OLD_HORIZON) return; ins.run(sha(kind + '|' + (date || '') + '|' + key), kind, date, label, JSON.stringify(payload), 'ol/' + entry); counts[kind] = (counts[kind] || 0) + 1; if (!label && ['race_summary', 'run_context'].includes(kind)) unmatched.push(kind + ' ' + date) }
  db.exec('BEGIN')
  try {
    // 1) race summary table
    const rh = docs.get('races/race-history.md')
    if (rh) for (const r of tableRows(rh.body, /^\|\s*#\s*\|\s*Race\s*\|\s*Date/)) {
      const [n, race, date, dist, fin, pace, hr, device, notes] = r, d = isoDate(date); if (!d) continue
      put('race_summary', d, sf.find(d, num(dist)), { n: +n, race, distance_km: num(dist), finish: fin, pace, avg_hr: num(hr), device_stated: device, notes }, 'races/race-history.md', race)
    }
    // 2) Jakim structured tables (all share one session)
    const J = (n) => [...docs.keys()].find((k) => k.endsWith('/data/' + n))
    const jd = '2026-06-14'
    for (const [file, kind, keyOf] of [['manual_stop_context.csv', 'jakim_stop_labelled', (r) => r.time], ['stop_segments.csv', 'jakim_stop_inferred', (r) => r.segment_index], ['official_chip_splits.csv', 'jakim_official_split', (r) => r.split_order],
      ['official_vs_watch_checkpoints.csv', 'jakim_checkpoint', (r) => r.split_order || r.km], ['weather_timeline.csv', 'jakim_weather', (r) => r.time], ['phase_segments.csv', 'jakim_phase', (r) => r.phase]]) {
      const e = J(file); if (!e) continue
      for (const r of csv(docs.get(e).body)) put(kind, jd, JAKIM, r, e, keyOf(r))
    }
    // 3) athlete-written check-ins in the decision cards (scores + notes; the generated gate tables are ignored)
    for (const [entry, d] of docs) {
      if (!/^obsidian\/Decisions\//.test(entry) || !d.body.includes('Post-Run Check-In')) continue
      const seg = d.body.split('Post-Run Check-In')[1], scores = {}
      for (const m of seg.matchAll(/\*\*(Fatigue|Soreness|Stress|Pain) \(0-10\):\*\*[ \t]*(\d+)/g)) scores[m[1].toLowerCase()] = +m[2]
      const notes = ((/\*\*Notes:\*\*([\s\S]*)/.exec(seg) || [])[1] || '').replace(/###\s*🤖[\s\S]*/, '').trim(), qs = /### 🤖 Coach's Context Queries([\s\S]*)/.exec(seg)
      const date = /Decision-(20\d\d-\d\d-\d\d)/.exec(entry)?.[1]
      if (Object.keys(scores).length || notes) put('checkin', date, null, { scores, notes }, entry, date)
      if (qs && qs[1].trim()) put('coach_question', date, null, { questions: qs[1].replace(/\*|\(Answer these[^)]*\)/g, '').trim().slice(0, 1500) }, entry, date)
    }
    // 4) per-run enrichment table rows (activity, score change, reason): the narrative bullets go through the LLM extractor
    for (const [entry, d] of docs) {
      if (!/context-enrichment\/.*run-context-enrichment\.md$/.test(entry)) continue
      for (const r of tableRows(d.body, /^\|\s*Date\s*\|\s*Activity/)) {
        const [date, activity, prev, upd, reason] = r; if (!/^20\d\d-\d\d-\d\d$/.test(date)) continue
        put('run_context', date, sf.find(date, num(activity)), { activity, score_prev: num(prev), score_updated: num(upd), reason }, entry, date + '|' + activity)
      }
    }
    db.exec('COMMIT')
  } catch (e) { db.exec('ROLLBACK'); throw e } finally { sf.close() }
  log('parse:', JSON.stringify(counts))
  return { counts, unmatched }
}
