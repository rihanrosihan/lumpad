import { useStore } from './store.js'
import { paces, fmtPace } from './lib/vdot.js'
import { sessionPaces } from './lib/pace.js'
import { evaluate, EMPTY_DAY, hasInput } from './lib/gate.js'
import { BY_DATE, PLAN, today, diffDays, fmtLong, fmtShort, addDays, mondayOf, weekOf, DAYS3, KIND, PHASE_NAME, RACE_DATE, PLAN_START } from './lib/calendar.js'
import { CHECKPOINTS, TARGET, cpDistance } from './lib/plan.js'
import { raceTime, fmtTime } from './lib/vdot.js'
import { Card, Chip, Screen, StrengthChips, Icon } from './ui.jsx'
import { useSyncStatus2, wib, ago } from './sync.js'

export const thresholds = (c) => { const d = cpDistance(c); return d && c.line ? { G: fmtTime(raceTime(c.line - 0.5, d)), R: fmtTime(raceTime(c.line - 1.5, d)) } : null }
const GATE = { green: ['Jalankan', 'Semua sinyal aman'], yellow: ['Turunkan', 'Kurangi intensitas'], red: ['Ganti easy / istirahat', 'Jangan paksa'] }

export default function Home({ vdot, results, go }) {
  const T = today(), day = BY_DATE[T], p = paces(vdot.v)
  const [f] = useStore('lumpad.daily.' + T, EMPTY_DAY)
  const sync = useSyncStatus2()
  const g = evaluate(f, day), checked = hasInput(f)
  const toRace = diffDays(RACE_DATE, T), beforePlan = T < PLAN_START
  const nextCp = CHECKPOINTS.find((c) => c.date >= T), th = nextCp && thresholds(nextCp)
  const wk = day ? weekOf(T) : null
  const monday = mondayOf(T), strip = Array.from({ length: 7 }, (_, i) => addDays(monday, i))
  const pct = Math.max(0, Math.min(1, (vdot.v - TARGET.baseline) / (TARGET.vdotNeeded - TARGET.baseline)))
  const upcoming = PLAN.filter((d) => d.date >= T && d.km > 0).slice(0, 3)

  return <Screen title={fmtLong(T).split(',')[0]} sub={fmtLong(T).split(', ')[1]} right={<div className="pill" title="Hari menuju JRF"><b>H-{Math.max(0, toRace)}</b><small>JRF 24 Okt</small></div>}>
    <button className={`fresh ${sync === null ? 'warn' : sync?.lastRun ? (sync.lastRun.ok ? 'ok' : 'warn') : 'none'}`} onClick={() => go('profile')}>
      <i />{sync === undefined ? 'Memeriksa sync…' : sync === null ? 'Status sync tidak terjangkau — data bisa usang' : sync?.lastRun ? <>Sync {ago(sync.lastRun.received_at)} · {wib(sync.lastRun.received_at)} WIB{sync.latestHealth ? ` · tidur ${sync.latestHealth.slice(5)}` : ''}{!sync.lastRun.ok && ' · ada yang ditolak'}</> : 'Belum ada sync — data COROS/Strava belum masuk'}
    </button>
    <button className={`gatecard g-${checked ? g.level : 'none'}`} onClick={() => go('ready')}>
      <span className="gdot" />
      <span className="gtxt"><b>{checked ? 'Gate: ' + GATE[g.level][0] : 'Belum check-in pagi'}</b>
        <small>{checked ? (g.reasons.find((r) => r.level !== 'info')?.msg || GATE[g.level][1]) : 'Ketuk untuk isi 4 data (±15 detik) — gate menentukan sesi hari ini'}</small></span>
      <Icon n="chev" size={18} />
    </button>

    {day ? <Card className={`sess k-${day.kind}`}>
      <div className="sess-top"><Chip kind={day.kind}>{KIND[day.kind].label}</Chip><span className="muted">{wk?.id} · {PHASE_NAME[day.phase] || day.phase}</span></div>
      <h2 className="sess-title">{day.label || KIND[day.kind].label}</h2>
      {day.km > 0 ? <div className="bigkm"><b>{day.km}</b><span>km</span></div> : <p className="muted">{day.kind === 'gym' ? 'Hari gym — tanpa lari' : 'Rest day'}</p>}
      <div className="chips"><StrengthChips day={day} />{day.tags.filter((t) => /^CP|^MP/.test(t)).map((t) => <Chip key={t} tone="cp">{t}</Chip>)}</div>
      {sessionPaces(day, p).length > 0 && <dl className="pace">{sessionPaces(day, p).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>}
      {day.note && <p className="note">{day.note}</p>}
      {day.event && <p className="note">♥ {day.event}</p>}
      <p className="src">Pace dari VDOT {vdot.v.toFixed(1)} · {vdot.src}</p>
    </Card> : <Card title={beforePlan ? 'Plan 2027 belum mulai' : 'Di luar plan'}>
      <p className="muted">{beforePlan ? `Hari pertama di kalender: ${fmtShort(PLAN_START)} (W0 mulai Senin 28 Des). Sementara: easy, jaga volume, rehab.` : 'Tidak ada sesi terjadwal.'}</p>
      {beforePlan && <><h3 className="mini">Berikutnya</h3>{upcoming.map((d) => <button key={d.date} className="rowbtn" onClick={() => go('calendar', d.date)}><span className={`kdot k-${d.kind}`} /><span><b>{d.label}</b><small>{fmtLong(d.date)}</small></span><b>{d.km} km</b></button>)}</>}
    </Card>}

    <Card className="tight" title="Minggu ini" right={wk && <span className="muted">{wk.id} · {wk.km} km</span>}>
      <div className="strip">{strip.map((s, i) => { const d = BY_DATE[s]; return <button key={s} aria-current={s === T ? 'date' : undefined} aria-label={`${fmtLong(s)}: ${d ? (d.label || KIND[d.kind].label) + (d.km ? ', ' + d.km + ' km' : '') : 'tidak ada sesi'}`} className={`sc ${s === T ? 'today' : ''} ${d ? 'k-' + d.kind : 'k-none'}`} onClick={() => go('calendar', s)}>
        <small>{DAYS3[(i + 1) % 7]}</small><b>{d && d.km ? d.km : '–'}</b><i>{d ? KIND[d.kind].short : ''}</i></button> })}</div>
    </Card>

    {nextCp && <Card title="Checkpoint berikutnya" right={<span className="muted">{diffDays(nextCp.date, T) === 0 ? 'Hari ini' : diffDays(nextCp.date, T) + ' hari'}</span>}>
      <button className="rowbtn plain" onClick={() => go('checkpoints', nextCp.id)}>
        <span className="cpn">CP{nextCp.id}</span><span><b>{nextCp.name}</b><small>{fmtLong(nextCp.date)}</small></span><Icon n="chev" size={18} /></button>
      {th && <p className="thr"><Chip tone="green">Hijau ≤ {th.G}</Chip> <Chip tone="red">Merah &gt; {th.R}</Chip> <span className="muted">garis VDOT {nextCp.line.toFixed(1)}</span></p>}
    </Card>}

    <Card title="Fitness menuju sub-4" right={<span className="muted">{vdot.v.toFixed(1)} → {TARGET.vdotNeeded}</span>}>
      <div className="bar"><i style={{ width: pct * 100 + '%' }} /><em style={{ left: ((TARGET.vdotRace - TARGET.baseline) / (TARGET.vdotNeeded - TARGET.baseline)) * 100 + '%' }} title="VDOT race 37.9" /></div>
      <p className="muted">Butuh {(TARGET.vdotNeeded - vdot.v).toFixed(1)} VDOT lagi · 1,02/bln vs laju terbaik teramati 0,74 <Chip>HYPOTHESIS n=2</Chip></p>
      <p className="muted">Race pace sub-4: <b>{TARGET.mp}/km</b> (dipakai setelah CP14 & CP16 bersih)</p>
    </Card>
  </Screen>
}
