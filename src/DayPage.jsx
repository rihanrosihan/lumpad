import { useStore } from './store.js'
import { paces } from './lib/vdot.js'
import { sessionPaces } from './lib/pace.js'
import { evaluate, EMPTY_DAY, hasInput, HARD } from './lib/gate.js'
import { sessionSteps } from './lib/analysis.js'
import { pickShoe } from './lib/shoes.js'
import { BY_DATE, today, addDays, fmtLong, diffDays, KIND, PHASE_NAME } from './lib/calendar.js'
import { Card, Chip, Screen, StrengthChips, Icon } from './ui.jsx'
import { useApi, fmtDur, fmtPaceS } from './api.js'
import { StepChart } from './charts2.jsx'

const RULES = ['Sleep HR ≤ 67 bpm for hard sessions', 'Sleep HRV not Reduced for quality / TT', 'Pain while running < 2/10 (≥ 2 = durability event)', 'Tibia not tender before Lower', 'Meal buffer ≥ 90 min for hard sessions']
const cpOf = (d) => d?.tags.find((t) => /^CP\d+$/.test(t))

// One full page per training day: prescription, structure, pre-workout gate, shoe, what was actually run.
export default function DayPage({ date, vdot, settings, go }) {
  const T = today(), d = BY_DATE[date], p = paces(vdot.v)
  const [f] = useStore('lumpad.daily.' + date, EMPTY_DAY), [regs] = useStore('lumpad.registrations', {})
  const G = useApi('/api/gear'), A = useApi(`/api/activities/merged?from=${date}&to=${date}`)
  if (!d) return <Screen title="Day Plan" sub={fmtLong(date)}><div className="card empty"><b>This date is outside the 2027 plan</b>Pick a day from the calendar.</div><button className="btn" onClick={() => go('calendar')}>Go to Calendar</button></Screen>
  const prev = BY_DATE[addDays(date, -1)] ? addDays(date, -1) : null, next = BY_DATE[addDays(date, 1)] ? addDays(date, 1) : null
  const cp = cpOf(d), reg = regs?.[date], steps = sessionSteps(d), pace = sessionPaces(d, p), hard = HARD.has(d.kind)
  const g = evaluate(f, d), checked = hasInput(f), isToday = date === T, past = date < T
  const shoe = pickShoe(d, G.data, settings.shoeRoles), acts = (A.data || []).filter((a) => a.sport_class === 'run')
  const away = diffDays(date, T)
  return <Screen title="Day Plan" sub={`${d.week} · ${PHASE_NAME[d.phase] || d.phase}`}>
    <div className="dbar">
      <button className="btn sm" onClick={() => go('calendar')}><Icon n="left" size={16} />Calendar</button>
      <div className="snav"><button onClick={() => prev && go('calendar', prev)} disabled={!prev} aria-label="Previous day"><Icon n="left" /></button><p>{fmtLong(date)}{isToday ? ' · today' : away > 0 ? ` · in ${away} days` : ''}</p><button onClick={() => next && go('calendar', next)} disabled={!next} aria-label="Next day" className="flip"><Icon n="left" /></button></div>
      {!isToday && <button className="btn sm" onClick={() => go('calendar', T)}>Today</button>}
    </div>
    <div className="dgrid">
      <div className="dmain">
        <Card className={`sess k-${d.kind}`}>
          <div className="sess-top"><Chip kind={d.kind}>{KIND[d.kind].label}</Chip>{cp && <Chip tone="cp">{cp}</Chip>}{reg && <Chip tone="green">registered ✓{reg.bib ? ` · BIB ${reg.bib}` : ''}</Chip>}<StrengthChips day={d} /></div>
          <h2 className="sess-title">{d.label || KIND[d.kind].label}</h2>
          {d.km > 0 ? <div className="bigkm"><b>{d.km}</b><span>km</span></div> : <p className="muted">{d.kind === 'gym' ? 'Gym day — no running.' : 'Rest day.'}</p>}
          {d.note && <p className="note">{d.note}</p>}
          {d.event && <p className="note">♥ {d.event}</p>}
          {reg && <p className="note">{reg.event} · {reg.distance} · {reg.category}{reg.start ? ` · ${reg.start} → ${reg.finish}` : ''}</p>}
        </Card>
        {d.km > 0 && <Card title="Prescription & structure" right={<Chip>VDOT {vdot.v.toFixed(1)}</Chip>}>
          {steps.length > 1 && <StepChart steps={steps} />}
          {pace.length > 0 ? <dl className="pace">{pace.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl> : <p className="muted">No pace target for this session.</p>}
          <p className="src">Pace from {vdot.src} · structure from the plan label (WU 2 / CD 1 km) [calc]</p>
        </Card>}
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
