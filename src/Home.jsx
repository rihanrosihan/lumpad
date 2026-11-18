import { useStore } from './store.js'
import { paces, raceTime, fmtTime, fmtPace } from './lib/vdot.js'
import { sessionPaces } from './lib/pace.js'
import { evaluate, EMPTY_DAY, hasInput } from './lib/gate.js'
import { BY_DATE, today, diffDays, fmtLong, fmtShort, addDays, mondayOf, weekOf, KIND, PHASE_NAME, PLAN_START, DAYS3, PLAN } from './lib/calendar.js'
import { CHECKPOINTS, TARGET, cpDistance, tone } from './lib/plan.js'
import { formZone } from './lib/load.js'
import { decoupling, sessionSteps } from './lib/analysis.js'
import { r1 } from './lib/stats.js'
import { Card, Chip, StrengthChips, Icon } from './ui.jsx'
import { useSyncStatus2, wib, ago } from './sync.js'
import { useApi, hm, fmtDur, fmtPaceS } from './api.js'
import { useModel, plannedLoad } from './model.js'
import { RadialGauge, Ring, Stacked100, StepChart, Sparkline } from './charts2.jsx'
import { BarChart } from './charts.jsx'
import FuelCard from './FuelCard.jsx'
import { HomeCoach } from './Coach.jsx'
import { pickShoe } from './lib/shoes.js'
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
  const steps = sessionSteps(day), adjusted = f.adjust === 'easy' ? 'Adjusted: easy' : f.adjust === 'cut' && day?.km ? `Adjusted: cut to ${r1(day.km * 0.75)} km` : null
  const shoe = pickShoe(day, G.data, settings.shoeRoles)
  // bento
  const actWeek = M.acts.filter((a) => a.sport_class === 'run' && a.date >= mon && a.date <= T).reduce((s, a) => s + (a.distance_m || 0) / 1000, 0)
  const actPrev = M.acts.filter((a) => a.sport_class === 'run' && a.date >= addDays(mon, -7) && a.date <= addDays(T, -7)).reduce((s, a) => s + (a.distance_m || 0) / 1000, 0)
  const planWeek = Array.from({ length: 7 }, (_, i) => BY_DATE[addDays(mon, i)]?.km || 0).reduce((a, b) => a + b, 0)
  const loads7 = Array.from({ length: 7 }, (_, i) => { const d = addDays(mon, i), a = M.series.find((x) => x.date === d)?.load; return { date: d, value: d <= T ? a || 0 : 0, plan: plannedLoad(BY_DATE[d], M.ratios) || undefined, tick: ['S', 'S', 'R', 'K', 'J', 'S', 'M'][i] } })
  const nextCp = CHECKPOINTS.find((c) => c.date >= T), th = nextCp && thresholds(nextCp), dist = nextCp && cpDistance(nextCp)
  const last = M.acts.filter((a) => a.sport_class === 'run')[0] || M.acts[0], dc = last ? decoupling(M.lapsById[last.id] || []) : null
  const lastSteady = last && ['easy', 'long', 'social'].includes(BY_DATE[last.date]?.kind)

  const DAYN = fmtLong(T).split(',')[0], rh = M.rhr, acwr = M.cur?.acwr, hvPct = hv.enough && hv.roll7 ? Math.round(((hv.today - hv.roll7) / hv.roll7) * 100) : null
  const headline = day ? `${DAYN} — ${day.label || KIND[day.kind].label}${day.km ? ' · ' + day.km + ' km' : ''}` : T < PLAN_START ? `${DAYN} — Easy Focus, Volume Guard & Rehab` : `${DAYN} — No session`
  const summary = [hv.enough && `HRV ${hv.today} ms (${sign(hvPct)}% vs 7 d)`, rh.value != null && `RHR ${rh.value} bpm`, M.cur && `TSB ${sign(M.cur.tsb)}${fz ? ` (${fz.label})` : ''}`, acwr != null && `ACWR ${acwr}`].filter(Boolean).join(' · ')
  const RACES = PLAN.filter((d) => d.kind === 'race' && /FM|Full/.test(d.label || '')), near = RACES.find((d) => d.date >= T), aRace = settings.raceDate
  return <section className="screen home">
    <div className="hero4">
      <div className="h4-tags"><span className="tag">DAILY BRIEFING · {fmtLong(T).split(', ').slice(1).join(', ').toUpperCase()}</span>{T < PLAN_START ? <span className="tag am">PRE-PLAN · STARTS {fmtShort(PLAN_START).toUpperCase()} ({diffDays(PLAN_START, T)} DAYS)</span> : day && <span className="tag am">{((wk?.id || '') + ' · ' + (PHASE_NAME[day.phase] || day.phase)).toUpperCase()}</span>}</div>
      <button className={`fresh ${sync === null ? 'warn' : sync?.lastRun ? (sync.lastRun.ok ? 'ok' : 'warn') : 'none'}`} onClick={() => go('profile')}>
      <i />{sync === undefined ? 'Checking sync…' : sync === null ? 'Sync status unreachable — data may be stale' : sync?.lastRun ? <>Sync {ago(sync.lastRun.received_at)} · {wib(sync.lastRun.received_at)} WIB</> : 'No sync yet — no COROS/Strava data has arrived'}
    </button>
      <h1>{headline}</h1>
      <p className="h4-sum">{rd.score != null ? <><b>{tier.label}</b> — {tier.advice} </> : null}<span>{summary}</span></p>
      <div className="h4-tiles">
        {near && <button className="cd g" onClick={() => go('race')} aria-label={`Nearest race ${near.label}, ${diffDays(near.date, T)} days`}><small>NEAREST RACE (C-RACE)</small><b>D-{diffDays(near.date, T)}</b><span>{near.label.split(' · ')[0]} · {fmtShort(near.date)}</span></button>}
        <button className="cd r" onClick={() => go('race')} aria-label={`A-race JRF, ${toRace} days`}><small>PRIMARY GOAL (A-RACE)</small><b>D-{Math.max(0, toRace)}</b><span>JRF Sub-4 · {fmtShort(aRace)}</span></button>
        {nextCp && <button className="cd n" onClick={() => go('calendar', { view: 'cp', id: nextCp.id })}><small>NEXT CHECKPOINT ({diffDays(nextCp.date, T)}D)</small><span><b>CP{nextCp.id} · {nextCp.name}</b> <Icon n="chev" size={16} /></span></button>}
      </div>
    </div>

    <FuelCard last={last} today={T} />

    <div className="hrow">
      <div className="hl">
        <button className="card hero-btn g-hero" onClick={() => go('ready')} aria-label={`Readiness ${rd.score ?? 'not available'}. Open details`}>
          <div className="hero">
            <RadialGauge value={rd.score} tone={tier ? TIER_TONE[tier.id] : 'none'} label="Readiness" size={112} sub={rd.score == null ? 'not enough data' : '/ 100'} />
            <div className="hx"><span className={'tierc ' + (tier ? 'tier-' + tier.id : '')}>{tier ? tier.label : checked ? { green: 'Go', yellow: 'Scale down', red: 'Rest' }[g.level] : 'No check-in yet'}</span>
              <h2>{rd.caps[0] ? 'Gate active: ' + rd.caps[0].why : tier ? tier.advice : checked ? (g.reasons[0]?.msg || 'No red flags') : 'Tap to check in (±15 seconds)'}</h2>
              <p className="muted">Data {rd.coverage}/100 pts{M.recov?.recovery_hours != null ? ` · full recovery ±${M.recov.recovery_hours} h` : ''}</p></div>
          </div>
          <div className="pills four">
            <div className="pillc"><small>Overnight HRV</small><b>{hv.today ?? '—'}{hv.today ? ' ms' : ''}</b>{hv.enough ? <em className={hv.flagTrend ? 'warn-t' : ''}>{sign(hvPct)}% vs 7 d</em> : <em>needs 14 d</em>}<Sparkline data={hrv7} label="HRV 7 days" w={70} h={18} /></div>
            <div className="pillc"><small>Sleep duration</small><b>{sl.enough ? hm(sl.asleep_min) : '—'}</b>{sl.enough ? <div className="minibar" role="img" aria-label={`Deep ${sl.deep}% REM ${sl.rem}%`}><i style={{ width: sl.deep + '%', background: 'var(--c-long)' }} /><i style={{ width: sl.rem + '%', background: 'var(--c-tt)' }} /></div> : <em>not pulled yet</em>}{sl.enough && <em>deep+REM {sl.deep + sl.rem}%</em>}</div>
            <div className="pillc"><small>Resting HR</small><b>{rh.value ?? '—'}{rh.value != null ? ' bpm' : ''}</b><em>{rh.enough ? `${sign(rh.dev)} vs 30 d` : 'needs data'}</em></div>
            <div className="pillc"><small>Form (TSB)</small><b>{sign(M.cur?.tsb)}</b><em>{fz ? fz.label : 'none yet'}</em><em>CTL {M.cur?.ctl ?? '—'} · ATL {M.cur?.atl ?? '—'}</em></div>
          </div>
        </button>
        {day && <Card className={`sess g-sess k-${day.kind}`}>
      <div className="sess-top"><Chip kind={day.kind}>{KIND[day.kind].label}</Chip>{day.scaled && <Chip tone="yellow">auto-scaled · was {day.plannedLabel}{day.plannedKm ? ` ${day.plannedKm} km` : ''}</Chip>}<span className="muted">{wk?.id} · {PHASE_NAME[day.phase] || day.phase}</span></div>
      <h2 className="sess-title">{day.label || KIND[day.kind].label}</h2>
      {adjusted && <Chip tone="yellow">{adjusted}</Chip>}
      {day.km > 0 ? <>
        <div className="bigkm"><b>{day.km}</b><span>km</span></div>
        {steps.length > 1 && <StepChart steps={steps} />}
        {sessionPaces(day, p).length > 0 && <dl className="pace">{sessionPaces(day, p).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>}
        <dl className="pace"><div><dt>Shoe</dt><dd>{shoe ? shoe.name : <button className="link" onClick={() => go('profile')}>Set shoe roles in Profile</button>}</dd></div></dl>
        <p className="src">Pace from VDOT {vdot.v.toFixed(1)} · structure from the plan label (WU 2 / CD 1 km) [calc]</p>
      </> : <>
        <p className="muted">{day.kind === 'gym' ? 'Gym day — no running.' : 'Rest day.'} Recovery checklist:</p>
        <ul className="rules">{[...(day.tags || []).filter((t) => /Upper|Lower|Full|FB/.test(t)).map((t) => `Gym: ${t} (as planned)`), '10 minutes of mobility + check tibia and pain', `Sleep target ≥ ${hm(settings.sleepNeedMin || 480)}`, 'Easy 20–30 minute walk (optional)', 'Drink enough; eat normal carbs + protein'].map((x) => <li key={x}>{x}</li>)}</ul>
      </>}
      <div className="chips"><StrengthChips day={day} />{day.tags.filter((t) => /^CP/.test(t)).map((t) => <Chip key={t} tone="cp">{t}</Chip>)}</div>
    </Card>}
      </div>
      <div className="hr">
        <HomeCoach go={go} />
        {!day && <div className="planb">
          <span className="planb-chip">{T < PLAN_START ? `Base & rehab block · ${diffDays(PLAN_START, T)} days to the plan` : 'Outside the plan'}</span>
          <h2>{T < PLAN_START ? 'The season has not started' : 'No session scheduled'}</h2>
          <p>{T < PLAN_START ? `First day: ${fmtLong(PLAN_START)} (COROS plan week 1). Until then: easy runs, hold volume, rehab.` : 'Check the calendar for the next session.'}</p>
          <button className="planb-btn" onClick={() => go('calendar', { view: 'cp' })}>Checkpoint roadmap</button>
        </div>}
        <div className="b-week"><Card title="This week" className="tight" right={<button className="link" onClick={() => go('calendar')}>Calendar</button>}>
      <div className="strip">{Array.from({ length: 7 }, (_, i) => addDays(mon, i)).map((sd, i) => { const d = BY_DATE[sd], ran = M.acts.filter((a) => a.sport_class === 'run' && a.date === sd).reduce((t, a) => t + (a.distance_m || 0) / 1000, 0)
        return <button key={sd} aria-current={sd === T ? 'date' : undefined} aria-label={`${fmtLong(sd)}: ${d ? (d.label || KIND[d.kind].label) + (d.km ? ', planned ' + d.km + ' km' : '') : 'no session'}${ran ? ', already ran ' + ran.toFixed(1) + ' km' : ''}`} className={`sc ${sd === T ? 'today' : ''} ${d ? 'k-' + d.kind : 'k-none'}`} onClick={() => go('calendar', sd)}>
          <small>{DAYS3[(i + 1) % 7]}</small><b>{d && d.km ? d.km : '–'}</b><i>{ran ? '✓ ' + r1(ran) : d ? KIND[d.kind].short : ''}</i></button> })}</div>
    </Card></div>
        <div className="b-traj"><Card title="Fitness toward sub-4" right={<span className="muted">{vdot.v.toFixed(1)} → {TARGET.vdotNeeded}</span>}>
      <div className="bar"><i style={{ width: Math.max(0, Math.min(1, (vdot.v - TARGET.baseline) / (TARGET.vdotNeeded - TARGET.baseline))) * 100 + '%' }} /></div>
      <p className="muted">Needs {(TARGET.vdotNeeded - vdot.v).toFixed(1)} more VDOT · 1.02/mo required vs best observed pace 0.74 <Chip>HYPOTHESIS n=2</Chip></p>
    </Card></div>
      </div>
    </div>

    <div className="bento4">
      <button className="bx b-vol" onClick={() => go('activity')} aria-label="This week's volume, open Activities"><h3>Weekly volume</h3><div className="row-c"><Ring value={actWeek} max={planWeek || 1} label={`${r1(actWeek)} of ${r1(planWeek)} km`} size={78} /><div><b>{r1(actWeek)}</b><span className="muted"> / {r1(planWeek)} km</span><br /><small className="muted">{sign(r1(actWeek - actPrev))} km vs last week</small></div></div></button>
      <button className="bx b-int" onClick={() => go('ready', { mode: 'analisis' })} aria-label="7-day intensity, open analysis"><h3>7-day intensity</h3>{M.intensity ? <Stacked100 parts={[{ k: 'Low', v: M.intensity.low, c: 'var(--green)' }, { k: 'Moderate', v: M.intensity.mid, c: 'var(--yellow)' }, { k: 'High', v: M.intensity.high, c: 'var(--red)' }]} marker={70} label={`Low ${M.intensity.low}%, moderate ${M.intensity.mid}%, high ${M.intensity.high}%; target 70% low`} /> : <p className="muted">No runs yet.</p>}<small className="muted">target ≥70% low (Campos 2021)</small></button>
      <button className="bx b-load" onClick={() => go('ready', { mode: 'analisis' })} aria-label="Daily load, open analysis"><h3>Daily load</h3><BarChart data={loads7} height={64} label={`Training load this week: ${loads7.map((d) => d.value).join(', ')}`} /><small className="muted">dashed = plan (estimate)</small></button>
      <button className="bx feat b-cp" onClick={() => nextCp ? go('calendar', { view: 'cp', id: nextCp.id }) : go('calendar', { view: 'race' })} aria-label={nextCp ? `Checkpoint CP${nextCp.id}, ${diffDays(nextCp.date, T)} days away` : `Race, ${toRace} days away`}><h3>{nextCp ? `CP${nextCp.id}` : 'Race'}</h3><div className="flipnum">{nextCp ? diffDays(nextCp.date, T) : toRace}<small className="muted" style={{ fontSize: '.8rem', fontWeight: 500 }}> days</small></div>
        <small className="muted">{nextCp && th ? `Green ≤ ${th.G} · now ±${fmtTime(raceTime(vdot.v, dist))}` : nextCp ? nextCp.name : 'sub-4:00'}</small></button>

    </div>

    {last && <button className="card rowbtn plain strip-last" onClick={() => go('activity', { id: last.ids[0] })} aria-label={`Last activity ${last.name}`}>
      <span className={`kdot k-a${String(last.sport_class).split(':')[0]}`} />
      <span><b>{last.name}</b><small>{fmtShort(last.date)} · {last.distance_m ? (last.distance_m / 1000).toFixed(2) + ' km' : fmtDur(last.duration_s)}{last.avg_pace_s_km && last.sport_class === 'run' ? ` · ${fmtPaceS(last.avg_pace_s_km)}/km` : ''}{last.avg_hr ? ` · ${last.avg_hr} bpm` : ''}{last.training_load ? ` · TL ${last.training_load}` : ''}</small></span>
      {dc && lastSteady ? <Chip tone={dc.band}>Pa:Hr {dc.pct}%</Chip> : <Icon n="chev" size={18} />}
    </button>}
  </section>
}
