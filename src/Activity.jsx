import { useEffect, useMemo, useState } from 'react'
import { paces, fmtPace } from './lib/vdot.js'
import { BY_DATE, today, addDays, fmtLong, MONTHS } from './lib/calendar.js'
import { efOf, decoupling, zoneTime, hrZoneTime, cumulativeKm } from './lib/analysis.js'
import { mean } from './lib/stats.js'
import { useStore } from './store.js'
import { Card, Chip, Screen, Icon, Evidence, Info } from './ui.jsx'
import { useApi, fmtDur, fmtPaceS } from './api.js'
import { BandLine, MultiTrack, Sparkline } from './charts2.jsx'
import { FitPanel } from './FitPanel.jsx'
import ActivityCoach from './ActivityCoach.jsx'

const SPORTS = [['all', 'Semua'], ['run', 'Lari'], ['walk', 'Jalan'], ['strength', 'Gym']]
const TYPES = [['all', 'Semua jenis'], ['easy', 'Easy'], ['long', 'Long'], ['tempo', 'Tempo'], ['interval', 'Interval'], ['tt', 'TT / race']]
const typeOf = (a) => { const d = BY_DATE[a.date]; if (!d || a.sport_class !== 'run') return null; if (d.kind === 'tt' || d.kind === 'race') return 'tt'; if (d.kind === 'long' || a.distance_m >= 20000) return 'long'; if (d.kind === 'quality') return /repeats|into|interval|400|600|800|mile/i.test(d.label) ? 'interval' : 'tempo'; return 'easy' }
const CLS = (a) => 'k-a' + String(a.sport_class).split(':')[0]
const km = (m) => (m == null ? '—' : (m / 1000).toFixed(m < 10000 ? 2 : 1))
const monthRange = (ym) => { const [y, m] = ym.split('-').map(Number); return [`${ym}-01`, `${ym}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`] }
const shiftMonth = (ym, n) => { const [y, m] = ym.split('-').map(Number), d = new Date(y, m - 1 + n, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }
const SPORT_LABEL = { run: 'Lari', walk: 'Jalan', strength: 'Gym' }

export default function Activity({ vdot, focus, go }) {
  const T = today(), [ym, setYm] = useState(T.slice(0, 7)), [sport, setSport] = useState('all'), [type, setType] = useState('all'), sel = focus?.id || null
  const [from, to] = monthRange(ym), prevYm = shiftMonth(ym, -1), [pf] = monthRange(prevYm)
  const A = useApi(`/api/activities/merged?from=${pf}&to=${to}`), G = useApi('/api/gear'), Hist = useApi(`/api/activities/merged?from=${addDays(T, -180)}&to=${T}`)
  const gear = useMemo(() => Object.fromEntries((G.data || []).map((g) => [g.id, g.name])), [G.data])
  const all = (A.data || []).filter((a) => a.date >= from), list = all.filter((a) => (sport === 'all' || a.sport_class === sport) && (type === 'all' || typeOf(a) === type))
  const cum = cumulativeKm(all, ym), cumPrev = cumulativeKm(A.data || [], prevYm)
  const curve = cum.map((c, i) => ({ date: `${ym}-${String(c.day).padStart(2, '0')}`, cur: ym === T.slice(0, 7) && c.day > +T.slice(8) ? null : c.km, prev: cumPrev[i]?.km ?? cumPrev.at(-1)?.km }))
  const tot = { n: list.length, km: list.filter((a) => a.sport_class === 'run').reduce((s, a) => s + (a.distance_m || 0), 0) / 1000, time: list.reduce((s, a) => s + (a.duration_s || 0), 0), tl: list.reduce((s, a) => s + (a.training_load || 0), 0) }

  const flat = [...(A.data || [])].sort((x, y) => (y.date + (y.start_ts || '')).localeCompare(x.date + (x.start_ts || ''))), at = sel ? flat.findIndex((a) => a.ids.includes(sel)) : -1
  const older = at >= 0 ? flat[at + 1] : null, newer = at > 0 ? flat[at - 1] : null
  if (sel) return <Screen title="Run Analysis" sub="Telemetri sesi · COROS + Strava digabung">
    <div className="dbar">
      <button className="btn sm" onClick={() => go('activity')}><Icon n="left" size={16} />Activities</button>
      <div className="snav"><button onClick={() => older && go('activity', { id: older.ids[0] })} disabled={!older} aria-label={older ? `Sesi sebelumnya: ${older.name}` : 'Sesi sebelumnya'}><Icon n="left" /></button><p>{at >= 0 ? `${flat[at].date} · sesi ${flat.length - at} dari ${flat.length}` : 'Detail sesi'}</p><button onClick={() => newer && go('activity', { id: newer.ids[0] })} disabled={!newer} aria-label={newer ? `Sesi berikutnya: ${newer.name}` : 'Sesi berikutnya'} className="flip"><Icon n="left" /></button></div>
    </div>
    <Detail id={sel} page gear={gear} vdot={vdot} history={Hist.data || []} go={go} />
  </Screen>

  return <Screen title="Activities" sub="Log eksekusi & telemetri · COROS + Strava digabung">
    <div className="monthbar">
      <button onClick={() => setYm(shiftMonth(ym, -1))} aria-label="Bulan sebelumnya"><Icon n="left" /></button>
      <div className="mid"><h2 aria-live="polite">{MONTHS[+ym.slice(5) - 1]} {ym.slice(0, 4)}</h2>{ym !== T.slice(0, 7) && <button onClick={() => setYm(T.slice(0, 7))}>Ke bulan ini</button>}</div>
      <button onClick={() => setYm(shiftMonth(ym, 1))} aria-label="Bulan berikutnya" className="flip"><Icon n="left" /></button>
    </div>
    <Card title="Km kumulatif" right={<span className="muted">{cum.at(-1)?.km ?? 0} vs {cumPrev.at(-1)?.km ?? 0} km</span>}>
      <BandLine data={curve} keys={[{ key: 'cur', color: 'var(--c-long)' }, { key: 'prev', color: 'var(--muted)', cls: 'dash' }]} height={110} label={`Km lari kumulatif bulan ini ${cum.at(-1)?.km} dibanding bulan lalu ${cumPrev.at(-1)?.km}`} />
      <div className="legend"><span><i className="ll" style={{ borderColor: 'var(--c-long)' }} />Bulan ini</span><span><i className="ll" style={{ borderColor: 'var(--muted)', borderTopStyle: 'dashed' }} />Bulan lalu</span></div>
    </Card>
    <div className="seg3" role="group" aria-label="Filter olahraga">{SPORTS.map(([k, l]) => <button key={k} aria-pressed={sport === k} onClick={() => setSport(k)}>{l}</button>)}</div>
    <div className="chiprow" role="group" aria-label="Filter jenis latihan">{TYPES.map(([k, l]) => <button key={k} aria-pressed={type === k} onClick={() => setType(k)}>{l}</button>)}</div>
    <div className="sumrow"><div><b>{tot.n}</b><small>aktivitas</small></div><div><b>{tot.km.toFixed(1)}</b><small>km lari</small></div><div><b>{fmtDur(tot.time)}</b><small>waktu</small></div><div><b>{tot.tl || '—'}</b><small>load</small></div></div>

    {A.state === 'loading' && <><div className="skel" style={{ height: 72 }} /><div className="skel" style={{ height: 72 }} /></>}
    {A.state === 'error' && <div className="card empty"><b>Gagal memuat</b>Server tidak terjangkau.</div>}
    {A.state === 'ok' && !list.length && <div className="card empty"><b>{all.length ? 'Tidak ada aktivitas untuk filter ini' : 'Belum ada aktivitas bulan ini'}</b>{all.length ? 'Coba “Semua”.' : 'Data masuk lewat sync COROS/Strava — cek Profil › Koneksi.'}</div>}
    <div className="alist">{list.map((a) => <button key={a.id} className={`arow ${CLS(a)}`} onClick={() => go('activity', { id: a.ids[0] })} aria-label={`${fmtLong(a.date)}: ${a.name}, ${a.distance_m ? km(a.distance_m) + ' km, ' : ''}${fmtDur(a.duration_s)}`}>
      <div className="t"><b>{a.name || SPORT_LABEL[a.sport_class] || a.sport}</b><small>{a.date.slice(5)} · {SPORT_LABEL[a.sport_class] || a.sport}{typeOf(a) ? ' · ' + TYPES.find((t) => t[0] === typeOf(a))[1] : ''}{a.gear_id && gear[a.gear_id] ? ' · ' + gear[a.gear_id] : ''}</small></div>
      <div className="n"><b>{a.distance_m ? km(a.distance_m) + ' km' : fmtDur(a.duration_s)}</b><small>{a.avg_pace_s_km && a.sport_class === 'run' ? fmtPaceS(a.avg_pace_s_km) + '/km' : a.avg_hr ? a.avg_hr + ' bpm' : ''}</small>{a.training_load ? <span className="tlb2">TL {a.training_load}</span> : null}</div>
    </button>)}</div>
  </Screen>
}

const ZC = { E: 'var(--green)', M: 'var(--c-long)', T: 'var(--yellow)', I: 'var(--c-quality)', R: 'var(--red)' }
function ZoneBars({ title, rows }) { const tot = rows.reduce((a, r) => a + r.s, 0) || 1; return <div className="zbars"><h3>{title}</h3>{rows.map((r) => <div key={r.k} className="zrow"><span>{r.k}</span><div className="tb"><i style={{ width: (r.s / tot) * 100 + '%', background: r.c }} /></div><b>{Math.round((r.s / tot) * 100)}%</b></div>)}</div> }

function Detail({ id, gear, vdot, history, go }) {
  const D = useApi(id ? `/api/activities/detail?id=${encodeURIComponent(id)}` : '', !!id), a = D.data
  const [ctx, setCtx] = useStore('lumpad.act.' + (id || 'none').replace(/[^A-Za-z0-9._-]/g, '_'), { rpe: '', gels: '', cho_g: '', note: '' })
  const p = paces(vdot.v), plan = a ? BY_DATE[a.date] : null, laps = a?.laps || []
  const ef = a ? efOf(a) : null, kind = a ? typeOf(a) : null
  const efHist = a && kind ? history.filter((h) => typeOf(h) === kind && h.date <= a.date && efOf(h)).sort((x, y) => x.date.localeCompare(y.date)).slice(-10).map(efOf) : []
  const dc = decoupling(laps), steady = kind === 'easy' || kind === 'long'
  const hrmax = Math.max(0, ...history.map((h) => h.max_hr || 0), a?.max_hr || 0, ...laps.map((l) => l.max_hr || 0)) || null
  const pz = laps.length ? zoneTime(laps, p) : null, hz = laps.length ? hrZoneTime(laps, hrmax) : null
  const maxPace = Math.max(...laps.map((l) => l.avg_pace_s_km || 0)), minPace = Math.min(...laps.filter((l) => l.distance_m >= 900).map((l) => l.avg_pace_s_km))
  const dyn = (k) => { const v = mean(laps.map((l) => l[k])); return v == null ? null : Math.round(v * 100) / 100 }
  const E = [p.E[1], p.E[0]]
  const verdict = a && a.sport_class === 'run' && a.avg_pace_s_km && plan && ['easy', 'social', 'long', 'speed'].includes(plan.kind) ? (a.avg_pace_s_km < E[0] - 3 ? ['yellow', `Lebih cepat dari easy (${fmtPace(E[0])}–${fmtPace(E[1])})`] : a.avg_pace_s_km > E[1] + 3 ? ['yellow', 'Lebih lambat dari rentang easy'] : ['green', 'Dalam rentang easy']) : null
  const setC = (patch) => setCtx({ ...ctx, ...patch })
  return <div className="detail-page" role="region" aria-label={a?.name || 'Detail aktivitas'}>
    {D.state === 'loading' && <div className="skel" style={{ height: 120 }} />}
    {D.state === 'error' && <p className="muted">Gagal memuat detail.</p>}
    {a && <>
      <p className="muted">{fmtLong(a.date)}</p><h2 className="sess-title">{a.name}</h2>
      <div className="chips"><Chip>{SPORT_LABEL[a.sport_class] || a.sport}</Chip>{a.sources.map((s) => <Chip key={s}>{s}</Chip>)}{a.training_focus && <Chip tone="str">{a.training_focus}</Chip>}</div>
      <div className="score-grid" style={{ marginTop: 10 }}>
        <div><small>Jarak</small><b>{a.distance_m ? km(a.distance_m) : '—'}</b><em>km</em></div><div><small>Waktu gerak</small><b>{fmtDur(a.duration_s)}</b></div><div><small>Pace</small><b>{a.sport_class === 'run' ? fmtPaceS(a.avg_pace_s_km) : '—'}</b><em>/km</em></div>
        <div><small>GAP <Info k="GAP" /></small><b>{a.adjusted_pace_s_km ? fmtPaceS(a.adjusted_pace_s_km) : '—'}</b><em>[COROS]</em></div><div><small>HR rata/maks</small><b>{a.avg_hr ?? '—'}</b><em>{a.max_hr ? `maks ${a.max_hr}` : ''}</em></div><div><small>Training Load</small><b>{a.training_load ?? '—'}</b><em>TE {a.aerobic_te ?? '—'}/{a.anaerobic_te ?? '—'}</em></div>
      </div>
      {a.sport_class === 'run' && <Card title="Efisiensi aerobik">
        <div className="mgrid two"><div><small>Efficiency Factor <Info k="EF" /></small><b>{ef ?? '—'}</b><Sparkline data={efHist} label={`EF 10 lari ${kind} terakhir`} w={110} /></div>
          <div><small>Decoupling Pa:Hr <Info k="Decoupling" /></small><b>{dc && steady ? dc.pct + '%' : '—'}</b>{dc && steady ? <Chip tone={dc.band}>{dc.band === 'green' ? 'tahan lama' : dc.band === 'yellow' ? 'drift sedang' : 'drift tinggi'}</Chip> : <em className="muted">{steady ? 'butuh ≥4 lap' : 'hanya lari steady'}</em>}</div></div>
        <Evidence>[calc] EF = kecepatan (m/mnt, pakai GAP bila ada) ÷ HR rata-rata; sparkline = 10 lari jenis sama. Ambang decoupling 5 % / 7,5 % = konvensi, bukan hasil studi.</Evidence></Card>}
      {plan && <Card title="Rencana vs aktual">
        <div className="vs"><div><small>Rencana</small><b>{plan.label}{plan.km ? ` · ${plan.km} km` : ''}</b></div><div><small>Aktual</small><b>{a.distance_m ? km(a.distance_m) + ' km' : fmtDur(a.duration_s)}</b></div></div>
        {a.distance_m && plan.km ? <p className="muted">{Math.round(((a.distance_m / 1000) / plan.km) * 100)}% dari rencana</p> : null}{verdict && <Chip tone={verdict[0]}>{verdict[1]}</Chip>}</Card>}
      {a.sport_class === 'run' && <FitPanel id={a.ids?.[0] || id} />}
      {a.sport_class === 'run' && (a.distance_m || 0) >= 5000 && <ActivityCoach id={a.ids?.[0] || id} label={String(a.ids?.[0] || id).replace(/^coros:/, '')} />}
      {laps.length > 1 && <Card title="Telemetri per lap"><MultiTrack laps={laps} tracks={[{ key: 'avg_pace_s_km', label: 'Pace', color: 'var(--c-long)', invert: true, fmt: fmtPaceS }, { key: 'avg_hr', label: 'HR', color: 'var(--red)' }, { key: 'cadence', label: 'Cadence', color: 'var(--c-quality)' }, { key: 'power', label: 'Power', color: 'var(--c-tt)' }, { key: 'stride_m', label: 'Langkah', color: 'var(--c-social)' }]} />
        <Evidence>Resolusi 1 km per lap — COROS MCP tidak memberi data per detik. Geser untuk membaca nilai.</Evidence></Card>}
      {laps.length > 0 && <Card title="Split per km">
        <table className="lapt"><thead><tr><th>Lap</th><th>Pace</th><th>HR</th><th>Cad</th><th>GCT</th></tr></thead><tbody>
          {laps.map((l) => <tr key={l.idx}><td>{l.idx}{l.distance_m < 990 ? <small className="muted"> ({(l.distance_m / 1000).toFixed(2)})</small> : ''}</td><td className={'pbar-td ' + (l.avg_pace_s_km === minPace ? 'fast' : '')}><i style={{ width: (maxPace ? (l.avg_pace_s_km / maxPace) * 100 : 0) + '%' }} /><span>{fmtPaceS(l.avg_pace_s_km)}</span></td><td>{l.avg_hr ?? '—'}</td><td>{l.cadence ?? '—'}</td><td>{l.gct_ms ?? '—'}</td></tr>)}
        </tbody></table></Card>}
      {(pz || hz) && <Card title="Distribusi zona">
        {pz && <ZoneBars title="Zona pace VDOT" rows={['E', 'M', 'T', 'I', 'R'].map((k) => ({ k, s: pz[k], c: ZC[k] }))} />}
        {hz && <ZoneBars title={`Zona HR (% HR maks ${hrmax})`} rows={['Z1 <60%', 'Z2 60–70', 'Z3 70–80', 'Z4 80–90', 'Z5 >90'].map((k, i) => ({ k, s: hz[i], c: ['var(--c-rest)', 'var(--green)', 'var(--c-long)', 'var(--c-quality)', 'var(--red)'][i] }))} />}
        <Evidence>[calc] Per lap. HR maks = tertinggi yang pernah tercatat di lapmu (estimasi, bukan tes lab).</Evidence></Card>}
      <Card title="Dinamika lari & konteks">
        <div className="score-grid"><div><small>GCT</small><b>{dyn('gct_ms') ?? '—'}</b><em>ms</em></div><div><small>Osilasi vertikal</small><b>{dyn('vo_cm') ?? '—'}</b><em>cm</em></div><div><small>Rasio vertikal</small><b>{dyn('vratio_pct') ?? '—'}</b><em>%</em></div>
          <div><small>Langkah</small><b>{dyn('stride_m') ?? '—'}</b><em>m</em></div><div><small>Sepatu</small><b className="sm-b">{a.gear_id ? gear[a.gear_id] || '—' : '—'}</b></div><div><small>Cuaca</small><b className="sm-b">{a.temp_c != null ? `${a.temp_c}°C · ${a.humidity ?? '—'}%` : 'belum ditarik'}</b></div></div>
        <div className="fld" style={{ marginTop: 12 }}><span>RPE (1–10)</span><div className="pill10" role="group" aria-label="RPE">{Array.from({ length: 10 }, (_, i) => i + 1).map((n) => <button key={n} aria-pressed={ctx.rpe === n} onClick={() => setC({ rpe: ctx.rpe === n ? '' : n })}>{n}</button>)}</div></div>
        <div className="form" style={{ marginTop: 10 }}><label className="fld"><span>Gel diminum</span><input inputMode="numeric" type="number" value={ctx.gels} onChange={(e) => setC({ gels: e.target.value === '' ? '' : +e.target.value })} /></label>
          <label className="fld"><span>Karbo aktual (g)</span><input inputMode="numeric" type="number" value={ctx.cho_g} onChange={(e) => setC({ cho_g: e.target.value === '' ? '' : +e.target.value })} /></label></div>
        {ctx.cho_g !== '' && a.duration_s > 0 && <p className="muted">≈ {Math.round(ctx.cho_g / (a.duration_s / 3600))} g/jam (target run &gt; 90 mnt: 30–60 g/jam dari menit 45)</p>}
        <Evidence>Log meminta asupan aktual — tidak diisi dari rencana.</Evidence>
      </Card>
    </>}
  </div>
}
