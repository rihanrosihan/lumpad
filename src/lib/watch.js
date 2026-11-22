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

export function watchList(twin, { checkin = null, sleepNeedMin = 480 } = {}) {
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
    add({ id: 'easy_hr', label: 'Easy runs too hard', value: `${it.easy_runs_above_z2}/${it.easy_runs}`, unit: '', ref: `cap ${it.z2_ceiling} bpm · low-zone time ${it.low_share_pct ?? '—'} %`, status: st,
      why: st === 'ok' ? 'Easy runs stayed easy.' : `Easy runs above the ${it.z2_ceiling} bpm ceiling: slow down or walk to stay under it.` })
  }
  // 6) aerobic marker — HR at 8:00/km vs the athlete's baseline
  const a = twin.aerobic?.hr_at_800
  if (a?.value != null && a.z != null) {
    const st = a.z >= 2 ? 'alert' : a.z >= 1 ? 'watch' : 'ok'
    add({ id: 'hr800', label: 'HR at 8:00/km', value: a.value, unit: 'bpm', ref: `baseline ${a.baseline?.split(' (')[0] || '—'} · n=${a.n}`, status: st,
      why: st === 'alert' ? `Well above baseline (${sgn(a.z)} SD): fatigue, heat or illness. Keep running easy until it comes back.${a.n < 5 ? ' Few runs: treat as a warning.' : ''}` : st === 'watch' ? 'Slightly above baseline.' : 'At or below baseline: aerobic fitness on track.' })
  }
  // 7) load guard — locked rule (+10 %), plus form
  const L = twin.load || {}
  if (L.km_vs_4wk_avg_pct != null) {
    const v = L.km_vs_4wk_avg_pct, st = v > KM_GUARD ? 'alert' : v > KM_GUARD / 2 ? 'watch' : 'ok'
    add({ id: 'km_guard', label: 'Weekly km vs 4 weeks', value: `${sgn(v)} %`, unit: '', ref: `rule: ≤ +${KM_GUARD} %`, status: st, rule: true,
      why: st === 'alert' ? 'Over the load guard: hold or reduce volume this week.' : st === 'watch' ? 'Close to the +10 % guard.' : 'Within the guard.' })
  }
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

  const lvl = reasons.some((r) => r.level === 'rest') ? 'rest' : reasons.length ? 'easy' : rd.score == null && !items.length ? null : 'go'
  const call = lvl && { level: lvl, label: { go: 'GO', easy: 'EASY ONLY', rest: 'REST' }[lvl], why: lvl === 'go' ? 'No rule or gate is active.' : reasons.map((r) => r.why).join(' · ') }
  items.sort((x, y) => RANK[x.status] - RANK[y.status] || (y.rule ? 1 : 0) - (x.rule ? 1 : 0))
  return { call, items }
}
