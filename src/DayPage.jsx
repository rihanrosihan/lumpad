import { useStore } from './store.js'
import { paces } from './lib/vdot.js'
import { evaluate, EMPTY_DAY, hasInput, HARD } from './lib/gate.js'
import { pickShoe } from './lib/shoes.js'
import { BY_DATE, today, addDays, fmtLong, diffDays, KIND, PHASE_NAME } from './lib/calendar.js'
import { Card, Chip, Screen, StrengthChips, Icon } from './ui.jsx'
import { useApi, fmtDur, fmtPaceS } from './api.js'
import { WorkoutDetail, stepsFor } from './Workout.jsx'
import { effectiveDay } from './lib/scaler.js'
import { useCorosPlan } from './useCoros.js'
import { labelOf, fmtHM } from './lib/corosplan.js'

const RULES = ['Sleep HR ≤ 67 bpm for hard sessions', 'Sleep HRV not Reduced for quality / TT', 'Pain while running < 2/10 (≥ 2 = durability event)', 'Tibia not tender before Lower', 'Meal buffer ≥ 90 min for hard sessions']
const cpOf = (d) => d?.tags.find((t) => /^CP\d+$/.test(t))

// One full page per training day: prescription, structure, pre-workout gate, shoe, what was actually run.
export default function DayPage({ date, vdot, settings, go }) {
  const T = today(), [scale] = useStore('lumpad.scale', {}), d = effectiveDay(BY_DATE[date], scale.items?.[date], T), p = paces(vdot.v)
  const [f] = useStore('lumpad.daily.' + date, EMPTY_DAY), [regs] = useStore('lumpad.registrations', {})
  const CP = useCorosPlan(), G = useApi('/api/gear'), A = useApi(`/api/activities/merged?from=${date}&to=${date}`)
  if (!d) return <Screen title="Day Plan" sub={fmtLong(date)}><div className="card empty"><b>This date is outside the season plan</b>Pick a day from the calendar.</div><button className="btn" onClick={() => go('calendar')}>Go to Calendar</button></Screen>
  const prev = BY_DATE[addDays(date, -1)] ? addDays(date, -1) : null, next = BY_DATE[addDays(date, 1)] ? addDays(date, 1) : null
  const cp = cpOf(d), reg = regs?.[date], hard = HARD.has(d.kind)
  const g = evaluate(f, d), checked = hasInput(f), isToday = date === T, past = date < T
  const shoe = pickShoe(d, G.data, settings.shoeRoles), acts = (A.data || []).filter((a) => a.sport_class === 'run')
  const away = diffDays(date, T), cr = CP.map[date], inCoros = CP.rows.length && date >= CP.rows[0].date && date <= CP.rows.at(-1).date
  const corosCard = inCoros ? <Card title="On your COROS watch" right={<Chip tone={CP.live ? 'green' : undefined}>{CP.live ? 'live' : 'snapshot'}</Chip>}>
    {d.src === 'coros' && d.from && d.from !== date && <p className="muted">The season runs the COROS plan A session originally scheduled for {fmtLong(d.from)} on this date (re-timed so the cycle ends on the real race). The watch currently has:</p>}
    {cr ? <>
      <p><b>{labelOf(cr)}</b>{cr.km ? ` · ${cr.km} km` : ' · no distance target'}{cr.sec ? ` · ${fmtHM(cr.sec)}` : ''}{cr.tl ? ` · ${cr.tl} TL` : ''}</p>
      {cr.km !== d.km ? <p className="muted">Season plan {d.km || 0} km, watch {cr.km || 0} km ({(cr.km || 0) - d.km >= 0 ? '+' : ''}{Math.round(((cr.km || 0) - d.km) * 10) / 10} km).</p> : <p className="muted">Same as the season plan.</p>}
    </> : <p className="muted">{d.km > 0 ? `The watch has no workout on this day (season plan: ${d.km} km).` : 'No COROS workout — rest in both plans.'}</p>}
    {(CP.all[date] || []).filter((x) => x.type === 'strength').map((x, i) => <p key={i} className="muted">+ {labelOf(x)} · {fmtHM(x.sec)} (COROS)</p>)}
  </Card> : null
  return <Screen title="Day Plan" sub={`${d.week} · ${PHASE_NAME[d.phase] || d.phase}`}>
    <div className="dbar">
      <button className="btn sm" onClick={() => go('calendar')}><Icon n="left" size={16} />Calendar</button>
      <div className="snav"><button onClick={() => prev && go('calendar', prev)} disabled={!prev} aria-label="Previous day"><Icon n="left" /></button><p>{fmtLong(date)}{isToday ? ' · today' : away > 0 ? ` · in ${away} days` : ''}</p><button onClick={() => next && go('calendar', next)} disabled={!next} aria-label="Next day" className="flip"><Icon n="left" /></button></div>
      {!isToday && <button className="btn sm" onClick={() => go('calendar', T)}>Today</button>}
    </div>
    <div className="dgrid">
      <div className="dmain">
        <Card className={`sess k-${d.kind}`}>
          <div className="sess-top"><Chip kind={d.kind}>{KIND[d.kind].label}</Chip>{cp && <Chip tone="cp">{cp}</Chip>}{reg && <Chip tone="green">registered ✓{reg.bib ? ` · BIB ${reg.bib}` : ''}</Chip>}<StrengthChips day={d} />{d.scaled && <Chip tone="yellow">auto-scaled · was {d.plannedLabel}{d.plannedKm ? ` ${d.plannedKm} km` : ''}</Chip>}</div>
          <h2 className="sess-title">{d.label || KIND[d.kind].label}</h2>
          {d.km > 0 ? <div className="bigkm"><b>{d.km}</b><span>km</span></div> : <p className="muted">{d.kind === 'gym' ? 'Gym day — no running.' : d.src === 'coros' && d.kind !== 'rest' ? 'Free-mode run in COROS — no distance target; run by feel (easy).' : 'Rest day.'}</p>}
          {d.note && <p className="note">{d.note}</p>}
          {d.event && <p className="note">♥ {d.event}</p>}
          {reg && <p className="note">{reg.event} · {reg.distance} · {reg.category}{reg.start ? ` · ${reg.start} → ${reg.finish}` : ''}</p>}
        </Card>
        {stepsFor(d).length > 0 && <Card title="Workout" right={<Chip>{PHASE_NAME[d.phase] || d.phase}</Chip>}>
          <WorkoutDetail day={d} settings={settings} />
        </Card>}
        {corosCard}
        <Card title={past || isToday ? 'Plan vs actual' : 'Actual'}>
          {A.state === 'loading' && <div className="skel" style={{ height: 56 }} />}
          {A.state === 'ok' && !acts.length && <p className="muted">{date > T ? 'Has not happened yet.' : 'No run recorded on this day.'}</p>}
          {acts.map((a) => <button key={a.id} className="rowbtn plain" onClick={() => go('activity', { id: a.ids[0] })}><span className="kdot k-arun" /><span><b>{a.name}</b><small>{(a.distance_m / 1000).toFixed(2)} km · {fmtDur(a.duration_s)}{a.avg_pace_s_km ? ' · ' + fmtPaceS(a.avg_pace_s_km) + '/km' : ''}{a.avg_hr ? ' · ' + a.avg_hr + ' bpm' : ''}{d.km ? ` · ${Math.round(((a.distance_m / 1000) / d.km) * 100)}% of plan` : ''}</small></span><Icon n="chev" size={18} /></button>)}
        </Card>
      </div>
      <div className="dside">
        <Card title="Pre-workout gate" tone={isToday && checked ? { green: 'green', yellow: undefined, red: 'red' }[g.level] : undefined}>
          {isToday || checked ? <>
            {checked ? <><p><b>{{ green: 'Run as planned', yellow: 'Scale down / caution', red: 'Swap to easy or rest' }[g.level]}</b></p>
              <ul className="rules">{g.reasons.length ? g.reasons.map((r, i) => <li key={i}>{r.msg}</li>) : <li>No red flags from the check-in.</li>}</ul></> : <p className="muted">Morning check-in not filled in yet.</p>}
            <button className="btn sm full" onClick={() => go('ready')}>{checked ? 'Open Readiness' : 'Fill in check-in'}</button></>
            : <><p className="muted">{hard ? 'Hard session — the gate is evaluated on the morning of the day:' : 'Easy is fine when healthy. Gate for hard sessions:'}</p><ul className="rules">{RULES.map((r) => <li key={r}>{r}</li>)}</ul>
              {date > T ? <p className="src">Filled in on Readiness on that day.</p> : null}</>}
        </Card>
        {d.km > 0 && <Card title="Shoe">
          {shoe ? <p><b>{shoe.name}</b><br /><span className="muted">role matches the session type · last used {shoe.last_used || '—'}</span></p> : <p className="muted">No shoe assigned to this role yet. <button className="link" onClick={() => go('profile')}>Set in Profile</button></p>}
        </Card>}
        {(cp || d.kind === 'race' || reg) && <Card title="Related">
          {cp && <button className="rowbtn plain" onClick={() => go('calendar', { view: 'cp', id: +cp.slice(2) })}><span className="kdot k-tt" /><span><b>{cp}</b><small>Open in Checkpoints</small></span><Icon n="chev" size={18} /></button>}
          {(d.kind === 'race' || reg) && <button className="rowbtn plain" onClick={() => go('race')}><span className="kdot k-race" /><span><b>Race hub</b><small>Strategy, COPs, taper</small></span><Icon n="chev" size={18} /></button>}
        </Card>}
      </div>
    </div>
  </Screen>
}
