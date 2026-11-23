// Time frame of a coach task: the coach must reason from the moment of the thing it analyses, not from "now".
//  live      daily brief, weekly review, questions, race plan: as of today (unchanged)
//  same_day  a session review of a run done today: judge the REST of today and tomorrow (unchanged behaviour)
//  recent    the session was 1–2 days ago: what it means NOW (recovery since, what is still pending), never "the rest of that day"
//  past      3+ days ago: retrospective. What it meant then, what happened since, lessons for next time. No day-specific orders, no forecast, no "tomorrow".
// Pure helpers only (no database): context.js supplies the rows.
const DAY = 864e5
export const diffDays = (a, b) => Math.round((Date.parse(a + 'T12:00:00Z') - Date.parse(b + 'T12:00:00Z')) / DAY)

export function timeFrame({ intent, activityDate, today }) {
  if (!['session_review', 'race_postmortem'].includes(intent) || !activityDate) return { mode: 'live', today }
  const n = diffDays(today, activityDate)
  if (n <= 0) return { mode: 'same_day', session_date: activityDate, today, days_ago: 0 }
  if (n <= 2) return { mode: 'recent', session_date: activityDate, today, days_ago: n }
  // past: today's date is deliberately left out so the prompt (and its "up to date" fingerprint) does not change every day; only new data does
  return { mode: 'past', session_date: activityDate, days_ago: '3+' }
}

// the sentence that anchors the model's language in time; empty for live / same_day (the existing prompt already covers them)
export function frameNote(tf) {
  if (tf.mode === 'recent') return `TIME FRAME: this session was ${tf.days_ago} day${tf.days_ago > 1 ? 's' : ''} ago (${tf.session_date}); today is ${tf.today}. Review it from today's point of view: what it did to the athlete, what has happened since (see session_day.since_then) and what to do NOW. Never write "today", "tomorrow" or "the rest of today" about ${tf.session_date}.`
  if (tf.mode === 'past') return `TIME FRAME: RETROSPECTIVE review of a session on ${tf.session_date}, 3 or more days ago. Judge it as of that date: how it fitted the training load and recovery of that time (session_day), what happened afterwards (session_day.since_then) and the lesson for the next time a similar situation comes up. Do NOT give orders for a specific day, do not mention a forecast, "tomorrow", "today" or "the rest of today"; the Next steps section is about habits and rules for next time ("from now on…", "before your next long run…"). Facts about the athlete's state today (twin) are not the state on ${tf.session_date}.`
  return ''
}

// Facts about the run computed from the km rows (not the model's impression): walking, heart-rate trend and pace trend. The coach must not claim more than these allow.
export function sessionFacts(km, { run_share = null, avg_hr = null, distance_m = null } = {}) {
  if (!Array.isArray(km) || km.length < 3) return undefined
  const avg = (a) => { a = a.filter((x) => x != null && Number.isFinite(x)); return a.length ? a.reduce((s, x) => s + x, 0) / a.length : null }, r0 = (x) => (x == null ? null : Math.round(x))
  const first = km.slice(0, 3), last = km.slice(-3), n = km.length, walk = (k) => (k.runShare == null ? null : 1 - k.runShare)
  const hrF = avg(first.map((k) => k.hr)), hrL = avg(last.map((k) => k.hr)), pF = avg(first.map((k) => k.pace)), pL = avg(last.map((k) => k.pace))
  const walkFirst5 = avg(km.slice(0, 5).map(walk)), walkLast5 = avg(km.slice(-5).map(walk)), firstWalkKm = km.find((k) => k.runShare != null && k.runShare < 0.8)?.km ?? null
  const mmss = (s) => (s == null ? null : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`)
  const trend = hrF != null && hrL != null ? (hrL - hrF >= 8 ? 'rose steadily late' : hrL - hrF <= -5 ? 'fell' : 'flat') : null
  const paceTrend = pF != null && pL != null ? (pL < pF * 0.97 ? 'last km faster than first' : pL > pF * 1.03 ? 'last km slower than first' : 'last km about the same pace as the first') : null
  return { note: 'computed from the kilometre rows; use these for any statement about walking, heart-rate trend or pace trend', km_count: n, distance_km: distance_m ? Math.round(distance_m / 100) / 10 : null,
    walking_share_pct: run_share != null ? Math.round((1 - run_share) * 100) : null, walking_first_5km_pct: walkFirst5 != null ? Math.round(walkFirst5 * 100) : null, walking_last_5km_pct: walkLast5 != null ? Math.round(walkLast5 * 100) : null, first_km_with_walking: firstWalkKm,
    hr_first_3km: r0(hrF), hr_last_3km: r0(hrL), hr_average: r0(avg_hr), hr_change_bpm: hrF != null && hrL != null ? r0(hrL - hrF) : null, hr_trend: trend,
    pace_first_3km: mmss(pF), pace_last_3km: mmss(pL), pace_trend: paceTrend }
}

// CTL/ATL (τ 42 / 7 days, same formula as the twin) from daily rows [{date, tl}] up to and including `date`: the form the athlete carried out of that day
export function loadAfter(daily, date) {
  let ctl = 0, atl = 0, n = 0
  for (const d of [...daily].sort((a, b) => a.date.localeCompare(b.date))) { if (d.date > date) break; ctl += ((d.tl || 0) - ctl) / 42; atl += ((d.tl || 0) - atl) / 7; n++ }
  return n ? { ctl: Math.round(ctl), atl: Math.round(atl), tsb_after: Math.round(ctl - atl), days_of_history: n } : null
}

// what happened between the session and today (or the next `maxDays`): compact, newest last; races/long runs are kept even when the list is long
export function sinceThen(acts, from, { max = 8 } = {}) {
  const rows = acts.filter((a) => a.date > from).sort((a, b) => a.date.localeCompare(b.date) || (a.start_ts || 0) - (b.start_ts || 0))
  const km = (a) => (a.distance_m ? Math.round(a.distance_m / 100) / 10 : null)
  const keep = rows.length <= max ? rows : [...rows.filter((a) => (a.distance_m || 0) >= 15000), ...rows.slice(0, max)].filter((a, i, arr) => arr.indexOf(a) === i).sort((a, b) => a.date.localeCompare(b.date)).slice(0, max)
  return { n_activities: rows.length, run_km: Math.round(rows.filter((a) => a.sport === 'Run').reduce((s, a) => s + (a.distance_m || 0), 0) / 100) / 10,
    first_days: keep.map((a) => ({ date: a.date, sport: a.sport, km: km(a), minutes: a.duration_s ? Math.round(a.duration_s / 60) : null, avg_hr: a.avg_hr ?? null })), truncated: rows.length > keep.length }
}
