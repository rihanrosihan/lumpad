// Session context: the athlete's own account of WHY a session looks the way it does (walking with a partner, cheering zones, filming, helping other runners).
// The watch records walk/stop time; only the athlete knows whether it was fatigue. Stated by the athlete = fact: the coach must not contradict it, and a session marked
// counts_for_fitness=0 is left out of durability / fade statistics in the twin.
import { mdb, idb } from './db.js'
import { addMemory } from './memory.js'
import { detectAnomalies } from './anomalies.js'
import { db as app } from '../store.js'
import { PLAN } from '../plan/read.js'

export const PURPOSES = ['social_walk', 'cheering_content', 'helping_others', 'planned_run_walk', 'warmup_cooldown', 'stop_for_need', 'felt_tired', 'heat', 'pain_or_niggle', 'terrain_or_climb', 'planned_pace_change', 'other']
const CHOSEN = ['social_walk', 'cheering_content', 'helping_others', 'planned_run_walk', 'planned_pace_change'] // reasons that are the athlete's own choice, not a body signal
export const KINDS = ['slow', 'fast', 'walk', 'pause', 'hr_spike']
const DATE = /^\d{4}-\d{2}-\d{2}$/, now = () => new Date().toISOString()
const num = (x) => (x == null || x === '' || !isFinite(+x) || +x < 0 ? null : Math.round(+x * 100) / 100)
export function addContext(b, by = 'athlete') {
  if (!DATE.test(b?.date || '')) throw Object.assign(new Error('date must be YYYY-MM-DD'), { status: 400 })
  const note = String(b.note || '').trim().slice(0, 600), purpose = PURPOSES.includes(b.purpose) ? b.purpose : 'other'
  const prev = b.id ? mdb.prepare('SELECT * FROM session_context WHERE id=?').get(+b.id) : null // an edit that sends no kilometres keeps the stored range
  const kmFrom = num(b.km_from) ?? (prev && b.km_from === undefined ? prev.km_from : null), kmTo = num(b.km_to ?? b.km_from) ?? (prev && b.km_to === undefined && b.km_from === undefined ? prev.km_to : null)
  if (kmFrom != null && kmTo != null && kmTo < kmFrom) throw Object.assign(new Error('km_to must not be before km_from'), { status: 400 })
  const isKm = kmFrom != null && kmTo != null && kmTo >= kmFrom, kind = isKm && KINDS.includes(b.kind) ? b.kind : null
  if (!isKm && note.length < 5) throw Object.assign(new Error('say in a sentence what the session was really about'), { status: 400 })
  if (isKm && !note && purpose === 'other') throw Object.assign(new Error('pick a reason or write a few words'), { status: 400 })
  const iw = b.intentional_walking === false || b.intentional_walking === 0 ? 0 : (b.intentional_walking ? 1 : CHOSEN.includes(purpose) ? 1 : 0)
  // a note on a stretch never takes the whole session out of fitness statistics (that would throw away the valid kilometres); only a session-level note can
  const cf = isKm ? 1 : (b.counts_for_fitness === true || b.counts_for_fitness === 1 ? 1 : b.counts_for_fitness === false || b.counts_for_fitness === 0 ? 0 : (iw ? 0 : 1))
  const label = b.label_id ? String(b.label_id).slice(0, 80) : null, t = now(), text = note || (isKm ? `km ${kmFrom}${kmTo > kmFrom ? '–' + kmTo : ''}: ${purpose.replace(/_/g, ' ')}` : '')
  const ex = b.id ? mdb.prepare('SELECT id FROM session_context WHERE id=?').get(+b.id) // editing a note by its id: the reason may change without creating a second note
    : isKm ? mdb.prepare('SELECT id FROM session_context WHERE date=? AND km_from=? AND km_to=?').get(b.date, kmFrom, kmTo)
    : mdb.prepare('SELECT id FROM session_context WHERE date=? AND COALESCE(label_id,\'\')=COALESCE(?,\'\') AND purpose=? AND km_from IS NULL').get(b.date, label, purpose)
  if (ex) { mdb.prepare('UPDATE session_context SET date=?, label_id=?, km_from=?, km_to=?, purpose=?, kind=?, note=?, intentional_walking=?, counts_for_fitness=?, run_km=?, walk_km=?, updated_at=? WHERE id=?').run(b.date, label, isKm ? kmFrom : null, isKm ? kmTo : null, purpose, kind, text, iw, cf, num(b.run_km), num(b.walk_km), t, ex.id); return getContext(ex.id) }
  return getContext(Number(mdb.prepare('INSERT INTO session_context (date, label_id, purpose, note, intentional_walking, counts_for_fitness, run_km, walk_km, km_from, km_to, kind, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(b.date, label, purpose, text, iw, cf, num(b.run_km), num(b.walk_km), isKm ? kmFrom : null, isKm ? kmTo : null, kind, by, t, t).lastInsertRowid))
}
export const getContext = (id) => mdb.prepare('SELECT * FROM session_context WHERE id=?').get(id) || null
export const removeContext = (id) => ({ ok: mdb.prepare('DELETE FROM session_context WHERE id=?').run(+id).changes > 0 })
export const listContext = ({ from, to, limit = 100 } = {}) => mdb.prepare(`SELECT * FROM session_context WHERE 1=1 ${from ? 'AND date >= @from' : ''} ${to ? 'AND date <= @to' : ''} ORDER BY date DESC, id DESC LIMIT @limit`).all(Object.fromEntries(Object.entries({ from, to, limit: Math.min(Math.max(+limit || 100, 1), 300) }).filter(([, v]) => v != null)))
// dates of sessions the athlete says are NOT a fitness/durability signal
export const excludedDates = () => { try { return new Set(mdb.prepare('SELECT date FROM session_context WHERE counts_for_fitness=0 AND km_from IS NULL').all().map((r) => r.date)) } catch { return new Set() } }
// A standing fact the athlete states ("I enjoy walking and filming at events"). Stated by the athlete, so it is active at once, tagged REPORTED, and retrievable like any note.
export function addFact(text, by = 'athlete') {
  const body = String(text || '').trim().replace(/\s+/g, ' ').slice(0, 600); if (body.length < 8) throw Object.assign(new Error('write the fact in a sentence'), { status: 400 })
  const r = addMemory({ tier: 'semantic', kind: 'athlete_fact', title: ('Athlete: ' + body).slice(0, 110), body, evidence_tag: 'REPORTED', status: 'active', source: 'athlete', created_by: by })
  if (!r.created) mdb.prepare("UPDATE memory SET status='active' WHERE id=? AND status IN ('retracted','archived')").run(r.id) // saving a removed fact again brings it back
  return { id: r.id, created: r.created }
}
export const listFacts = () => mdb.prepare("SELECT id, title, body, created_at FROM memory WHERE source='athlete' AND kind='athlete_fact' AND status='active' ORDER BY id DESC LIMIT 30").all()
// the anomalies of one run (by activity id, or the longest run of a date), with the notes already saved for that date
export function sessionAnomalies({ id, date } = {}) {
  const stripped = String(id || '').replace(/^(coros|garmin|strava):/, ''), row = id ? idb.prepare('SELECT label_id, date, distance_m, km FROM fit_session WHERE activity_id=? OR label_id=? OR activity_id=? LIMIT 1').get(String(id), stripped, stripped)
    : DATE.test(date || '') ? idb.prepare('SELECT label_id, date, distance_m, km FROM fit_session WHERE date=? ORDER BY distance_m DESC LIMIT 1').get(date) : null
  if (!row) return { found: false, reason: 'No analysed FIT file for this session yet, so there is no kilometre data to check. You can still describe the whole session.' }
  let km; try { km = JSON.parse(row.km || '[]') } catch { km = [] }
  const d = detectAnomalies(km, { distance_m: row.distance_m })
  return { found: true, date: row.date, label_id: row.label_id, km_total: Math.round(row.distance_m / 100) / 10, ...d, saved: mdb.prepare('SELECT id, km_from, km_to, kind, purpose, note FROM session_context WHERE date=? AND km_from IS NOT NULL ORDER BY km_from').all(row.date) }
}
// everything the data knows about the day of a session, so the athlete can recall what happened and the coach can read the day properly: weather, body state, pain and
// injury history, plan, shoe, and the athlete's earlier notes. Read-only; every part is optional (a missing source is simply absent).
const r1 = (x) => (x == null || !isFinite(x) ? null : Math.round(x * 10) / 10), addDays = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10)
const INJURY_WORDS = /\b(pain|nyeri|sakit|thigh|paha|vmo|achilles|plantar|tibia|mtss|shin|calf|betis|knee|lutut|injur\w*|cedera|niggle)\b/i
export function sessionBackground({ date } = {}) {
  if (!DATE.test(date || '')) throw Object.assign(new Error('date must be YYYY-MM-DD'), { status: 400 })
  const out = { date }, safe = (fn, d = null) => { try { return fn() } catch { return d } }
  const s = safe(() => idb.prepare('SELECT label_id, distance_m, shoe_id FROM fit_session WHERE date=? ORDER BY distance_m DESC LIMIT 1').get(date))
  const w = s && safe(() => idb.prepare('SELECT indoor, temp_c, dew_c, rh, wind_ms, wbgt FROM run_weather WHERE label_id=?').get(s.label_id))
  out.weather = w ? { indoor: !!w.indoor, temp_c: r1(w.temp_c), humidity_pct: w.rh != null ? Math.round(w.rh) : null, dew_point_c: r1(w.dew_c), wind_ms: r1(w.wind_ms), wbgt: r1(w.wbgt), hot_for_running: w.wbgt != null ? w.wbgt >= 25.7 : null, source: 'Open-Meteo for the start place and hour' } : null
  const f = (d) => safe(() => idb.prepare('SELECT run_km, tl, sleep_min, sleep_hr, hrv_dev, rhr, feel, gi, pain_max, strength_lower FROM daily_feat WHERE date=?').get(d)), cur = f(date), prev = f(addDays(date, -1))
  const week = safe(() => idb.prepare('SELECT round(sum(COALESCE(run_km,0)),1) km, round(sum(COALESCE(tl,0))) tl FROM daily_feat WHERE date >= ? AND date <= ?').get(addDays(date, -6), date))
  out.body = cur || prev ? { that_morning: cur && { sleep_h: cur.sleep_min != null ? r1(cur.sleep_min / 60) : null, sleep_hr: r1(cur.sleep_hr), hrv_vs_baseline: r1(cur.hrv_dev), resting_hr: r1(cur.rhr), feel_1_5: cur.feel ?? null }, day_before: prev && { run_km: r1(prev.run_km), load: prev.tl != null ? Math.round(prev.tl) : null, lower_body_gym: !!prev.strength_lower }, last_7_days: week ? { run_km: week.km, load: week.tl } : null } : null
  out.pain_log = safe(() => idb.prepare('SELECT date, feel, pain, gi FROM daily_log WHERE date >= ? AND date <= ? ORDER BY date').all(addDays(date, -3), addDays(date, 3)).map((x) => { let p = null; try { p = JSON.parse(x.pain || 'null') } catch {} const sites = p && typeof p === 'object' ? Object.entries(p).filter(([, v]) => +v > 0).map(([k, v]) => `${k} ${v}/10`) : []; return { date: x.date, feel_1_5: x.feel ?? null, pain: sites.length ? sites.join(', ') : p ? 'none' : null, gi: x.gi ?? null } }), [])
  const tw = safe(() => idb.prepare('SELECT state FROM twin_state ORDER BY version DESC LIMIT 1').get()), inj = tw && safe(() => JSON.parse(tw.state).injury)
  out.injury = { tracked: inj ? { last_pain_date: inj.sites?.all?.last_pain_date ?? null, pain_events_90d: inj.sites?.all?.events_90d ?? null, days_logged_90d: inj.log_days_90d ?? null } : null,
    notes: safe(() => mdb.prepare("SELECT id, tier, evidence_tag tag, substr(title,1,120) title, valid_from FROM memory WHERE status='active' AND tier IN ('semantic','episodic') AND COALESCE(source,'') <> 'fit' AND (valid_from IS NULL OR valid_from <= ?) ORDER BY COALESCE(valid_from,'') DESC LIMIT 400").all(addDays(date, 7)).filter((m) => INJURY_WORDS.test(m.title)).slice(0, 5), []) }
  out.plan = safe(() => { const d = PLAN.find((x) => x.date === date); return d ? { kind: d.kind, label: d.label || null, km: d.km ?? null } : null })
  out.shoe = s?.shoe_id ? safe(() => app.prepare('SELECT name FROM gear WHERE id=?').get(String(s.shoe_id))?.name ?? null) : null
  out.saved = safe(() => mdb.prepare('SELECT * FROM session_context WHERE date=? ORDER BY km_from IS NOT NULL, km_from, id').all(date), [])
  out.previous_context = safe(() => mdb.prepare('SELECT date, purpose, note, counts_for_fitness FROM session_context WHERE date < ? AND km_from IS NULL ORDER BY date DESC LIMIT 5').all(date).map((x) => ({ date: x.date, purpose: x.purpose, note: x.note.slice(0, 160), counts_for_fitness: !!x.counts_for_fitness })), [])
  return out
}
void idb
