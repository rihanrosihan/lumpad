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

const RULES = ['Sleep HR ≤ 67 bpm untuk sesi keras', 'HRV tidur tidak Reduced untuk quality / TT', 'Nyeri saat lari < 2/10 (≥ 2 = durability event)', 'Tibia tidak nyeri tekan sebelum Lower', 'Buffer makan ≥ 90 menit untuk sesi keras']
const cpOf = (d) => d?.tags.find((t) => /^CP\d+$/.test(t))

// One full page per training day: prescription, structure, pre-workout gate, shoe, what was actually run.
export default function DayPage({ date, vdot, settings, go }) {
  const T = today(), d = BY_DATE[date], p = paces(vdot.v)
  const [f] = useStore('lumpad.daily.' + date, EMPTY_DAY), [regs] = useStore('lumpad.registrations', {})
  const G = useApi('/api/gear'), A = useApi(`/api/activities/merged?from=${date}&to=${date}`)
  if (!d) return <Screen title="Day Plan" sub={fmtLong(date)}><div className="card empty"><b>Tanggal ini di luar plan 2027</b>Pilih hari dari kalender.</div><button className="btn" onClick={() => go('calendar')}>Ke Calendar</button></Screen>
  const prev = BY_DATE[addDays(date, -1)] ? addDays(date, -1) : null, next = BY_DATE[addDays(date, 1)] ? addDays(date, 1) : null
  const cp = cpOf(d), reg = regs?.[date], steps = sessionSteps(d), pace = sessionPaces(d, p), hard = HARD.has(d.kind)
  const g = evaluate(f, d), checked = hasInput(f), isToday = date === T, past = date < T
  const shoe = pickShoe(d, G.data, settings.shoeRoles), acts = (A.data || []).filter((a) => a.sport_class === 'run')
  const away = diffDays(date, T)
  return <Screen title="Day Plan" sub={`${d.week} · ${PHASE_NAME[d.phase] || d.phase}`}>
    <div className="dbar">
      <button className="btn sm" onClick={() => go('calendar')}><Icon n="left" size={16} />Calendar</button>
      <div className="snav"><button onClick={() => prev && go('calendar', prev)} disabled={!prev} aria-label="Hari sebelumnya"><Icon n="left" /></button><p>{fmtLong(date)}{isToday ? ' · hari ini' : away > 0 ? ` · ${away} hari lagi` : ''}</p><button onClick={() => next && go('calendar', next)} disabled={!next} aria-label="Hari berikutnya" className="flip"><Icon n="left" /></button></div>
      {!isToday && <button className="btn sm" onClick={() => go('calendar', T)}>Hari ini</button>}
    </div>
    <div className="dgrid">
      <div className="dmain">
        <Card className={`sess k-${d.kind}`}>
          <div className="sess-top"><Chip kind={d.kind}>{KIND[d.kind].label}</Chip>{cp && <Chip tone="cp">{cp}</Chip>}{reg && <Chip tone="green">terdaftar ✓{reg.bib ? ` · BIB ${reg.bib}` : ''}</Chip>}<StrengthChips day={d} /></div>
          <h2 className="sess-title">{d.label || KIND[d.kind].label}</h2>
          {d.km > 0 ? <div className="bigkm"><b>{d.km}</b><span>km</span></div> : <p className="muted">{d.kind === 'gym' ? 'Hari gym — tanpa lari.' : 'Hari istirahat.'}</p>}
          {d.note && <p className="note">{d.note}</p>}
          {d.event && <p className="note">♥ {d.event}</p>}
          {reg && <p className="note">{reg.event} · {reg.distance} · {reg.category}{reg.start ? ` · ${reg.start} → ${reg.finish}` : ''}</p>}
        </Card>
        {d.km > 0 && <Card title="Preskripsi & struktur" right={<Chip>VDOT {vdot.v.toFixed(1)}</Chip>}>
          {steps.length > 1 && <StepChart steps={steps} />}
          {pace.length > 0 ? <dl className="pace">{pace.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl> : <p className="muted">Tidak ada target pace untuk sesi ini.</p>}
          <p className="src">Pace dari {vdot.src} · struktur dari label rencana (WU 2 / CD 1 km) [calc]</p>
        </Card>}
        <Card title={past || isToday ? 'Rencana vs aktual' : 'Aktual'}>
          {A.state === 'loading' && <div className="skel" style={{ height: 56 }} />}
          {A.state === 'ok' && !acts.length && <p className="muted">{date > T ? 'Belum terjadi.' : 'Tidak ada lari tercatat di hari ini.'}</p>}
          {acts.map((a) => <button key={a.id} className="rowbtn plain" onClick={() => go('activity', { id: a.ids[0] })}><span className="kdot k-arun" /><span><b>{a.name}</b><small>{(a.distance_m / 1000).toFixed(2)} km · {fmtDur(a.duration_s)}{a.avg_pace_s_km ? ' · ' + fmtPaceS(a.avg_pace_s_km) + '/km' : ''}{a.avg_hr ? ' · ' + a.avg_hr + ' bpm' : ''}{d.km ? ` · ${Math.round(((a.distance_m / 1000) / d.km) * 100)}% dari rencana` : ''}</small></span><Icon n="chev" size={18} /></button>)}
        </Card>
      </div>
      <div className="dside">
        <Card title="Gate pra-latihan" tone={isToday && checked ? { green: 'green', yellow: undefined, red: 'red' }[g.level] : undefined}>
          {isToday || checked ? <>
            {checked ? <><p><b>{{ green: 'Jalankan sesuai rencana', yellow: 'Turunkan / waspada', red: 'Ganti easy atau istirahat' }[g.level]}</b></p>
              <ul className="rules">{g.reasons.length ? g.reasons.map((r, i) => <li key={i}>{r.msg}</li>) : <li>Tidak ada sinyal merah dari check-in.</li>}</ul></> : <p className="muted">Check-in pagi belum diisi.</p>}
            <button className="btn sm full" onClick={() => go('ready')}>{checked ? 'Buka Readiness' : 'Isi check-in'}</button></>
            : <><p className="muted">{hard ? 'Sesi keras — gate dievaluasi pagi hari-H:' : 'Easy tetap boleh bila sehat. Gate untuk sesi keras:'}</p><ul className="rules">{RULES.map((r) => <li key={r}>{r}</li>)}</ul>
              {date > T ? <p className="src">Diisi di Readiness pada hari itu.</p> : null}</>}
        </Card>
        {d.km > 0 && <Card title="Sepatu">
          {shoe ? <p><b>{shoe.name}</b><br /><span className="muted">peran sesuai jenis sesi · terakhir dipakai {shoe.last_used || '—'}</span></p> : <p className="muted">Belum ada sepatu untuk peran ini. <button className="link" onClick={() => go('profile')}>Atur di Profil</button></p>}
        </Card>}
        {(cp || d.kind === 'race' || reg) && <Card title="Terkait">
          {cp && <button className="rowbtn plain" onClick={() => go('calendar', { view: 'cp', id: +cp.slice(2) })}><span className="kdot k-tt" /><span><b>{cp}</b><small>Buka di Checkpoints</small></span><Icon n="chev" size={18} /></button>}
          {(d.kind === 'race' || reg) && <button className="rowbtn plain" onClick={() => go('race')}><span className="kdot k-race" /><span><b>Race hub</b><small>Strategi, COP, taper</small></span><Icon n="chev" size={18} /></button>}
        </Card>}
      </div>
    </div>
  </Screen>
}
