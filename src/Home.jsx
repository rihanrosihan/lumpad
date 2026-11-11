import { useStore } from './store.js'
import { paces, raceTime, fmtTime } from './lib/vdot.js'
import { sessionPaces } from './lib/pace.js'
import { evaluate, EMPTY_DAY, hasInput } from './lib/gate.js'
import { BY_DATE, today, diffDays, fmtLong, fmtShort, addDays, mondayOf, weekOf, DAYS3, KIND, PHASE_NAME, PLAN_START } from './lib/calendar.js'
import { CHECKPOINTS, TARGET, cpDistance } from './lib/plan.js'
import { fitnessSeries, latestOn, sleepSummary, hrvSummary, acwrZone, volumeRamp } from './lib/metrics.js'
import { Card, Chip, Screen, StrengthChips, Icon } from './ui.jsx'
import { useSyncStatus2, wib, ago, hrvLow } from './sync.js'
import { useApi, hm, fmtDur, fmtPaceS } from './api.js'

export const thresholds = (c) => { const d = cpDistance(c); return d && c.line ? { G: fmtTime(raceTime(c.line - 0.5, d)), R: fmtTime(raceTime(c.line - 1.5, d)) } : null }
const GATE = { green: ['Jalankan', 'Semua sinyal aman'], yellow: ['Turunkan', 'Kurangi intensitas'], red: ['Ganti easy / istirahat', 'Jangan paksa'] }
const sign = (n) => (n == null ? '—' : (n > 0 ? '+' : '') + n)

// Home = one-screen summary. Order follows the pre-run decision: can I run → what → how ready am I → how is the week going → what's next.
export default function Home({ vdot, settings, go }) {
  const T = today(), day = BY_DATE[T], p = paces(vdot.v)
  const [f] = useStore('lumpad.daily.' + T, EMPTY_DAY)
  const sync = useSyncStatus2(), R = useApi(`/api/readiness?from=${addDays(T, -70)}&to=${T}`), A = useApi(`/api/activities/merged?from=${addDays(T, -35)}&to=${T}`)
  const g = evaluate(f, day), checked = hasInput(f), beforePlan = T < PLAN_START
  const nextCp = CHECKPOINTS.find((c) => c.date >= T), th = nextCp && thresholds(nextCp), toRace = diffDays(settings.raceDate, T)
  const wk = day ? weekOf(T) : null, monday = mondayOf(T), strip = Array.from({ length: 7 }, (_, i) => addDays(monday, i))
  const health = R.data?.health || [], acts = A.data || [], fs = fitnessSeries(health), cur = latestOn(fs, T, 'fitness'), zone = acwrZone(cur?.acwr)
  const sleep = sleepSummary(health, T), hrv = hrvSummary(health, T), recov = latestOn(health, T, 'recovery_pct')
  const vr = volumeRamp(acts, T), planned = wk ? wk.km : null, last = acts[0]
  const pct = Math.max(0, Math.min(1, (vdot.v - TARGET.baseline) / (TARGET.vdotNeeded - TARGET.baseline)))
  const upcoming = Object.values(BY_DATE).filter((d) => d.date >= T && d.km > 0).slice(0, 3)

  return <Screen title={fmtLong(T).split(',')[0]} sub={fmtLong(T).split(', ')[1]} right={<div className="pill" title="Hari menuju JRF"><b>H-{Math.max(0, toRace)}</b><small>JRF {fmtShort(settings.raceDate)}</small></div>}>
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
      <p className="src">Pace dari VDOT {vdot.v.toFixed(1)} · {vdot.src}</p>
    </Card> : <Card title={beforePlan ? 'Plan 2027 belum mulai' : 'Di luar plan'}>
      <p className="muted">{beforePlan ? `Hari pertama di kalender: ${fmtShort(PLAN_START)}. Sampai itu: easy, jaga volume, rehab.` : 'Tidak ada sesi terjadwal.'}</p>
      {beforePlan && upcoming.map((d) => <button key={d.date} className="rowbtn" onClick={() => go('calendar', d.date)}><span className={`kdot k-${d.kind}`} /><span><b>{d.label}</b><small>{fmtLong(d.date)}</small></span><b>{d.km} km</b></button>)}
    </Card>}

    <h2 className="sech">Kesiapan</h2>
    <div className="tiles">
      <button className="tile" onClick={() => go('ready')}><small>Recovery</small><b>{recov?.recovery_pct != null ? recov.recovery_pct + '%' : '—'}</b><em>{recov?.recovery_level || 'belum ditarik'}</em></button>
      <button className="tile" onClick={() => go('ready')}><small>Tidur</small><b>{sleep ? hm(sleep.total_min) : '—'}</b><em>{sleep?.score != null ? `skor ${sleep.score}` : 'belum ditarik'}</em></button>
      <button className="tile" onClick={() => go('ready')}><small>HRV</small><b>{hrv ? hrv.avg + ' ms' : '—'}</b>{hrv?.status ? <Chip tone={hrvLow(hrv.status) ? 'red' : 'green'}>{hrv.status}</Chip> : <em>belum ditarik</em>}</button>
      <button className="tile" onClick={() => go('ready')}><small>Form · ACWR</small><b>{cur ? sign(cur.form) : '—'}</b>{zone ? <Chip tone={zone.id === 'sweet' ? 'green' : zone.id === 'under' ? undefined : zone.id === 'caution' ? 'yellow' : 'red'}>ACWR {cur.acwr} · {zone.label}</Chip> : <em>belum ditarik</em>}</button>
    </div>

    <Card className="tight" title="Minggu ini" right={wk && <span className="muted">{wk.id}</span>}>
      <div className="strip">{strip.map((s, i) => { const d = BY_DATE[s]; const ran = acts.filter((a) => a.date === s && a.sport_class === 'run').reduce((t, a) => t + a.distance_m / 1000, 0); return <button key={s} aria-current={s === T ? 'date' : undefined} aria-label={`${fmtLong(s)}: ${d ? (d.label || KIND[d.kind].label) + (d.km ? ', rencana ' + d.km + ' km' : '') : 'tidak ada sesi'}${ran ? ', sudah lari ' + ran.toFixed(1) + ' km' : ''}`} className={`sc ${s === T ? 'today' : ''} ${d ? 'k-' + d.kind : 'k-none'}`} onClick={() => go('calendar', s)}>
        <small>{DAYS3[(i + 1) % 7]}</small><b>{d && d.km ? d.km : '–'}</b><i>{ran ? '✓ ' + ran.toFixed(1) : d ? KIND[d.kind].short : ''}</i></button> })}</div>
      {planned != null && <><div className="bar" role="img" aria-label={`Km lari minggu ini ${vr.this_week_km} dari rencana ${planned}`}><i style={{ width: Math.min(100, (vr.this_week_km / planned) * 100) + '%' }} /></div>
        <p className="muted">{vr.this_week_km} / {planned} km rencana · rata-rata 4 minggu {vr.avg4_km ?? '—'} km{vr.vs_avg4_pct != null ? ` (${sign(vr.vs_avg4_pct)}%)` : ''}</p></>}
    </Card>

    <Card title="Aktivitas terakhir" right={<button className="link" onClick={() => go('activity')}>Semua</button>}>
      {last ? <button className="rowbtn plain" onClick={() => go('activity', { id: last.ids[0] })}>
        <span className={`kdot k-a${String(last.sport_class).split(':')[0]}`} /><span><b>{last.name}</b><small>{fmtLong(last.date)}{last.avg_pace_s_km && last.sport_class === 'run' ? ` · ${fmtPaceS(last.avg_pace_s_km)}/km` : ''}{last.avg_hr ? ` · ${last.avg_hr} bpm` : ''}</small></span>
        <b>{last.distance_m ? (last.distance_m / 1000).toFixed(2) + ' km' : fmtDur(last.duration_s)}</b></button> : <p className="muted">{A.state === 'loading' ? 'Memuat…' : 'Belum ada aktivitas tertarik.'}</p>}
    </Card>

    {nextCp && <Card title="Berikutnya" right={<span className="muted">{diffDays(nextCp.date, T) === 0 ? 'Hari ini' : diffDays(nextCp.date, T) + ' hari'}</span>}>
      <button className="rowbtn plain" onClick={() => go('calendar', { view: 'cp', id: nextCp.id })}>
        <span className="cpn">CP{nextCp.id}</span><span><b>{nextCp.name}</b><small>{fmtLong(nextCp.date)}</small></span><Icon n="chev" size={18} /></button>
      {th && <p className="thr"><Chip tone="green">Hijau ≤ {th.G}</Chip> <Chip tone="red">Merah &gt; {th.R}</Chip> <span className="muted">garis VDOT {nextCp.line.toFixed(1)}</span></p>}
      <button className="rowbtn plain" onClick={() => go('calendar', { view: 'race' })}><span className="kdot k-race" /><span><b>JRF Full · sub-4:00</b><small>{fmtLong(settings.raceDate)} · {toRace} hari</small></span><Icon n="chev" size={18} /></button>
    </Card>}

    <Card title="Fitness menuju sub-4" right={<span className="muted">{vdot.v.toFixed(1)} → {TARGET.vdotNeeded}</span>}>
      <div className="bar"><i style={{ width: pct * 100 + '%' }} /><em style={{ left: ((TARGET.vdotRace - TARGET.baseline) / (TARGET.vdotNeeded - TARGET.baseline)) * 100 + '%' }} title="VDOT race 37.9" /></div>
      <p className="muted">Butuh {(TARGET.vdotNeeded - vdot.v).toFixed(1)} VDOT lagi · 1,02/bln vs laju terbaik teramati 0,74 <Chip>HYPOTHESIS n=2</Chip></p>
    </Card>
  </Screen>
}
