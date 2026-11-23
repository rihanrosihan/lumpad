// Recall layer for the coach's retrieval (free question and every other intent).
// 1) expandTerms: bilingual (EN/ID) synonym expansion, so "kontak tanah" also finds "GCT / ground contact".
// 2) tfidfRank: a local semantic ranker (stemmed unigrams + bigrams, cosine). No embedding model, no outside call, nothing leaves the server.
// 3) recallBlock: the other databases the coach could not see before (journal, plan, daily features, earlier coach answers), compact and bounded.
// Everything here is read-only. Pure helpers are exported for tests; DB helpers take their handles as arguments.

const STOPWORDS = new Set(('the and for with that this from have has had was were are what why how when which would could should about after before into over under than then them they their there '
  + 'yang dan untuk dengan dari pada ini itu adalah apa kenapa bagaimana kapan saya aku nya ada atau juga sudah akan bisa lebih sebelum setelah karena dalam oleh').split(' '))

// groups of words that mean the same thing for this athlete; a hit on any member pulls in the others
export const SYNONYMS = [
  ['gct', 'ground contact', 'kontak', 'contact time'], ['hrv', 'variability', 'reduced'], ['tidur', 'sleep', 'sleeping'], ['panas', 'heat', 'wbgt', 'humid', 'hot', 'humidity'],
  ['sepatu', 'shoe', 'shoes', 'foam', 'plated'], ['nyeri', 'pain', 'sakit', 'niggle', 'ache', 'sore'], ['lutut', 'knee', 'vmo'], ['betis', 'calf', 'achilles', 'tendon'], ['tulang', 'tibia', 'mtss', 'shin'],
  ['jalan', 'walk', 'walking', 'run-walk', 'runshare'], ['maraton', 'marathon', 'fm'], ['setengah', 'half', 'hm'], ['makan', 'fuel', 'fueling', 'fuelling', 'nutrition', 'gel', 'carb', 'breakfast'],
  ['pemulihan', 'recovery', 'readiness', 'recover'], ['beban', 'load', 'ctl', 'atl', 'tsb', 'volume', 'mileage'], ['gym', 'strength', 'squat', 'leg day', 'lower'], ['ambang', 'threshold', 'tempo', 'interval'],
  ['lelah', 'fatigue', 'fade', 'drift', 'decoupling', 'durability'], ['perut', 'gi', 'stomach', 'gut', 'nausea'], ['lomba', 'race', 'event'], ['langkah', 'stride', 'cadence', 'cad'],
  ['back to back', 'back-to-back', 'b2b', 'consecutive', 'beruntun', 'berturut', 'brick', 'sehari setelah', 'day after'], ['survive', 'bertahan', 'finish', 'selesai', 'cut-off', 'cutoff', 'cot', 'cop', 'run-walk'],
  ['efisiensi', 'efficiency', 'economy', 'ef'], ['istirahat', 'rest', 'taper', 'deload'], ['target', 'goal', 'sub-4', 'sub4'],
]
const SYN_INDEX = (() => { const m = new Map(); SYNONYMS.forEach((g, i) => g.forEach((w) => { const k = w.toLowerCase(); (m.get(k) || m.set(k, []).get(k)).push(i) })); return m })()

const TOO_GENERIC = new Set(['back', 'day', 'after', 'time', 'run', 'race', 'sehari', 'setelah'])
const wordsOf = (text) => String(text || '').toLowerCase().match(/[\p{L}\p{N}]+(?:[_.-][\p{L}\p{N}]+)*/gu) || []
export const stem = (w) => { let s = w; if (s.length > 5) s = s.replace(/(ingly|edly|ing|ed|es|nya|kan|lah|an|s)$/, ''); else if (s.length >= 4 && /[^s]s$/.test(s)) s = s.slice(0, -1); return s.length >= 3 ? s : w }

// Words to add to the query (not in it already). Multi-word members are matched as phrases and contribute their single words.
export function expandTerms(question, topics = []) {
  const q = String(question || '').toLowerCase(), have = new Set(wordsOf(q)), out = new Set(), hit = new Set()
  for (const [key, groups] of SYN_INDEX) {
    const re = key.includes(' ') || key.includes('-') ? q.includes(key) : have.has(key)
    if (re) groups.forEach((g) => hit.add(g))
  }
  for (const t of topics) { // decomposed topic ids (gct_fade, sleep_min, ...) also hit their groups
    for (const w of String(t).toLowerCase().split('_')) for (const g of SYN_INDEX.get(w) || []) hit.add(g)
  }
  for (const g of hit) for (const m of SYNONYMS[g]) for (const w of wordsOf(m)) if (w.length >= 3 && !have.has(w) && !STOPWORDS.has(w) && !TOO_GENERIC.has(w)) out.add(w)
  return [...out].slice(0, 16)
}

// ---- TF-IDF cosine
const termsOf = (text) => {
  const w = wordsOf(text).filter((x) => x.length >= 2 && !STOPWORDS.has(x)).map(stem), t = w.slice()
  for (let i = 0; i + 1 < w.length; i++) t.push(w[i] + '_' + w[i + 1])
  return t
}
export function buildIndex(rows) {
  const df = new Map(), docs = rows.map((r) => { const tf = new Map(); for (const t of termsOf(`${r.title} ${r.title} ${r.body}`)) tf.set(t, (tf.get(t) || 0) + 1); for (const t of tf.keys()) df.set(t, (df.get(t) || 0) + 1); return { id: r.id, tf } }), N = Math.max(1, docs.length)
  const idf = (t) => Math.log(1 + N / (1 + (df.get(t) || 0)))
  for (const d of docs) { let n = 0; for (const [t, c] of d.tf) { const w = (1 + Math.log(c)) * idf(t); d.tf.set(t, w); n += w * w } d.norm = Math.sqrt(n) || 1 }
  return { docs, idf, N }
}
// ranked [{id, score}] best first; items below minScore are dropped (a near-zero cosine is noise, not a match)
export function tfidfRank(index, query, { limit = 30, minScore = 0.05 } = {}) {
  const qtf = new Map(); for (const t of termsOf(query)) qtf.set(t, (qtf.get(t) || 0) + 1)
  let qn = 0; const q = new Map(); for (const [t, c] of qtf) { const w = (1 + Math.log(c)) * index.idf(t); q.set(t, w); qn += w * w }
  qn = Math.sqrt(qn); if (!qn) return []
  const out = []
  for (const d of index.docs) { let dot = 0; for (const [t, w] of q) { const x = d.tf.get(t); if (x) dot += w * x } const s = dot / (qn * d.norm); if (s >= minScore) out.push({ id: d.id, score: Math.round(s * 1000) / 1000 }) }
  return out.sort((a, b) => b.score - a.score || a.id - b.id).slice(0, limit)
}
let cache = { key: '', index: null }
// the index is rebuilt only when memory changes (row count + newest update)
export function memoryIndex(mdb) {
  const k = mdb.prepare("SELECT count(*) n, max(updated_at) u, max(id) i FROM memory WHERE status='active'").get(), key = `${k.n}|${k.u}|${k.i}`
  if (cache.key !== key) cache = { key, index: buildIndex(mdb.prepare("SELECT id, title, body FROM memory WHERE status='active'").all()) }
  return cache.index
}

// ---- exact counts. Retrieval only samples a few sessions, so "how many runs at X" must be COUNTED in SQL, never estimated from a sample.
// Places are matched on the activity name / location TEXT only: the stored GPS start is a 0.1 degree cell (~11 km), which cannot tell TMII from home.
export const PLACES = { tmii: ['tmii', 'taman mini'], gbk: ['gbk', 'gelora', 'senayan'], sentul: ['sentul'], bodimax: ['bodimax'], bekasi: ['bekasi'], monas: ['monas'], 'indoor / treadmill': ['treadmill', 'indoor'] }
export const COUNT_Q = /\b(berapa|how many|how often|how much|count|jumlah|total|sudah berapa|ada berapa|seberapa sering)\b/i
export function placesIn(question) { const q = String(question || '').toLowerCase(); return Object.entries(PLACES).filter(([, al]) => al.some((a) => new RegExp(`\\b${a}\\b`).test(q))).map(([k]) => k) }
// app = the activities database. filters = decomposed query filters (from, to, dist_km). Runs only, one source of truth per activity (COROS/Garmin, never the Strava twin).
export function countBlock(app, question, f = {}, races = null) {
  if (!COUNT_Q.test(String(question || ''))) return []
  return safe(() => {
    const where = ["sport = 'Run'", "source IN ('coros','garmin')"], prm = []
    if (f.from) { where.push('date >= ?'); prm.push(f.from) }; if (f.to) { where.push('date <= ?'); prm.push(f.to) }
    if (f.dist_km) { where.push('distance_m BETWEEN ? AND ?'); prm.push(f.dist_km[0] * 1000, f.dist_km[1] * 1000) }
    const one = (extra, extraPrm) => { const w = where.concat(extra).join(' AND '), a = [...prm, ...extraPrm]
      const t = app.prepare(`SELECT count(*) n, round(sum(distance_m)/1000.0,1) km, min(date) first, max(date) last FROM activities WHERE ${w}`).get(...a)
      const yr = app.prepare(`SELECT substr(date,1,4) y, count(*) n FROM activities WHERE ${w} GROUP BY y ORDER BY y`).all(...a)
      const dates = app.prepare(`SELECT date FROM activities WHERE ${w} ORDER BY date DESC LIMIT 8`).all(...a).map((r) => r.date)
      return { runs: t.n, km: t.km || 0, first: t.first, last: t.last, by_year: Object.fromEntries(yr.map((r) => [r.y, r.n])), latest_dates: dates } }
    const out = { question_type: 'count', window: { from: f.from || null, to: f.to || null, dist_km: f.dist_km || null }, all_runs_in_window: one([], []), places: {}, source: 'exact SQL count over activities (runs only; walks and other sports excluded)' }
    // the place tag is often only on the Strava twin of a COROS/Garmin run (same day, same distance within 3 %): that run counts too, once
    for (const k of placesIn(question)) { const al = PLACES[k], m = al.map(() => '(lower(%N) LIKE ? OR lower(%L) LIKE ?)').join(' OR '), own = m.replaceAll('%N', 'name').replaceAll('%L', 'location'), twin = m.replaceAll('%N', 's.name').replaceAll('%L', 's.location'), like = al.flatMap((a) => [`%${a}%`, `%${a}%`])
      out.places[k] = one([`((${own}) OR EXISTS (SELECT 1 FROM activities s WHERE s.source = 'strava' AND s.date = activities.date AND abs(s.distance_m - activities.distance_m) <= 0.03 * activities.distance_m AND (${twin})))`], [...like, ...like]) }
    // the athlete's own race record: counted here, not left to the model's arithmetic
    if (races && /\b(race|races|lomba|balap|event|start)\b/i.test(String(question))) { const R = races.filter((r) => (!f.from || r.date >= f.from) && (!f.to || r.date <= f.to)); out.races = { total: R.length, by_year: R.reduce((a, r) => ((a[r.date.slice(0, 4)] = (a[r.date.slice(0, 4)] || 0) + 1), a), {}), list: R.map((r) => `${r.date} ${r.name}`), source: 'the athlete record of races entered (DNFs count, excluded events listed in the knowledge base do not)' } }
    if (Object.keys(out.places).length) out.place_note = 'matched on activity name or location text only. The stored start coordinates are an ~11 km cell, so a run that started in the same area but is not named or tagged with the place cannot be counted; the true number may be higher.'
    return [out]
  })
}
// ---- exact rankings ("my fastest 10K ever", "longest run"). A recency sample cannot rank: every run is ranked in SQL / from the km splits.
export const RANK_Q = /\b(tercepat|paling cepat|fastest|best time|personal best|pb|pr|rekor|record|terpanjang|paling panjang|longest)\b/i
const hms = (s) => `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(Math.round(s % 60)).padStart(2, '0')}`
export function distanceOf(question) { const q = String(question || '').toLowerCase(); if (/half|\bhm\b|setengah/.test(q)) return 21.0975; if (/marathon|\bfm\b|maraton/.test(q)) return 42.195; const m = /\b(\d{1,2}(?:[.,]\d)?)\s?(?:k|km)\b/.exec(q); return m ? parseFloat(m[1].replace(',', '.')) : null }
export function rankBlock(app, idb, question, races = []) {
  if (!RANK_Q.test(String(question || ''))) return []
  return safe(() => {
    const D = distanceOf(question), base = "sport = 'Run' AND source IN ('coros','garmin')", row = (r, t) => ({ date: r.date, name: r.name, watch_km: Math.round(r.distance_m / 10) / 100, watch_time: hms(r.duration_s), ...(t ? { time_at_distance: hms(t), pace_s_km: Math.round(t / D) } : {}) })
    if (/\b(terpanjang|paling panjang|longest)\b/i.test(question) && !D) return [{ kind: 'longest', runs: app.prepare(`SELECT date, name, distance_m, duration_s FROM activities WHERE ${base} ORDER BY distance_m DESC LIMIT 6`).all().map((r) => row(r)), source: 'every run, ranked by distance' }]
    if (!D) return []
    const whole = app.prepare(`SELECT date, name, distance_m, duration_s FROM activities WHERE ${base} AND distance_m BETWEEN ? AND ? AND duration_s > 0`).all(D * 970, D * 1080).map((r) => ({ r, t: r.duration_s * D * 1000 / r.distance_m })).sort((a, b) => a.t - b.t).slice(0, 6).map(({ r, t }) => row(r, t))
    const out = { kind: 'fastest', distance_km: D, whole_runs: whole, source: `every run of ${Math.round(D * 0.97 * 10) / 10}–${Math.round(D * 1.08 * 10) / 10} km, ranked by time scaled to exactly ${D} km (watch distance usually reads a little long, so scaled time is a little faster than the clock)` }
    if (Number.isInteger(D) && D >= 3 && D <= 21) { // fastest D consecutive whole kilometres inside ANY longer run, from the km splits
      const best = []; for (const s of idb.prepare('SELECT date, distance_m, km FROM fit_session WHERE distance_m >= ?').all(D * 1000)) { let k; try { k = JSON.parse(s.km || '[]').filter((x) => x.pace > 0) } catch { continue } let top = null
        for (let i = 0; i + D <= k.length; i++) { let t = 0; for (let j = i; j < i + D; j++) t += k[j].pace; if (!top || t < top.t) top = { date: s.date, run_km: Math.round(s.distance_m / 100) / 10, from_km: k[i].km, time: hms(t), t } }
        if (top) best.push(top) }
      out.best_inside_runs = best.sort((a, b) => a.t - b.t).slice(0, 5).map(({ t, ...x }) => x); out.inside_note = `fastest ${D} consecutive kilometres within any run (not a race time unless the run was the race)`
    }
    const tag = D > 40 ? { test: (n) => /marathon|\bFM\b/i.test(n) && !/half|\bHM\b/i.test(n) } : D > 20 && D < 22 ? /half|\bHM\b/i : new RegExp(`\\b${Math.round(D)}\\s?K\\b`, 'i') // full vs half vs Nk
    out.official_races = races.filter((r) => tag.test(r.name)).map((r) => `${r.date} ${r.name}`)
    // PB is TWO numbers, never one: official (the race result) and watch (what the watch measured over the first D km). Course measurement, GPS, start line and chip vs gun make them differ.
    const sec = (t) => t.split(':').reduce((a, x) => a * 60 + +x, 0), offs = races.filter((r) => tag.test(r.name)).map((r) => { const m = /\b(\d{1,2}:\d{2}:\d{2})\b/.exec(r.name); return m ? { date: r.date, race: r.name.replace(/\s*[—-]\s*.*$/, ''), time: m[1], s: sec(m[1]) } : null }).filter(Boolean).sort((a, b) => a.s - b.s)
    const watch = []; if (Number.isInteger(D) && D >= 3 && D <= 21) for (const s of idb.prepare('SELECT date, distance_m, km FROM fit_session WHERE distance_m BETWEEN ? AND ?').all(D * 1000, D * 1080)) { let k; try { k = JSON.parse(s.km || '[]').filter((x) => x.pace > 0) } catch { continue } if (k.length >= D) watch.push({ date: s.date, run_km: Math.round(s.distance_m / 100) / 10, time_first_dkm: hms(k.slice(0, D).reduce((a, x) => a + x.pace, 0)), t: k.slice(0, D).reduce((a, x) => a + x.pace, 0) }) }
    watch.sort((a, b) => a.t - b.t)
    out.pb = { official: offs[0] ? { time: offs[0].time, date: offs[0].date, race: offs[0].race } : null, watch: watch[0] ? { time: watch[0].time_first_dkm, date: watch[0].date, run_km: watch[0].run_km, basis: `watch time over the first ${D} km of the run` } : null, watch_runner_up: watch.slice(1, 3).map(({ t, ...x }) => x),
      note: 'Report BOTH. Official is the race result; watch is what the watch measured. They differ because of course measurement, GPS, the start line and chip vs gun time. Neither replaces the other.' }
    return [out]
  })
}
// ---- precedents: "have I done this before?" is a data question. Back-to-back = two runs on consecutive days, one of them long (>= 15 km), the other >= 8 km.
export const B2B_Q = /\b(back[- ]to[- ]back|b2b|beruntun|berturut|consecutive|sehari setelah|keesokan hari|day after|two days in a row|dua hari berturut)\b/i
export function backToBack(idb, question) {
  if (!B2B_Q.test(String(question || ''))) return []
  return safe(() => {
    const rows = idb.prepare("SELECT a.date d1, round(a.distance_m/1000.0,1) km1, round(a.run_share,2) rs1, round(a.run_hr) hr1, a.onset_km o1, b.date d2, round(b.distance_m/1000.0,1) km2, round(b.run_share,2) rs2, round(b.run_hr) hr2, b.onset_km o2 FROM fit_session a JOIN fit_session b ON b.date = date(a.date, '+1 day') WHERE a.distance_m >= 8000 AND b.distance_m >= 8000 AND (a.distance_m >= 15000 OR b.distance_m >= 15000) ORDER BY a.date DESC LIMIT 6").all()
    return rows.length ? [{ kind: 'consecutive_day_efforts', pairs: rows.map((r) => ({ day1: { date: r.d1, km: r.km1, run_share: r.rs1, run_hr: r.hr1, fade_onset_km: r.o1 }, day2: { date: r.d2, km: r.km2, run_share: r.rs2, run_hr: r.hr2, fade_onset_km: r.o2 } })), source: 'every pair of runs on consecutive days in the analysed sessions; races are not flagged here, check the dates against the race record' }] : [{ kind: 'consecutive_day_efforts', pairs: [], source: 'no pair of consecutive-day runs (one >= 15 km, the other >= 8 km) in the analysed sessions' }]
  })
}
// the recall-block form: the athlete's own words first, with the rule for reading them
const CTX_DATE = /^\d{4}-\d{2}-\d{2}$/
export function athleteContextBlock(db, { dates = [], from, to, today }) {
  try {
    const ds = [...new Set(dates)].filter((d) => CTX_DATE.test(d)), lo = from || new Date(Date.parse(today + 'T12:00:00Z') - 14 * 864e5).toISOString().slice(0, 10)
    const rows = db.prepare(`SELECT date, purpose, note, intentional_walking iw, counts_for_fitness cf, run_km, walk_km, km_from, km_to, kind FROM session_context WHERE (date >= ? AND date <= ?) ${ds.length ? `OR date IN (${ds.map(() => '?').join(',')})` : ''} ORDER BY date DESC, km_from IS NOT NULL, km_from LIMIT 30`).all(lo, to || today, ...ds)
    if (!rows.length) return []
    return [{ stated_by: 'the athlete (a fact, not an inference)', how_to_read: 'These explain the data. Walking, stops and low run share in these sessions are NOT fatigue, poor durability or a pacing failure when the athlete says they were chosen; never use them as evidence of endurance limits, and never contradict them. Where counts_for_fitness is false, leave the session out of durability and fade conclusions.',
      sessions: rows.map((r) => ({ date: r.date, ...(r.km_from != null ? { km: r.km_to > r.km_from ? `${r.km_from}–${r.km_to}` : `${r.km_from}`, found: r.kind || undefined } : {}), purpose: r.purpose, said: r.note, walking_by_choice: !!r.iw, counts_for_fitness: !!r.cf, run_km: r.run_km ?? undefined, walk_km: r.walk_km ?? undefined })) }]
  } catch { return [] }
}
// ---- goal gap: "can I get sub-4?" must be answered with the actual numbers, not "possible". Everything comes from the twin projection and the plan target.
export const GOAL_Q = /\bsub[- ]?4\b|\b4:00\b|\b(peluang|chance|chances|probability|odds|kemungkinan)\b.*\b(sub|target|jrf|marathon|fm|goal)\b|\b(mencapai|capai|reach|achieve|hit)\b.*\b(sub|target|goal)\b/i
export function goalGapBlock(question, state, target) {
  const p = state?.projection; if (!GOAL_Q.test(String(question || '')) || !p?.scenarios?.length || !target) return []
  const v0 = p.vdot0 ?? target.baseline
  return [{ goal: target.goal, required: { marathon_pace_per_km: target.mp, vdot_needed: target.vdotNeeded, vdot_now: v0, vdot_gap: Math.round((target.vdotNeeded - v0) * 10) / 10, months_to_race: p.months_to_race, required_gain_per_month_by_marathon_ratio: p.required_gain_per_month },
    scenarios: p.scenarios.map((x) => ({ name: x.name, vdot_gain_per_month: x.gain_per_month, marathon_ratio_p10_p50_p90: x.ratio, median_finish: x.fm_time_p10_p50_p90?.[1] ? hms(x.fm_time_p10_p50_p90[1]) : null, chance_of_sub4_percent: Math.round(x.p_sub4 * 1000) / 10 })),
    how_to_read: 'State the three chances and the required pace and VDOT gap plainly, labelled as model scenarios, not predictions. Lead with the scenario built on the athlete\'s OWN observed rate of improvement; the highest chance only holds if the plan\'s improvement rate and a good marathon ratio both come true. Do not call the goal "possible" without these numbers.', label: p.label }]
}
// ---- other databases, compact. Each returns [] when it has nothing; none throws (a missing table must not break a coach run).
const safe = (fn) => { try { return fn() } catch { return [] } }
const clip = (t, n) => { const s = String(t || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s }
const inRange = (d, from, to) => d && (!from || d >= from) && (!to || d <= to)

// the athlete's own daily log (feel, pain, GI, strength, fuel) inside the asked window, or the last 10 days when the question is about how they felt
export function journalRows(idb, { from, to, today, wantsRecent }) {
  return safe(() => {
    const lo = from || (wantsRecent ? new Date(Date.parse(today + 'T12:00:00Z') - 10 * 864e5).toISOString().slice(0, 10) : null); if (!lo) return []
    return idb.prepare('SELECT date, feel, pain, gi, strength, fuel FROM daily_log WHERE date >= ? AND date <= ? ORDER BY date DESC LIMIT 10').all(lo, to || today)
      .map((r) => ({ date: r.date, feel: r.feel ?? null, pain: clip(r.pain, 80) || null, gi: r.gi ?? null, strength: clip(r.strength, 60) || null, fuel: clip(r.fuel, 80) || null }))
  })
}
const spanDays = (from, to) => Math.round((Date.parse((to || from) + 'T12:00:00Z') - Date.parse(from + 'T12:00:00Z')) / 864e5) + 1
// daily measured features (load, sleep, HRV, RHR, WBGT, pain) for the asked window; at most 14 rows, newest first
export function dailyRows(idb, { from, to }) {
  if (!from || spanDays(from, to) > 14) return [] // long windows are summarised per week instead (weeklyRows)
  return safe(() => idb.prepare('SELECT date, run_km, tl, sleep_min, hrv_dev, rhr, wbgt, pain_max, strength_lower FROM daily_feat WHERE date >= ? AND date <= ? ORDER BY date DESC LIMIT 14').all(from, to || from)
    .map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'number' ? Math.round(v * 10) / 10 : v]).filter(([, v]) => v != null))))
}
// Monday-start weekly totals for windows longer than a week, reaching back one more window (max 12 weeks) so "this period vs the one before" can be answered from numbers
export function weeklyRows(idb, { from, to, today }) {
  if (!from) return []
  const end = to || today || from, span = spanDays(from, end); if (span < 7 || span > 120) return [] // a year-long window is a different question; weekly totals would only add noise
  const lo = new Date(Date.parse(from + 'T12:00:00Z') - Math.min(span, 84) * 864e5).toISOString().slice(0, 10)
  return safe(() => idb.prepare("SELECT date(date, '-' || ((CAST(strftime('%w', date) AS INTEGER) + 6) % 7) || ' days') AS week_start, round(sum(COALESCE(run_km,0)),1) AS run_km, count(CASE WHEN COALESCE(run_km,0) > 0 THEN 1 END) AS run_days, round(sum(COALESCE(tl,0))) AS load, sum(COALESCE(strength,0)) AS gym_days, round(avg(sleep_min)) AS avg_sleep_min, round(avg(hrv_dev),1) AS avg_hrv_dev FROM daily_feat WHERE date >= ? AND date <= ? GROUP BY week_start ORDER BY week_start DESC LIMIT 12").all(lo, end)
    .filter((r) => r.week_start >= lo).map((r) => ({ ...r, partial: r.week_start > new Date(Date.parse(end + 'T12:00:00Z') - 6 * 864e5).toISOString().slice(0, 10) ? true : undefined })).map((r) => Object.fromEntries(Object.entries(r).filter(([, v]) => v != null))))
}
// the season plan inside the asked window next to what was done (km) that day
export function planRows(plan, daily, { from, to }) {
  if (!from) return []
  const done = new Map((daily || []).map((d) => [d.date, d.run_km]))
  return plan.filter((d) => inRange(d.date, from, to)).slice(-10).map((d) => ({ date: d.date, kind: d.kind, label: d.label || null, km: d.km ?? null, done_km: done.get(d.date) ?? null }))
}
// earlier coach answers on the same subject (ok runs only): summaries, so the coach stays consistent with what it already told the athlete
// an earlier non-answer must never be recalled as if it were knowledge: the model copies it ("belum bisa dihitung" was repeated back three times)
const REFUSAL = /\b(belum bisa|nggak bisa|tidak bisa|gak bisa|belum ditarik|belum pernah ditarik|not yet extracted|cannot|can't|unable to|tidak ada data|nggak ada data)\b/i
export function priorAnswers(mdb, query, { limit = 3, excludeIntent = null, excludeQuestion = null } = {}) {
  return safe(() => {
    const rows = mdb.prepare("SELECT id, created_at, intent, question, parsed FROM coach_run WHERE ok=1 AND parsed IS NOT NULL ORDER BY id DESC LIMIT 120").all()
      .map((r) => { let p; try { p = JSON.parse(r.parsed) } catch { return null } if (excludeQuestion != null && r.intent === 'question' && String(r.question || '').trim() === excludeQuestion) return null // the identical question is served by the saved-run cache; counting it here would change the request hash after every run
      return p?.summary && !p.safety_referral && r.intent !== 'daily_brief' && !REFUSAL.test(p.summary) ? { id: r.id, title: `${r.intent} ${r.question || ''}`, body: p.summary, date: String(r.created_at).slice(0, 10), intent: r.intent } : null }).filter(Boolean)
    if (!rows.length) return []
    const idx = buildIndex(rows.map((r) => ({ id: r.id, title: r.title, body: r.body }))), by = new Map(rows.map((r) => [r.id, r]))
    return tfidfRank(idx, query, { limit, minScore: 0.12 }).map((h) => by.get(h.id)).filter((r) => r && r.intent !== excludeIntent).map((r) => ({ run: r.id, date: r.date, intent: r.intent, summary: clip(r.body, 300) }))
  })
}
// the whole recall block, with the knobs the caller needs for the token loop
export function recallBlock({ idb, mdb, app, races, goal, plan, query, question = '', filters = {}, from, to, today, intent, topics = [], ctxDates = [] }) {
  const wantsRecent = /\b(feel|felt|pain|nyeri|sakit|gi|stomach|fuel|ate|makan|perut)\b/i.test(query) || topics.some((t) => /pain|feel|gi/.test(t))
  const daily = dailyRows(idb, { from, to })
  return { athlete_context: athleteContextBlock(mdb, { dates: ctxDates, from, to, today }), counts: app ? countBlock(app, question, filters, races) : [], rankings: app ? rankBlock(app, idb, question, races) : [], precedents: backToBack(idb, question), goal_gap: goal ? goalGapBlock(question, goal.state, goal.target) : [], weekly: weeklyRows(idb, { from, to, today }), journal: journalRows(idb, { from, to, today, wantsRecent }), daily, plan: planRows(plan || [], daily, { from, to }), prior_answers: intent === 'question' ? priorAnswers(mdb, query, { excludeQuestion: String(question || '').trim() }) : [] } // scheduled intents keep a stable request hash (saved-run cache)
}
export const recallCount = (r) => Object.values(r || {}).reduce((n, v) => n + (Array.isArray(v) ? v.length : 0), 0)
