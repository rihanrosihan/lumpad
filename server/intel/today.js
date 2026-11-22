// "Today's activity" for the coach: what the athlete has ALREADY done today and what it did to load. Without it the daily brief only saw the morning
// state (sleep, readiness, load before the run) and could not tell the athlete had already run. Pure; the caller supplies today's rows and the twin.
// Form (TSB) is by definition yesterday's CTL − ATL, so it cannot move on the day of the run; CTL − ATL AFTER today's load is the form the athlete
// carries into tomorrow, and that is what recovery and tomorrow's session should be judged on.
const r1 = (x) => (x == null || !isFinite(x) ? null : Math.round(x * 10) / 10)

export function todayActivity(acts, twinRow, date, tomorrow = null) {
  if (!acts?.length) return undefined
  const L = twinRow?.state?.load || {}, fresh = twinRow?.state?.as_of === date && L.ctl != null && L.atl != null
  const tl = acts.reduce((s, a) => s + (a.training_load || 0), 0)
  return {
    date, note: 'activities already completed today (COROS); judge the REST of today and tomorrow, not the morning state',
    activities: acts.map((a) => ({ name: a.name || a.sport, sport: a.sport, km: a.distance_m ? r1(a.distance_m / 1000) : null, minutes: a.duration_s ? Math.round(a.duration_s / 60) : null,
      avg_hr: a.avg_hr ?? null, pace_s_km: a.avg_pace_s_km ? Math.round(a.avg_pace_s_km) : null, training_load: a.training_load ?? null, fit_analysed: !!a.fit })),
    tl_today: tl || null,
    // the session planned for tomorrow, so the brief can say whether it needs adjusting
    tomorrow_plan: tomorrow ? { date: tomorrow.date, kind: tomorrow.kind, label: tomorrow.label || null, km: tomorrow.km ?? null, planned_tl: tomorrow.tl ?? null, hr_zone: tomorrow.steps?.find?.((x) => x.t === 'run')?.z ?? null } : null,
    load: fresh ? { ctl: L.ctl, atl: L.atl, tsb_this_morning: L.tsb, tsb_after_today: r1(L.ctl - L.atl), acwr: L.acwr_ewma ?? null }
      : { note: 'the digital twin has not been rebuilt since this activity: load after today is not known yet' },
  }
}
