import { useState } from 'react'
import SessionBrief from './SessionBrief.jsx'
import { useStore } from './store.js'
import { paces, raceTime, fmtTime, fmtPace } from './lib/vdot.js'
import { evaluate, EMPTY_DAY, hasInput } from './lib/gate.js'
import { RACE_BY_DATE } from './lib/season.js'
import { BY_DATE, today, diffDays, fmtLong, fmtShort, addDays, mondayOf, weekOf, KIND, PHASE_NAME, PLAN_START, DAYS3, PLAN } from './lib/calendar.js'
import { CHECKPOINTS, TARGET, cpDistance, tone } from './lib/plan.js'
import { formZone } from './lib/load.js'
import { decoupling } from './lib/analysis.js'
import { r1 } from './lib/stats.js'
import { Card, Chip, StrengthChips, Icon } from './ui.jsx'
import { useSyncStatus2, wib, ago } from './sync.js'
import { useApi, hm, fmtDur, fmtPaceS } from './api.js'
import { useModel, plannedLoad } from './model.js'
import { RadialGauge, Ring, Stacked100, StepChart, Sparkline } from './charts2.jsx'
import { BarChart } from './charts.jsx'
import FuelCard from './FuelCard.jsx'
import TodayCard from './TodayCard.jsx'
import MissedSession from './MissedSession.jsx'
import { pickShoe } from './lib/shoes.js'
import { WorkoutDetail, WorkoutLine, mainTarget, metaFor } from './Workout.jsx'
import { cfgOf, hrRange } from './lib/zones.js'
import { effectiveDay } from './lib/scaler.js'

export const thresholds = (c) => { const d = cpDistance(c); return d && c.line ? { G: fmtTime(raceTime(c.line - 0.5, d)), R: fmtTime(raceTime(c.line - 1.5, d)) } : null }
const sign = (n) => (n == null ? '—' : (n > 0 ? '+' : '') + n)
const TIER_TONE = { prime: 'green', optimal: 'teal', compromised: 'yellow', depleted: 'red' }

// Home: the 3-second morning glance — can I run, what, with what, and how is the week going.
export default function Home({ vdot, settings, results, go, M: Mprop }) {
  const T = today(), [scale] = useStore('lumpad.scale', {}), day = effectiveDay(BY_DATE[T], scale.items?.[T], T), p = paces(vdot.v), G = useApi('/api/gear')
  const [f] = useStore('lumpad.daily.' + T, EMPTY_DAY), [ov] = useStore('lumpad.muscle.' + T, {}), M = Mprop || useModel(T, settings, vdot, f, ov)
  const sync = useSyncStatus2(), g = evaluate(f, day), checked = hasInput(f), rd = M.readiness, tier = rd.tier
  const toRace = diffDays(settings.raceDate, T), wk = day ? weekOf(T) : null, mon = mondayOf(T)
  // hero pills
  const hv = M.hrv, hrv7 = M.health.filter((h) => h.date > addDays(T, -7) && h.hrv_avg != null).map((h) => h.hrv_avg), sl = M.sleep, fz = formZone(M.cur?.tsbPct)
  // session + shoe
  const adjusted = f.adjust === 'easy' ? 'Adjusted: easy' : f.adjust === 'cut' && day?.km ? `Adjusted: cut to ${r1(day.km * 0.75)} km` : null
  const shoe = pickShoe(day, G.data, settings.shoeRoles)
  // bento
  const actWeek = M.acts.filter((a) => a.sport_class === 'run' && a.date >= mon && a.date <= T).reduce((s, a) => s + (a.distance_m || 0) / 1000, 0)
  const actPrev = M.acts.filter((a) => a.sport_class === 'run' && a.date >= addDays(mon, -7) && a.date <= addDays(T, -7)).reduce((s, a) => s + (a.distance_m || 0) / 1000, 0)
  const lastWeekKm = M.acts.filter((a) => a.sport_class === 'run' && a.date >= addDays(mon, -7) && a.date <= addDays(mon, -1)).reduce((s, a) => s + (a.distance_m || 0) / 1000, 0)
  const planWeek = Array.from({ length: 7 }, (_, i) => BY_DATE[addDays(mon, i)]?.km || 0).reduce((a, b) => a + b, 0)
  const loads7 = Array.from({ length: 7 }, (_, i) => { const d = addDays(mon, i), a = M.series.find((x) => x.date === d)?.load; return { date: d, value: d <= T ? a || 0 : 0, plan: plannedLoad(BY_DATE[d], M.ratios) || undefined, tick: ['M', 'T', 'W', 'T', 'F', 'S', 'S'][i] } })
  const nextCp = CHECKPOINTS.find((c) => c.date >= T), th = nextCp && thresholds(nextCp), dist = nextCp && cpDistance(nextCp)
  const last = M.acts.filter((a) => a.sport_class === 'run')[0] || M.acts[0], dc = last ? decoupling(M.lapsById[last.id] || []) : null
  const lastSteady = last && ['easy', 'long', 'social'].includes(BY_DATE[last.date]?.kind)

  const pre = !day && T < PLAN_START, first = BY_DATE[PLAN_START], fmon = mondayOf(PLAN_START), stripMon = pre ? fmon : mon, cfg = cfgOf(settings)
  const w1 = pre ? Array.from({ length: 7 }, (_, i) => BY_DATE[addDays(fmon, i)]).filter(Boolean).reduce((a, d) => ({ km: a.km + d.km, tl: a.tl + (metaFor(d, cfg)?.tl || 0), runs: a.runs + (d.km > 0 ? 1 : 0) }), { km: 0, tl: 0, runs: 0 }) : null
  const recent = pre ? M.acts.filter((a) => a.sport_class === 'run' && a.date >= addDays(T, -14) && (a.distance_m || 0) >= 30000)[0] : null
  const heavy = M.cur && (M.cur.tsb < -30 || (M.cur.acwr != null && M.cur.acwr > 1.3))
  const DAYN = fmtLong(T).split(',')[0], rh = M.rhr, acwr = M.cur?.acwr, hvPct = hv.enough && hv.roll7 ? Math.round(((hv.today - hv.roll7) / hv.roll7) * 100) : null
  const headline = day ? `${DAYN} — ${day.label || KIND[day.kind].label}${day.km ? ' · ' + day.km + ' km' : ''}` : T < PLAN_START ? `${DAYN} — Recover, then the season starts ${DAYS3[(new Date(PLAN_START + 'T12:00:00').getDay())]} ${fmtShort(PLAN_START)}` : `${DAYN} — No session`
  const summary = [hv.enough && `HRV ${hv.today} ms (${sign(hvPct)}% vs 7 d)`, rh.value != null && `RHR ${rh.value} bpm`, M.cur && `TSB ${sign(M.cur.tsb)}${fz ? ` (${fz.label})` : ''}`, acwr != null && `ACWR ${acwr}`].filter(Boolean).join(' · ')
  const runs3 = M.acts.filter((a) => a.sport_class === 'run').slice(0, 3), hrCap = hrRange(2, cfg)[1]
  const [pv, setPv] = useState(''), briefDays = Array.from({ length: 8 }, (_, i) => effectiveDay(BY_DATE[addDays(T, i)], scale.items?.[addDays(T, i)], addDays(T, i))).filter((d) => d && d.km > 0 && !['rest', 'gym'].includes(d.kind)), pvDay = briefDays.find((d) => d.date === pv) || briefDays[0]
  const RACES = PLAN.filter((d) => d.kind === 'race' && /FM|Full/.test(d.label || '')), near = RACES.find((d) => d.date >= T), aRace = settings.raceDate
  return <section className="screen home">
    <section className="hv2-hero">
      <header className="hv2-banner">
        <div className="hv2-banner-top">
          <div className="hv2-tags"><span className="hv2-chip">DAILY BRIEFING · {fmtLong(T).split(', ').slice(1).join(', ').toUpperCase()}</span>{day && <span className="hv2-chip am">{((wk?.id || '') + ' · ' + (PHASE_NAME[day.phase] || day.phase)).toUpperCase()}</span>}</div>
          <button className={`hv2-sync ${sync === null ? 'warn' : sync?.lastRun ? (sync.lastRun.ok ? 'ok' : 'warn') : 'none'}`} onClick={() => go('profile')}>
        <i />{sync === undefined ? 'Checking sync…' : sync === null ? 'Sync status unreachable — data may be stale' : sync?.lastRun ? <>Sync {ago(sync.lastRun.received_at)} · {wib(sync.lastRun.received_at)} WIB</> : 'No sync yet — no COROS/Strava data has arrived'}
      </button>
        </div>
        <h1 className="hv2-title">{headline}</h1>
      </header>
      <TodayCard checkin={checked ? f : null} settings={settings} go={go} todayActs={M.acts.filter((a) => a.date === T && a.sport_class !== 'strength')} date={T} tomorrow={effectiveDay(BY_DATE[addDays(T, 1)], scale.items?.[addDays(T, 1)], T)} weekPlanKm={(() => { const m = mondayOf(addDays(T, 1)); return Math.round(Array.from({ length: 7 }, (_, i) => BY_DATE[addDays(m, i)]?.km || 0).reduce((a, b) => a + b, 0) * 10) / 10 })()} />
    </section>

    <MissedSession day={day} date={T} runsToday={M.acts.filter((a) => a.date === T && a.sport_class === 'run').length} checkin={checked ? f : null} tier={tier?.id} />

    <FuelCard last={last} today={T} />

    <div className="hv2-row hv2-r75">
      <div className="hv2-readiness">
        <button className="card hero-btn g-hero" onClick={() => go('ready')} aria-label={`Readiness ${rd.score ?? 'not available'}. Open details`}>
          <div className="hero">
            <RadialGauge value={rd.score} tone={tier ? TIER_TONE[tier.id] : 'none'} label="Readiness" size={112} sub={rd.score == null ? 'not enough data' : '/ 100'} />
            <div className="hx"><span className={'tierc ' + (tier ? 'tier-' + tier.id : '')}>{tier ? tier.label : checked ? { green: 'Go', yellow: 'Scale down', red: 'Rest' }[g.level] : 'No check-in yet'}</span>
              <h2>{rd.caps[0] ? 'Gate active: ' + rd.caps[0].why : tier ? (day ? tier.advice : heavy ? 'No session planned. Load is high — easy running or rest only.' : 'No session planned today. Easy run or rest.') : checked ? (g.reasons[0]?.msg || 'No red flags') : 'Tap to check in (±15 seconds)'}</h2>
              <p className="muted">Data {rd.coverage}/100 pts{M.recov?.recovery_hours != null ? ` · full recovery ±${M.recov.recovery_hours} h` : ''}</p></div>
          </div>
          <div className="pills four">
            <div className="pillc"><small>Overnight HRV</small><b>{hv.today ?? '—'}{hv.today ? ' ms' : ''}</b>{hv.enough ? <em className={hv.flagTrend ? 'warn-t' : ''}>{sign(hvPct)}% vs 7 d</em> : <em>needs 14 d</em>}<Sparkline data={hrv7} label="HRV 7 days" w={70} h={18} /></div>
            <div className="pillc"><small>Sleep duration</small><b>{sl.enough ? hm(sl.asleep_min) : '—'}</b>{sl.enough ? <div className="minibar" role="img" aria-label={`Deep ${sl.deep}% REM ${sl.rem}%`}><i style={{ width: sl.deep + '%', background: 'var(--c-long)' }} /><i style={{ width: sl.rem + '%', background: 'var(--c-tt)' }} /></div> : <em>not pulled yet</em>}{sl.enough && <em>deep+REM {sl.deep + sl.rem}%</em>}</div>
            <div className="pillc"><small>Resting HR</small><b>{rh.value ?? '—'}{rh.value != null ? ' bpm' : ''}</b><em>{rh.enough ? `${sign(rh.dev)} vs 30 d` : 'needs data'}</em></div>
            <div className="pillc"><small>Form (TSB)</small><b>{sign(M.cur?.tsb)}</b><em>{fz ? fz.label : 'none yet'}</em><em>CTL {M.cur?.ctl ?? '—'} · ATL {M.cur?.atl ?? '—'}</em>{(M.series.find((x) => x.date === T)?.load || 0) > 0 && M.cur && <em className="warn-t">after today's load: {sign(r1(M.cur.ctl - M.cur.atl))}</em>}</div>
          </div>
        </button>
      </div>
      <div className="hv2-weekcard card">
        <div className="hv2-week-h"><h2>{pre ? `First week · from ${fmtShort(fmon)}` : 'This week'}</h2><button className="link" onClick={() => go('calendar')}>Calendar →</button></div>
      <div className="strip">{Array.from({ length: 7 }, (_, i) => addDays(stripMon, i)).map((sd, i) => { const d = BY_DATE[sd], ran = M.acts.filter((a) => a.sport_class === 'run' && a.date === sd).reduce((t, a) => t + (a.distance_m || 0) / 1000, 0)
        return <button key={sd} aria-current={sd === T ? 'date' : undefined} aria-label={`${fmtLong(sd)}: ${d ? (d.label || KIND[d.kind].label) + (d.km ? ', planned ' + d.km + ' km' : '') : 'no session'}${ran ? ', already ran ' + ran.toFixed(1) + ' km' : ''}`} className={`sc ${sd === T ? 'today' : ''} ${d ? 'k-' + d.kind : 'k-none'}`} onClick={() => go('calendar', sd)}>
          <small>{DAYS3[(i + 1) % 7]}</small><b>{d && d.km ? d.km : '–'}</b><i>{ran ? '✓ ' + r1(ran) : d ? KIND[d.kind].short : ''}</i></button> })}</div>
        {day && day.km > 0 && <p className="hv2-cap"><b>{DAYN} (Today):</b> {day.label || KIND[day.kind].label} <span className="num">{day.km} km{metaFor(day, cfg)?.tl ? ` · ${metaFor(day, cfg).tl} TL` : ''}</span></p>}
        <div className="hv2-traj"><div className="hv2-week-h"><h3>Fitness toward sub-4</h3><span className="muted num">{vdot.v.toFixed(1)} → {TARGET.vdotNeeded}</span></div>
      <div className="bar"><i style={{ width: Math.max(0, Math.min(1, (vdot.v - TARGET.baseline) / (TARGET.vdotNeeded - TARGET.baseline))) * 100 + '%' }} /></div>
      <p className="muted">Needs {(TARGET.vdotNeeded - vdot.v).toFixed(1)} more VDOT · 1.02/mo required vs best observed pace 0.74 <Chip>HYPOTHESIS n=2</Chip></p>
        </div>
      </div>
    </div>

    <div className="hv2-row hv2-r66">
      <div className="hv2-sess">
        {day && <Card className={`sess g-sess k-${day.kind}`}>
      <div className="sess-top"><Chip kind={day.kind}>{KIND[day.kind].label}</Chip>{day.scaled && <Chip tone="yellow">auto-scaled · was {day.plannedLabel}{day.plannedKm ? ` ${day.plannedKm} km` : ''}</Chip>}<span className="muted">{wk?.id} · {PHASE_NAME[day.phase] || day.phase}</span></div>
      <h2 className="sess-title">{day.label || KIND[day.kind].label}</h2>
      {adjusted && <Chip tone="yellow">{adjusted}</Chip>}
      {day.km > 0 ? <>
        <div className="bigkm"><b>{day.km}</b><span>km</span></div>
        <WorkoutLine day={day} />
        {mainTarget(day, cfgOf(settings)) && <p className="wtarget"><b>{mainTarget(day, cfgOf(settings))}</b></p>}
        <WorkoutDetail day={day} settings={settings} />
        <dl className="pace"><div><dt>Shoe</dt><dd>{shoe ? shoe.name : <button className="link" onClick={() => go('profile')}>Set shoe roles in Profile</button>}</dd></div></dl>
      </> : <>
        <p className="muted">{day.kind === 'gym' ? 'Gym day — no running.' : 'Rest day.'} Recovery checklist:</p>
        <ul className="rules">{[...(day.tags || []).filter((t) => /Upper|Lower|Full|FB/.test(t)).map((t) => `Gym: ${t} (as planned)`), '10 minutes of mobility + check tibia and pain', `Sleep target ≥ ${hm(settings.sleepNeedMin || 480)}`, 'Easy 20–30 minute walk (optional)', 'Drink enough; eat normal carbs + protein'].map((x) => <li key={x}>{x}</li>)}</ul>
      </>}
      <div className="chips"><StrengthChips day={day} />{day.tags.filter((t) => /^CP/.test(t)).map((t) => <Chip key={t} tone="cp">{t}</Chip>)}</div>
    </Card>}
        {pre && first && <div className="planb">
          <span className="planb-chip">Season starts in {diffDays(PLAN_START, T)} days · {fmtLong(PLAN_START)}</span>
          <h2>{first.label || KIND[first.kind].label} · {first.km} km</h2>
          <WorkoutLine day={first} />
          {mainTarget(first, cfg) && <p className="wtarget"><b>{mainTarget(first, cfg)}</b></p>}
          <p className="muted">Week 1: {Math.round(w1.km * 10) / 10} km · {w1.runs} runs · {w1.tl} TL. Until then: easy runs only (≤ 6 km, HR zone 1–2, under {hrRange(2, cfg)[1]} bpm) or rest — arrive fresh.</p>
          <div className="planb-row"><button className="planb-btn" onClick={() => go('calendar', PLAN_START)}>First session</button><button className="planb-btn" onClick={() => go('calendar', { view: 'cp' })}>Checkpoints</button></div>
        </div>}
        {!day && !pre && <div className="planb">
          <span className="planb-chip">Outside the plan</span>
          <h2>No session scheduled</h2>
          <p>Check the calendar for the next session.</p>
          <button className="planb-btn" onClick={() => go('calendar', { view: 'cp' })}>Checkpoints</button>
        </div>}
      </div>
      <div className="hv2-brief">
        {briefDays.length > 0 && <div className="sbwrap"><label className="sbsel"><span>Preview session</span><select value={pvDay?.date || ''} onChange={(e) => setPv(e.target.value)} aria-label="Preview session for the smart brief">{briefDays.map((d) => <option key={d.date} value={d.date}>{d.date === T ? 'Today' : fmtShort(d.date)} · {d.label || KIND[d.kind].label} · {d.km} km</option>)}</select></label>
          <SessionBrief day={pvDay} readiness={rd} healthRow={M.health?.at(-1)} dailyCheckin={pvDay?.date === T ? f : EMPTY_DAY} twinLoad={M.cur} vdot={vdot} /></div>}
      </div>
    </div>

    <div className="bento4 hv2-bento">
          <button className="bx b-vol" onClick={() => go('activity')} aria-label="This week's volume, open Activities"><h3>Weekly volume</h3><div className="row-c"><Ring value={actWeek} max={(planWeek || lastWeekKm) || 1} label={`${r1(actWeek)} of ${r1(planWeek || lastWeekKm)} km`} size={78} /><div><b>{r1(actWeek)}</b><span className="muted"> / {r1(planWeek || lastWeekKm)} km</span><br /><small className="muted">{planWeek > 0 ? `planned · ${sign(r1(actWeek - actPrev))} km vs last week` : `last week ${r1(lastWeekKm)} km · no plan this week`}</small></div></div></button>
          <button className="bx b-int" onClick={() => go('ready', { mode: 'analysis' })} aria-label="7-day intensity, open analysis"><h3>7-day intensity</h3>{M.intensity ? <Stacked100 parts={[{ k: 'Low', v: M.intensity.low, c: 'var(--green)' }, { k: 'Moderate', v: M.intensity.mid, c: 'var(--yellow)' }, { k: 'High', v: M.intensity.high, c: 'var(--red)' }]} marker={70} label={`Low ${M.intensity.low}%, moderate ${M.intensity.mid}%, high ${M.intensity.high}%; target 70% low`} /> : <p className="muted">No runs yet.</p>}<small className="muted">target ≥70% low (Campos 2021)</small></button>
          <button className="bx b-load" onClick={() => go('ready', { mode: 'analysis' })} aria-label="Daily load, open analysis"><h3>Daily load</h3><BarChart data={loads7} height={64} label={`Training load this week: ${loads7.map((d) => d.value).join(', ')}`} /><small className="muted">dashed = plan (estimate)</small></button>
          <button className="bx feat b-cp" onClick={() => nextCp ? go('calendar', { view: 'cp', id: nextCp.id }) : go('calendar', { view: 'race' })} aria-label={nextCp ? `Checkpoint CP${nextCp.id}, ${diffDays(nextCp.date, T)} days away` : `Race, ${toRace} days away`}><h3>{nextCp ? `CP${nextCp.id}` : 'Race'}</h3><div className="flipnum">{nextCp ? diffDays(nextCp.date, T) : toRace}<small className="muted" style={{ fontSize: '.8rem', fontWeight: 500 }}> days</small></div>
            <small className="muted">{nextCp && th ? `Green ≤ ${th.G} · now ±${fmtTime(raceTime(vdot.v, dist))}` : nextCp ? nextCp.name : 'sub-4:00'}</small></button>

        </div>

    {runs3.length > 0 && <div className="card hv2-recent">
      <div className="hv2-recent-h"><h2>Recent Activities <span className="hv2-pill">Last {runs3.length} runs</span></h2><button type="button" className="link" onClick={() => go('activity')}>All Activities →</button></div>
      <div className="hv2-table" role="table" aria-label="Recent runs">
        <div className="hv2-tr hv2-th" role="row"><span>Date · Load</span><span>Activity &amp; gear</span><span>Distance</span><span>Duration</span><span>Avg pace</span><span>Avg HR</span><span>Analysis</span></div>
        {runs3.map((a) => <div key={a.id} className="hv2-tr" role="row">
          <span className="hv2-c-date"><b>{fmtShort(a.date)}</b>{a.training_load ? <Chip tone={a.training_load >= 100 ? 'red' : a.training_load >= 70 ? 'yellow' : 'green'}>TL {a.training_load}</Chip> : null}</span>
          <span className="hv2-c-name"><b>{a.name}</b><small>{[a.gear_id && G.data?.find?.((g) => g.id === a.gear_id)?.name].filter(Boolean).join(' · ')}</small></span>
          <span className="num" data-l="Distance">{a.distance_m ? (a.distance_m / 1000).toFixed(2) + ' km' : '—'}</span>
          <span className="num" data-l="Duration">{a.duration_s ? fmtDur(a.duration_s) : '—'}</span>
          <span className="num" data-l="Avg pace">{a.avg_pace_s_km ? fmtPaceS(a.avg_pace_s_km) + ' /km' : '—'}</span>
          <span className="num" data-l="Avg HR">{a.avg_hr ? a.avg_hr + ' bpm' : '—'}{a.avg_hr && a.avg_hr > hrCap ? <Chip tone="yellow">&gt;{hrCap} cap</Chip> : null}</span>
          <span><button type="button" className="btn primary sm" onClick={() => go('activity', { id: (a.ids?.[0] || a.id) })}>Open Full Run Analysis →</button></span>
        </div>)}
      </div>
    </div>}
  </section>
}
