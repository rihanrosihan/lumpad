// The runner's watch list: the few metrics that decide or warn about today, ranked, from the digital twin (the same numbers the AI coach sees).
// The CALL comes only from the athlete's locked rules, the readiness gate and pain; other metrics can warn but never change it on their own.
// Pure: twin state (schema twin/1) + today's check-in → { call, items }. Thresholds come from the locked rules in server/intel/memory.js.
const SLEEP_HR_MAX = 67      // locked rule: previous night's sleep HR above 67 bpm = no hard running (validated)
const PAIN_EVENT = 2         // locked rule: pain ≥ 2/10 = durability event
const PAIN_STOP = 4          // red-flag rule: severe pain ≥ 4/10 = stop, see a clinician
const KM_GUARD = 10          // locked rule: weekly running km ≤ +10 % vs the previous 4-week average
const RANK = { alert: 0, watch: 1, ok: 2, info: 3 }
const sgn = (n) => (n > 0 ? '+' : '') + n

export function painToday(checkin) {
  const c = checkin || {}, v = c.painSites && Object.keys(c.painSites).length ? Object.values(c.painSites) : c.pain !== '' && c.pain != null ? [Number(c.pain)] : []
  const n = v.filter(Number.isFinite); return n.length ? Math.max(...n) : null
}

export function watchList(twin, { checkin = null, sleepNeedMin = 480, today = [], date = null } = {}) {
  if (!twin) return { call: null, items: [] }
  const day = (twin.recent_days || []).at(-1) || {}, items = [], reasons = []
  const add = (it) => items.push(it)

  // 1) sleep HR — locked, validated rule
  if (day.sleep_hr != null) {
    const v = day.sleep_hr, st = v > SLEEP_HR_MAX ? 'alert' : v >= SLEEP_HR_MAX - 2 ? 'watch' : 'ok'
    add({ id: 'sleep_hr', label: 'Sleep heart rate', value: v, unit: 'bpm', ref: `rule: ≤ ${SLEEP_HR_MAX}`, status: st, rule: true,
      why: st === 'alert' ? 'Above your validated limit: no hard running today.' : st === 'watch' ? 'Close to your limit of 67.' : 'Below your limit.' })
    if (st === 'alert') reasons.push({ level: 'easy', why: `Sleep HR ${v} bpm > ${SLEEP_HR_MAX} (validated rule)` })
  }
  // 2) HRV — locked rule (status Reduced + quality = downgrade)
  if (day.hrv != null || day.hrv_status) {
    const reduced = /reduc|low|below/i.test(day.hrv_status || ''), pct = day.hrv != null && day.hrv_baseline ? Math.round(((day.hrv - day.hrv_baseline) / day.hrv_baseline) * 100) : null
    const st = reduced ? 'alert' : pct != null && pct <= -10 ? 'watch' : 'ok'
    add({ id: 'hrv', label: 'Overnight HRV', value: day.hrv, unit: 'ms', ref: pct != null ? `${sgn(pct)} % vs baseline ${day.hrv_baseline}` : day.hrv_status || '', status: st, rule: true,
      why: reduced ? 'Status reduced: downgrade a quality or long session.' : st === 'watch' ? 'Below baseline, status still normal.' : `Status ${day.hrv_status || 'normal'}.` })
    if (reduced) reasons.push({ level: 'easy', why: `HRV status ${day.hrv_status} (rule: downgrade quality)` })
  }
  // 3) pain — check-in today, else the twin's injury state
  const pToday = painToday(checkin), sites = Object.values(twin.injury?.sites || {}), recent = sites.filter((s) => s.pain_free_days != null && s.pain_free_days <= 2).map((s) => s.last_pain)
  const p = pToday ?? (recent.length ? Math.max(...recent) : null)
  if (p != null) {
    const st = p >= PAIN_STOP ? 'alert' : p >= PAIN_EVENT ? 'alert' : p > 0 ? 'watch' : 'ok'
    add({ id: 'pain', label: 'Pain', value: p, unit: '/10', ref: `rule: < ${PAIN_EVENT}`, status: st, rule: true,
      why: p >= PAIN_STOP ? 'Severe pain: stop and see a clinician.' : p >= PAIN_EVENT ? 'Durability event: shorten or stop; no progression for 7 days.' : p > 0 ? 'Mild: keep it easy and log it after the run.' : 'Pain-free.' })
    if (p >= PAIN_STOP) reasons.push({ level: 'rest', why: `Pain ${p}/10 (red-flag rule)` })
    else if (p >= PAIN_EVENT) reasons.push({ level: 'easy', why: `Pain ${p}/10 ≥ ${PAIN_EVENT} (durability rule)` })
  } else add({ id: 'pain', label: 'Pain', value: null, unit: '', ref: 'no check-in', status: 'watch', rule: true, why: 'Not logged today: do the check-in so the pain rule can work.' })
  // 4) readiness gate (the app's composite score)
  const rd = twin.readiness || {}
  if (rd.gate === 'red') reasons.push({ level: 'easy', why: rd.caps?.[0] ? `Readiness capped: ${rd.caps[0]}` : `Readiness ${rd.score} (red)` })
  // 5) easy-run discipline — the most common fixable mistake
  const it = twin.intensity || {}
  if (it.easy_runs > 0) {
    const share = Math.round((it.easy_runs_above_z2 / it.easy_runs) * 100), st = share >= 50 ? 'alert' : share >= 25 ? 'watch' : 'ok'
    add({ id: 'easy_hr', label: 'Easy runs above cap', value: `${it.easy_runs_above_z2}/${it.easy_runs}`, unit: '', ref: `cap ${it.z2_ceiling} bpm · runs ≤ 15 km, 28 d`, status: st,
      why: st === 'ok' ? 'Easy runs stayed easy.' : `Runs ≤ 15 km above the ${it.z2_ceiling} bpm ceiling (outside the plan this also counts tests and probes): slow down or walk to stay under it.` })
  }
  // 6) aerobic marker — HR at 8:00/km on STEADY easy runs only (3–15 km, ≥ 90 % running: twin.baselines.d30). twin.aerobic.hr_at_800 mixes in races and
  //    run-walk sessions (e.g. a marathon in the heat), which is effort and heat, not aerobic fitness, so it is not used here.
  //    From the post-G3 twin on, twin.aerobic is steady-only (steady_only: true) and carries its monthly baseline: use it directly.
  const A = twin.aerobic?.hr_at_800?.steady_only ? twin.aerobic.hr_at_800 : null, seed = 143.1, seedSd = 5.0, d30 = A ? { n: A.n, hr_at_800: A.value } : twin.baselines?.d30
  if (d30) {
    const v = d30.n ? d30.hr_at_800 : null, z = A ? A.z : v != null ? Math.round(((v - seed) / seedSd) * 10) / 10 : null
    const st = v == null ? 'watch' : z >= 2 ? 'alert' : z >= 1 ? 'watch' : 'ok'
    add({ id: 'hr800', label: 'HR at 8:00/km (steady runs)', value: v, unit: v != null ? 'bpm' : '', ref: `baseline ${A ? A.baseline.split(' (')[0] : `${seed} ± ${seedSd}`} · n=${d30.n ?? 0}`, status: st,
      why: v == null ? 'No steady easy run (3–15 km, mostly running) in 30 days, so aerobic fitness cannot be read. Do one steady easy run under the Z2 cap.'
        : st === 'alert' ? `Well above baseline (${sgn(z)} SD): fatigue, heat or illness. Keep running easy until it comes back.${d30.n < 3 ? ' Few runs: treat as a warning.' : ''}` : st === 'watch' ? 'Slightly above baseline.' : 'At or below baseline: aerobic fitness on track.' })
  }
  // 7) load guard — locked rule (+10 %), plus form
  const L = twin.load || {}
  if (L.km_vs_4wk_avg_pct != null) {
    const v = L.km_vs_4wk_avg_pct, st = v > KM_GUARD ? 'alert' : v > KM_GUARD / 2 ? 'watch' : 'ok'
    add({ id: 'km_guard', label: 'Weekly km vs 4 weeks', value: `${sgn(v)} %`, unit: '', ref: `rule: ≤ +${KM_GUARD} %`, status: st, rule: true,
      why: st === 'alert' ? 'Over the load guard: hold or reduce volume this week.' : st === 'watch' ? 'Close to the +10 % guard.' : 'Within the guard.' })
  }
  // load ratio (acute vs chronic, EWMA): replaces the old "High load" banner in the Home header
  if (L.acwr_ewma != null && L.acwr_ewma > 1.3) add({ id: 'acwr', label: 'Load ratio (ACWR)', value: L.acwr_ewma, unit: '', ref: 'aim 0.8–1.3', status: L.acwr_ewma > 1.5 ? 'alert' : 'watch',
    why: 'Recent load is high for your fitness: keep hard sessions out until it comes back under 1.3.' })
  if (L.tsb != null && L.tsb < -30) add({ id: 'tsb', label: 'Form (TSB)', value: L.tsb, unit: '', ref: 'fatigued below −30', status: 'alert', why: 'Deep fatigue: no hard sessions until it rises.' })
  // 8) sleep duration
  if (day.sleep_min_asleep != null) {
    const v = day.sleep_min_asleep, st = v < sleepNeedMin - 90 ? 'alert' : v < sleepNeedMin - 30 ? 'watch' : 'ok'
    add({ id: 'sleep', label: 'Sleep', value: `${Math.floor(v / 60)}h ${String(v % 60).padStart(2, '0')}`, unit: '', ref: `need ${Math.round(sleepNeedMin / 60)} h`, status: st, why: st === 'ok' ? 'Enough sleep.' : 'Short night: recovery is slower; protect tonight.' })
  }
  // 9) durability — the marathon limiter (season metric, informs the long run)
  const D = twin.durability || {}
  if (D.longest_continuous_run_km != null) add({ id: 'durability', label: 'Longest continuous run', value: D.longest_continuous_run_km, unit: 'km', ref: `fade from km ${D.fade_onset_km_median_90d ?? '—'} (90 d)`, status: 'info',
    why: 'Your marathon limiter: grow it ≤ 10 % per long run, never with pain.' })

  // 10) what the athlete has ALREADY done today: the morning numbers above describe the start of the day, this describes where the day left the athlete.
  //     Form (TSB) is yesterday's CTL − ATL by definition, so CTL − ATL after today's load is the form carried into tomorrow.
  const done = (today || []).filter((a) => (a.distance_m || 0) > 0 || (a.training_load || 0) > 0), tl = done.reduce((t, a) => t + (a.training_load || 0), 0)
  const km = Math.round(done.reduce((t, a) => t + ((a.sport_class || 'run') === 'run' ? (a.distance_m || 0) : 0), 0) / 100) / 10
  const fresh = twin.as_of === date && L.ctl != null && L.atl != null, after = fresh ? Math.round((L.ctl - L.atl) * 10) / 10 : null
  if (done.length) {
    const st = after == null ? 'watch' : after < -30 ? 'alert' : after < -20 ? 'watch' : 'info'
    add({ id: 'today_run', label: km ? "Today's run" : "Today's training", value: km ? `${km} km` : `TL ${tl}`, unit: '', pin: true, status: st,
      ref: `TL ${tl || '—'}${after != null ? ` · form ${L.tsb} → ${after}` : ''}`,
      why: after == null ? 'Load after today is not updated yet (waiting for the sync).' : after < -30 ? 'Deep fatigue tonight: no hard session tomorrow; fuel, fluids, sleep.' : after < -20 ? 'Fatigued: keep tomorrow easy.' : 'Load is fine: recover normally.' })
  }

  const lvl = reasons.some((r) => r.level === 'rest') ? 'rest' : reasons.length ? 'easy' : rd.score == null && !items.length ? null : 'go'
  let call = lvl && { level: lvl, label: { go: 'GO', easy: 'EASY ONLY', rest: 'REST' }[lvl], why: lvl === 'go' ? 'No rule or gate is active.' : reasons.map((r) => r.why).join(' · ') }
  if (call && done.length) {   // after training the call is about the rest of today and tomorrow
    const lead = `Done today: ${km ? km + ' km, ' : ''}TL ${tl || '—'}${after != null ? `, form ${L.tsb} → ${after}` : ''}. `
    call = { ...call, label: lvl === 'go' ? 'DONE' : call.label, why: lead + (after != null && after < -30 && lvl === 'go' ? 'Deep fatigue tonight: no hard session tomorrow.' : lvl === 'go' ? 'Recover now; tomorrow follows the plan.' : call.why) }
  }
  items.sort((x, y) => (y.pin ? 1 : 0) - (x.pin ? 1 : 0) || RANK[x.status] - RANK[y.status] || (y.rule ? 1 : 0) - (x.rule ? 1 : 0))
  return { call, items }
}

// Tomorrow's planned session against the athlete's own rules, decided TONIGHT from the form after today's load and confirmed TOMORROW MORNING by sleep HR, HRV and pain.
// Only existing rules decide: pain ≥ 4 rest, pain ≥ 2 shorten/stop (durability), and for HARD sessions form < −30 or ACWR > 1.3 means easy only. An easy session has no
// load rule that forces a change, so it is kept; the checks below then only add conditions. Returns { level, label, why[], confirm }.
const HARD_KINDS = new Set(['quality', 'tt', 'speed', 'long', 'race'])
export function tomorrowCheck(twin, day, { after = null, pain = null, weekPlanKm = null, hrCap = null } = {}) {
  if (!day || !(day.km > 0) || ['rest', 'gym'].includes(day.kind)) return { level: 'none', label: 'NO RUN', why: [day?.kind === 'gym' ? 'Gym day: no running planned.' : 'Rest day: nothing to adjust.'], plan: day || null }
  const L = twin?.load || {}, hard = HARD_KINDS.has(day.kind), why = [], plan = `${day.label || day.kind} · ${day.km} km`
  let level = 'keep', label = 'KEEP AS PLANNED'
  if (pain != null && pain >= 4) { level = 'rest'; label = 'REST'; why.push(`Pain ${pain}/10: stop and see a clinician (red-flag rule).`) }
  else if (pain != null && pain >= 2) { level = 'shorten'; label = 'SHORTEN OR SKIP'; why.push(`Pain ${pain}/10 ≥ 2 is a durability event: shorten or stop, no progression for 7 days.`) }
  else if (hard && ((after != null && after < -30) || (L.acwr_ewma != null && L.acwr_ewma > 1.3))) { level = 'swap'; label = 'SWAP TO EASY'; why.push(`Hard session with ${after != null && after < -30 ? `form ${after} (below −30)` : `load ratio ${L.acwr_ewma} (above 1.3)`}: easy only until it comes down.`) }
  else why.push(hard ? 'Hard session: form and load ratio allow it.' : 'Easy session: no rule forces a change.')
  if (level === 'keep') {
    if (after != null && after < -30) why.push(`Form will be ${after} after today: keep it truly easy${hrCap ? `, HR ≤ ${hrCap}` : ''}; walk breaks are fine.`)
    const it = twin?.intensity; if (!hard && it?.easy_runs > 0 && it.easy_runs_above_z2 / it.easy_runs >= 0.5) why.push(`Your last easy runs ran above the HR cap (${it.easy_runs_above_z2}/${it.easy_runs}): hold ${hrCap ? 'HR ≤ ' + hrCap : 'the cap'}, let pace float.`)
  }
  const guard = L.weekly_km_4w != null ? Math.round(L.weekly_km_4w * 1.1 * 10) / 10 : null
  if (weekPlanKm != null && guard && weekPlanKm > guard) why.push(`Planned week is ${weekPlanKm} km; your +10 % load guard allows about ${guard} km (4-week average ${L.weekly_km_4w}). Not a change for tomorrow, but the plan is above the rule.`)
  return { level, label, why, plan, confirm: 'Re-checked at tomorrow\'s sync: sleep HR above 67 or HRV reduced downgrades a hard session; pain 2/10 or more shortens it.' }
}
