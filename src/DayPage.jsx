import SessionBrief from './SessionBrief.jsx'
import { useStore } from './store.js'
import { evaluate, EMPTY_DAY, hasInput, HARD } from './lib/gate.js'
import { pickShoe } from './lib/shoes.js'
import { BY_DATE, today, addDays, fmtLong, diffDays, KIND, PHASE_NAME } from './lib/calendar.js'
import { Card, Chip, StrengthChips, Icon, StatusPill } from './ui.jsx'
import { useApi, fmtDur, fmtPaceS } from './api.js'
import { WorkoutDetail, WorkoutLine, mainTarget, stepsFor } from './Workout.jsx'
import { effectiveDay } from './lib/scaler.js'
import { useCorosPlan } from './useCoros.js'
import CourseMap from './CourseMap.jsx'
import JakimBenchmark from './JakimBenchmark.jsx'
import { RACE_BY_DATE } from './lib/season.js'
import { labelOf, fmtHM } from './lib/corosplan.js'
import { cfgOf } from './lib/zones.js'

const RULES = ['Sleep HR ≤ 67 bpm for hard sessions', 'Sleep HRV not Reduced for quality / TT', 'Pain while running < 2/10 (≥ 2 = durability event)', 'Tibia not tender before Lower', 'Meal buffer ≥ 90 min for hard sessions']
const cpOf = (d) => d?.tags.find((t) => /^CP\d+$/.test(t))

// One full page per training day: prescription, structure, pre-workout gate, shoe, what was actually run.
export default function DayPage({ date, vdot, settings, go }) {
  const T = today(), [scale] = useStore('lumpad.scale', {}), d = effectiveDay(BY_DATE[date], scale.items?.[date], T)
  const [f] = useStore('lumpad.daily.' + date, EMPTY_DAY), [regs] = useStore('lumpad.registrations', {})
  const CP = useCorosPlan(), G = useApi('/api/gear'), A = useApi(`/api/activities/merged?from=${date}&to=${date}`)
  if (!d) return <section className="screen">
    <div className="card prof-cmd">
      <div className="prof-cmd-top">
        <div><h1>Day Plan</h1><p className="sub">{fmtLong(date)} — outside the season plan</p></div>
        <button className="btn primary sm" onClick={() => go('calendar')}>← Back to Calendar</button>
      </div>
    </div>
  </section>

  const prev = BY_DATE[addDays(date, -1)] ? addDays(date, -1) : null
  const next = BY_DATE[addDays(date, 1)] ? addDays(date, 1) : null
  const cp = cpOf(d), reg = regs?.[date], hard = HARD.has(d.kind)
  const g = evaluate(f, d), checked = hasInput(f), isToday = date === T, past = date < T
  const shoe = pickShoe(d, G.data, settings.shoeRoles), acts = (A.data || []).filter((a) => a.sport_class === 'run')
  const away = diffDays(date, T), cr = CP.map[date], inCoros = CP.rows.length && date >= CP.rows[0].date && date <= CP.rows.at(-1).date
  const cfg = cfgOf(settings)

  const corosCard = inCoros ? <Card title="On your COROS watch" right={<Chip tone={CP.live ? 'green' : undefined}>{CP.live ? 'live' : 'snapshot'}</Chip>}>
    {d.src === 'coros' && d.from && d.from !== date && <p className="muted">Re-timed from COROS plan A ({fmtLong(d.from)}) so the cycle aligns with race day.</p>}
    {cr ? <>
      <p><b>{labelOf(cr)}</b>{cr.km ? ` · ${cr.km} km` : ' · no distance target'}{cr.sec ? ` · ${fmtHM(cr.sec)}` : ''}{cr.tl ? ` · ${cr.tl} TL` : ''}</p>
      {cr.km !== d.km ? <p className="muted">Season plan {d.km || 0} km, watch {cr.km || 0} km ({(cr.km || 0) - d.km >= 0 ? '+' : ''}{Math.round(((cr.km || 0) - d.km) * 10) / 10} km).</p> : <p className="muted">Matches season plan.</p>}
    </> : <p className="muted">{d.km > 0 ? `Watch has no workout on this day (season plan: ${d.km} km).` : 'Rest in both plans.'}</p>}
    {(CP.all[date] || []).filter((x) => x.type === 'strength').map((x, i) => <p key={i} className="muted">+ {labelOf(x)} · {fmtHM(x.sec)} (COROS)</p>)}
  </Card> : null

  return <section className="screen">
    {/* Unified Top Back & Day Stepper Command Bar */}
    <div className="card prof-cmd">
      <div className="prof-cmd-top">
        <div className="prof-chips">
          <button type="button" className="btn sm" onClick={() => go('calendar')}><Icon n="left" size={16} /> Back to Calendar</button>
          <StatusPill tone="cobalt">{d.week} · {PHASE_NAME[d.phase] || d.phase}</StatusPill>
          <span className="muted mono" style={{ fontSize: '.78rem' }}>{fmtLong(date)}{isToday ? ' · Today' : away > 0 ? ` · in ${away}d` : ''}</span>
        </div>
        <div className="prof-chips">
          <button type="button" className="btn sm" disabled={!prev} onClick={() => prev && go('calendar', prev)}>← Previous Day</button>
          {!isToday && <button type="button" className="btn sm" onClick={() => go('calendar', T)}>Today</button>}
          <button type="button" className="btn sm" disabled={!next} onClick={() => next && go('calendar', next)}>Next Day →</button>
        </div>
      </div>
    </div>

    <div className="bio-split-75">
      <div>
        <Card className={`sess k-${d.kind}`}>
          <div className="prof-cmd-top" style={{ marginBottom: 10 }}>
            <div>
              <div className="chips" style={{ margin: '0 0 6px' }}>
                <Chip kind={d.kind}>{KIND[d.kind].label}</Chip>
                {cp && <Chip tone="cp">{cp}</Chip>}
                {reg && <Chip tone="green">Registered ✓{reg.bib ? ` · BIB ${reg.bib}` : ''}</Chip>}
                <StrengthChips day={d} />
                {d.scaled && <Chip tone="yellow">Auto-scaled · was {d.plannedLabel}{d.plannedKm ? ` ${d.plannedKm} km` : ''}</Chip>}
              </div>
              <h2 className="sess-title" style={{ margin: 0 }}>{d.label || KIND[d.kind].label}</h2>
            </div>
            {d.km > 0 && <div className="bigkm" style={{ margin: 0 }}><b>{d.km}</b><span>km</span></div>}
          </div>
          {d.km > 0 ? <>
            <WorkoutLine day={d} />
            {mainTarget(d, cfg) && <p className="wtarget" style={{ marginTop: 8 }}><b>{mainTarget(d, cfg)}</b></p>}
          </> : <p className="muted">{d.kind === 'gym' ? 'Gym day — no running.' : d.src === 'coros' && d.kind !== 'rest' ? 'Free-mode run in COROS — run by feel (easy).' : 'Rest day.'}</p>}
          {d.note && <p className="note">{d.note}</p>}
          {d.event && <p className="note">♥ {d.event}</p>}
          {reg && <p className="note">{reg.event} · {reg.distance} · {reg.category}{reg.start ? ` · ${reg.start} → ${reg.finish}` : ''}</p>}
        </Card>

        <SessionBrief day={d} dailyCheckin={f} vdot={vdot} />
        {stepsFor(d).length > 0 && <Card title="Workout Segments & Target Paces" right={<Chip>VDOT {vdot.v.toFixed(1)}</Chip>}>
          <WorkoutDetail day={d} settings={settings} />
        </Card>}
        {corosCard}
        {RACE_BY_DATE[date]?.route === 'jakim' && <JakimBenchmark settings={settings} compact onOpen={() => go('route')} />}
        {RACE_BY_DATE[date]?.route && <CourseMap routeId={RACE_BY_DATE[date].route} pace={RACE_BY_DATE[date].pace?.[1]} goal="sub 5:00" go={go} />}

        <Card title={past || isToday ? 'Plan vs Actual' : 'Actual Execution'}>
          {A.state === 'loading' && <div className="skel" style={{ height: 56 }} />}
          {A.state === 'ok' && !acts.length && <p className="muted">{date > T ? 'Has not happened yet.' : 'No run recorded on this day.'}</p>}
          {acts.map((a) => <button key={a.id} className="rowbtn plain" onClick={() => go('activity', { id: (a.ids?.[0] || a.id) })}><span className="kdot k-arun" /><span><b>{a.name}</b><small>{(a.distance_m / 1000).toFixed(2)} km · {fmtDur(a.duration_s)}{a.avg_pace_s_km ? ' · ' + fmtPaceS(a.avg_pace_s_km) + '/km' : ''}{a.avg_hr ? ' · ' + a.avg_hr + ' bpm' : ''}{d.km ? ` · ${Math.round(((a.distance_m / 1000) / d.km) * 100)}% of plan` : ''}</small></span><Icon n="chev" size={18} /></button>)}
        </Card>
      </div>

      <div>
        <Card title="Pre-Workout Gate & Readiness" tone={isToday && checked ? { green: 'green', yellow: undefined, red: 'red' }[g.level] : undefined}>
          {isToday || checked ? <>
            {checked ? <><p><b>{{ green: 'Run as planned', yellow: 'Scale down / caution', red: 'Swap to easy or rest' }[g.level]}</b></p>
              <ul className="rules">{g.reasons.length ? g.reasons.map((r, i) => <li key={i}>{r.msg}</li>) : <li>No red flags from the check-in.</li>}</ul></> : <p className="muted">Morning check-in not filled in yet.</p>}
            <button className="btn primary sm full" onClick={() => go('ready')}>{checked ? 'Open Readiness' : 'Fill in Check-in'}</button></>
            : <><p className="muted">{hard ? 'Hard session — evaluated on the morning of the day:' : 'Easy is fine when healthy. Gate for hard sessions:'}</p><ul className="rules">{RULES.map((r) => <li key={r}>{r}</li>)}</ul></>}
        </Card>
        {d.km > 0 && <Card title="Recommended Shoe Pairing">
          {shoe ? <p><b>{shoe.name}</b><br /><span className="muted">Role matches session type · last used {shoe.last_used || '—'}</span></p> : <p className="muted">No shoe assigned to this role yet. <button className="link" onClick={() => go('profile')}>Set in Profile</button></p>}
        </Card>}
        {(cp || d.kind === 'race' || reg) && <Card title="Related Milestones">
          {cp && <button className="rowbtn plain" onClick={() => go('calendar', { view: 'cp', id: +cp.slice(2) })}><span className="kdot k-tt" /><span><b>{cp}</b><small>Open in Checkpoints</small></span><Icon n="chev" size={18} /></button>}
          {(d.kind === 'race' || reg) && <button className="rowbtn plain" onClick={() => go('race')}><span className="kdot k-race" /><span><b>Races Hub</b><small>Strategy, COPs, taper</small></span><Icon n="chev" size={18} /></button>}
        </Card>}
      </div>
    </div>
  </section>
}
