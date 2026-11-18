import { useStore } from './store.js'
import { paces, raceTime, fmtTime, fmtPace } from './lib/vdot.js'
import { sessionPaces } from './lib/pace.js'
import { evaluate, EMPTY_DAY, hasInput } from './lib/gate.js'
import { BY_DATE, today, diffDays, fmtLong, fmtShort, addDays, mondayOf, weekOf, KIND, PHASE_NAME, PLAN_START } from './lib/calendar.js'
import { CHECKPOINTS, TARGET, cpDistance, tone } from './lib/plan.js'
import { formZone } from './lib/load.js'
import { decoupling, sessionSteps } from './lib/analysis.js'
import { r1 } from './lib/stats.js'
import { Card, Chip, Screen, StrengthChips, Icon } from './ui.jsx'
import { useSyncStatus2, wib, ago } from './sync.js'
import { useApi, hm, fmtDur, fmtPaceS } from './api.js'
import { useModel, plannedLoad } from './model.js'
import { RadialGauge, Ring, Stacked100, StepChart, Sparkline } from './charts2.jsx'
import { BarChart } from './charts.jsx'
import FuelCard from './FuelCard.jsx'
import { HomeCoach } from './Coach.jsx'

export const thresholds = (c) => { const d = cpDistance(c); return d && c.line ? { G: fmtTime(raceTime(c.line - 0.5, d)), R: fmtTime(raceTime(c.line - 1.5, d)) } : null }
const sign = (n) => (n == null ? '—' : (n > 0 ? '+' : '') + n)
const TIER_TONE = { prime: 'green', optimal: 'teal', compromised: 'yellow', depleted: 'red' }
const ROLE_FOR = { quality: ['plated', 'daily'], tt: ['plated', 'short', 'daily'], race: ['plated'], long: ['daily', 'plated', 'easy'], speed: ['short', 'daily'], easy: ['easy', 'daily'], social: ['easy', 'daily'] }

// Home: the 3-second morning glance — can I run, what, with what, and how is the week going.
export default function Home({ vdot, settings, results, go }) {
  const T = today(), day = BY_DATE[T], p = paces(vdot.v), G = useApi('/api/gear')
  const [f] = useStore('lumpad.daily.' + T, EMPTY_DAY), [ov] = useStore('lumpad.muscle.' + T, {}), M = useModel(T, settings, vdot, f, ov)
  const sync = useSyncStatus2(), g = evaluate(f, day), checked = hasInput(f), rd = M.readiness, tier = rd.tier
  const toRace = diffDays(settings.raceDate, T), wk = day ? weekOf(T) : null, mon = mondayOf(T)
  // hero pills
  const hv = M.hrv, hrv7 = M.health.filter((h) => h.date > addDays(T, -7) && h.hrv_avg != null).map((h) => h.hrv_avg), sl = M.sleep, fz = formZone(M.cur?.tsbPct)
  // session + shoe
  const steps = sessionSteps(day), adjusted = f.adjust === 'easy' ? 'Disesuaikan: easy' : f.adjust === 'cut' && day?.km ? `Disesuaikan: dipotong ke ${r1(day.km * 0.75)} km` : null
  const active = (G.data || []).filter((s) => !s.retired), roles = settings.shoeRoles || {}
  const shoe = (() => { if (!day?.km) return null; for (const r of ROLE_FOR[day.kind] || ['daily']) { const c = active.filter((s) => roles[s.id] === r).sort((a, b) => (a.last_used || '').localeCompare(b.last_used || '')); if (c.length) return c[0] } return null })()
  // bento
  const actWeek = M.acts.filter((a) => a.sport_class === 'run' && a.date >= mon && a.date <= T).reduce((s, a) => s + (a.distance_m || 0) / 1000, 0)
  const actPrev = M.acts.filter((a) => a.sport_class === 'run' && a.date >= addDays(mon, -7) && a.date <= addDays(T, -7)).reduce((s, a) => s + (a.distance_m || 0) / 1000, 0)
  const planWeek = Array.from({ length: 7 }, (_, i) => BY_DATE[addDays(mon, i)]?.km || 0).reduce((a, b) => a + b, 0)
  const loads7 = Array.from({ length: 7 }, (_, i) => { const d = addDays(mon, i), a = M.series.find((x) => x.date === d)?.load; return { date: d, value: d <= T ? a || 0 : 0, plan: plannedLoad(BY_DATE[d], M.ratios) || undefined, tick: ['S', 'S', 'R', 'K', 'J', 'S', 'M'][i] } })
  const nextCp = CHECKPOINTS.find((c) => c.date >= T), th = nextCp && thresholds(nextCp), dist = nextCp && cpDistance(nextCp)
  const last = M.acts.filter((a) => a.sport_class === 'run')[0] || M.acts[0], dc = last ? decoupling(M.lapsById[last.id] || []) : null
  const lastSteady = last && ['easy', 'long', 'social'].includes(BY_DATE[last.date]?.kind)

  return <Screen title={fmtLong(T).split(',')[0]} sub={fmtLong(T).split(', ')[1]} right={<button className="pill" onClick={() => go('calendar', { view: 'race' })} aria-label={`${toRace} hari menuju JRF`}><b>H-{Math.max(0, toRace)}</b><small>JRF {fmtShort(settings.raceDate)}</small></button>}>
    <button className={`fresh ${sync === null ? 'warn' : sync?.lastRun ? (sync.lastRun.ok ? 'ok' : 'warn') : 'none'}`} onClick={() => go('profile')}>
      <i />{sync === undefined ? 'Memeriksa sync…' : sync === null ? 'Status sync tidak terjangkau — data bisa usang' : sync?.lastRun ? <>Sync {ago(sync.lastRun.received_at)} · {wib(sync.lastRun.received_at)} WIB</> : 'Belum ada sync — data COROS/Strava belum masuk'}
    </button>

    <FuelCard last={last} today={T} />
    <HomeCoach go={go} />

    {/* 1. readiness hero */}
    <button className="card hero-btn" onClick={() => go('ready')} aria-label={`Readiness ${rd.score ?? 'belum ada'}. Buka detail`}>
      <div className="hero">
        <RadialGauge value={rd.score} tone={tier ? TIER_TONE[tier.id] : 'none'} label="Readiness" size={112} sub={rd.score == null ? 'data kurang' : '/ 100'} />
        <div className="hx"><span className={'tierc ' + (tier ? 'tier-' + tier.id : '')}>{tier ? tier.label : checked ? { green: 'Jalankan', yellow: 'Turunkan', red: 'Istirahat' }[g.level] : 'Belum check-in'}</span>
          <h2>{tier ? tier.advice : checked ? (g.reasons[0]?.msg || 'Tidak ada sinyal merah') : 'Ketuk untuk check-in (±15 detik)'}</h2>
          {rd.caps[0] && <p className="muted">Dibatasi: {rd.caps[0].why}</p>}</div>
      </div>
      <div className="pills">
        <div className="pillc"><small>HRV</small><b>{hv.today ?? '—'}{hv.today ? ' ms' : ''}</b>{hv.enough ? <em className={hv.flagTrend ? 'warn-t' : ''}>{sign(r1(((hv.today - hv.roll7) / hv.roll7) * 100, 0))}% vs 7 hr</em> : <em>butuh 14 hr</em>}<Sparkline data={hrv7} label="HRV 7 hari" w={70} h={18} /></div>
        <div className="pillc"><small>Tidur</small><b>{sl.enough ? hm(sl.asleep_min) : '—'}</b>{sl.enough ? <div className="minibar" role="img" aria-label={`Deep ${sl.deep}% REM ${sl.rem}%`}><i style={{ width: sl.deep + '%', background: 'var(--c-long)' }} /><i style={{ width: sl.rem + '%', background: 'var(--c-tt)' }} /></div> : <em>belum ditarik</em>}{sl.enough && <em>deep+REM {sl.deep + sl.rem}%</em>}</div>
        <div className="pillc"><small>Form</small><b>{sign(M.cur?.tsb)}</b><em>{fz ? fz.label : 'belum ada'}</em></div>
      </div>
    </button>

    {/* 2. today's session */}
    {day ? <Card className={`sess k-${day.kind}`}>
      <div className="sess-top"><Chip kind={day.kind}>{KIND[day.kind].label}</Chip><span className="muted">{wk?.id} · {PHASE_NAME[day.phase] || day.phase}</span></div>
      <h2 className="sess-title">{day.label || KIND[day.kind].label}</h2>
      {adjusted && <Chip tone="yellow">{adjusted}</Chip>}
      {day.km > 0 ? <>
        <div className="bigkm"><b>{day.km}</b><span>km</span></div>
        {steps.length > 1 && <StepChart steps={steps} />}
        {sessionPaces(day, p).length > 0 && <dl className="pace">{sessionPaces(day, p).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>}
        <dl className="pace"><div><dt>Sepatu</dt><dd>{shoe ? shoe.name : <button className="link" onClick={() => go('profile')}>Atur peran sepatu di Profil</button>}</dd></div></dl>
        <p className="src">Pace dari VDOT {vdot.v.toFixed(1)} · struktur dari label rencana (WU 2 / CD 1 km) [calc]</p>
      </> : <>
        <p className="muted">{day.kind === 'gym' ? 'Hari gym — tanpa lari.' : 'Rest day.'} Daftar pemulihan:</p>
        <ul className="rules">{[...(day.tags || []).filter((t) => /Upper|Lower|Full|FB/.test(t)).map((t) => `Gym: ${t} (sesuai rencana)`), 'Mobilitas 10 menit + cek tibia dan nyeri', `Target tidur ≥ ${hm(settings.sleepNeedMin || 480)}`, 'Jalan santai 20–30 menit (opsional)', 'Minum cukup; makan karbo + protein normal'].map((x) => <li key={x}>{x}</li>)}</ul>
      </>}
      <div className="chips"><StrengthChips day={day} />{day.tags.filter((t) => /^CP/.test(t)).map((t) => <Chip key={t} tone="cp">{t}</Chip>)}</div>
    </Card> : <Card title={T < PLAN_START ? 'Plan 2027 belum mulai' : 'Di luar plan'}><p className="muted">{T < PLAN_START ? `Hari pertama: ${fmtShort(PLAN_START)}. Sampai itu: easy, jaga volume, rehab.` : 'Tidak ada sesi terjadwal.'}</p></Card>}

    {/* 3. weekly bento */}
    <div className="bento">
      <div><h3>Volume minggu ini</h3><div className="row-c"><Ring value={actWeek} max={planWeek || 1} label={`${r1(actWeek)} dari ${r1(planWeek)} km`} size={78} /><div><b>{r1(actWeek)}</b><span className="muted"> / {r1(planWeek)} km</span><br /><small className="muted">{sign(r1(actWeek - actPrev))} km vs minggu lalu</small></div></div></div>
      <div><h3>Intensitas 7 hari</h3>{M.intensity ? <Stacked100 parts={[{ k: 'Rendah', v: M.intensity.low, c: 'var(--green)' }, { k: 'Sedang', v: M.intensity.mid, c: 'var(--yellow)' }, { k: 'Tinggi', v: M.intensity.high, c: 'var(--red)' }]} marker={70} label={`Rendah ${M.intensity.low}%, sedang ${M.intensity.mid}%, tinggi ${M.intensity.high}%; patokan 70% rendah`} /> : <p className="muted">Belum ada lari.</p>}<small className="muted">patokan ≥70% rendah (Campos 2021)</small></div>
      <div><h3>Beban harian</h3><BarChart data={loads7} height={64} label={`Training load minggu ini: ${loads7.map((d) => d.value).join(', ')}`} /><small className="muted">garis putus = rencana (perkiraan)</small></div>
      <div><h3>{nextCp ? `CP${nextCp.id}` : 'Race'}</h3><div className="flipnum">{nextCp ? diffDays(nextCp.date, T) : toRace}<small className="muted" style={{ fontSize: '.8rem', fontWeight: 500 }}> hari</small></div>
        <small className="muted">{nextCp && th ? `Hijau ≤ ${th.G} · sekarang ±${fmtTime(raceTime(vdot.v, dist))}` : nextCp ? nextCp.name : 'sub-4:00'}</small></div>
    </div>

    {/* 4. last activity strip */}
    {last && <button className="card rowbtn plain strip-last" onClick={() => go('activity', { id: last.ids[0] })} aria-label={`Aktivitas terakhir ${last.name}`}>
      <span className={`kdot k-a${String(last.sport_class).split(':')[0]}`} />
      <span><b>{last.name}</b><small>{fmtShort(last.date)} · {last.distance_m ? (last.distance_m / 1000).toFixed(2) + ' km' : fmtDur(last.duration_s)}{last.avg_pace_s_km && last.sport_class === 'run' ? ` · ${fmtPaceS(last.avg_pace_s_km)}/km` : ''}{last.avg_hr ? ` · ${last.avg_hr} bpm` : ''}{last.training_load ? ` · TL ${last.training_load}` : ''}</small></span>
      {dc && lastSteady ? <Chip tone={dc.band}>Pa:Hr {dc.pct}%</Chip> : <Icon n="chev" size={18} />}
    </button>}

    <Card title="Fitness menuju sub-4" right={<span className="muted">{vdot.v.toFixed(1)} → {TARGET.vdotNeeded}</span>}>
      <div className="bar"><i style={{ width: Math.max(0, Math.min(1, (vdot.v - TARGET.baseline) / (TARGET.vdotNeeded - TARGET.baseline))) * 100 + '%' }} /></div>
      <p className="muted">Butuh {(TARGET.vdotNeeded - vdot.v).toFixed(1)} VDOT lagi · 1,02/bln vs laju terbaik teramati 0,74 <Chip>HYPOTHESIS n=2</Chip></p>
    </Card>
  </Screen>
}
