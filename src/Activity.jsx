import { useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { paces, fmtPace } from './lib/vdot.js'
import { BY_DATE, today, addDays, fmtLong, MONTHS } from './lib/calendar.js'
import { efOf, decoupling, cumulativeKm } from './lib/analysis.js'
import { mean } from './lib/stats.js'
import { useStore } from './store.js'
import { tileSpec } from './lib/tiles.js'
import { Card, Chip, Icon, Evidence, Info, SegmentedTabs, StatusPill } from './ui.jsx'
import { useApi, fmtDur, fmtPaceS } from './api.js'
import { cfgOf, hrRange, paceRange, zoneSeconds, ZONES } from './lib/zones.js'
import { BandLine, MultiTrack, Sparkline } from './charts2.jsx'
import { FitPanel } from './FitPanel.jsx'
import ActivityCoach from './ActivityCoach.jsx'
import LongRunContext from './LongRunContext.jsx'

const SPORTS = [['all', 'All'], ['run', 'Run'], ['walk', 'Walk'], ['strength', 'Gym']]
const TYPES = [['all', 'All types'], ['easy', 'Easy'], ['long', 'Long'], ['tempo', 'Tempo'], ['interval', 'Interval'], ['tt', 'TT / race']]
const typeOf = (a) => { const d = BY_DATE[a.date]; if (!d || a.sport_class !== 'run') return null; if (d.kind === 'tt' || d.kind === 'race') return 'tt'; if (d.kind === 'long' || a.distance_m >= 20000) return 'long'; if (d.kind === 'quality') return /repeats|into|interval|400|600|800|mile/i.test(d.label) ? 'interval' : 'tempo'; return 'easy' }
const CLS = (a) => 'k-a' + String(a.sport_class).split(':')[0]
const km = (m) => (m == null ? '—' : (m / 1000).toFixed(m < 10000 ? 2 : 1))
const monthRange = (ym) => { const [y, m] = ym.split('-').map(Number); return [`${ym}-01`, `${ym}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`] }
const shiftMonth = (ym, n) => { const [y, m] = ym.split('-').map(Number), d = new Date(y, m - 1 + n, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }
const SPORT_LABEL = { run: 'Run', walk: 'Walk', strength: 'Gym' }

export default function Activity({ vdot, focus, go, settings }) {
  const T = today(), [ym, setYm] = useState(T.slice(0, 7)), [sport, setSport] = useState('all'), [type, setType] = useState('all'), sel = focus?.id || null
  const [from, to] = monthRange(ym), prevYm = shiftMonth(ym, -1), [pf] = monthRange(prevYm)
  const A = useApi(`/api/activities/merged?from=${pf}&to=${to}`), G = useApi('/api/gear'), Hist = useApi(`/api/activities/merged?from=${addDays(T, -180)}&to=${T}`)
  const gear = useMemo(() => Object.fromEntries((G.data || []).map((g) => [g.id, g.name])), [G.data])
  const all = (A.data || []).filter((a) => a.date >= from), list = all.filter((a) => (sport === 'all' || a.sport_class === sport) && (type === 'all' || typeOf(a) === type))
  const cum = cumulativeKm(all, ym), cumPrev = cumulativeKm(A.data || [], prevYm)
  const curve = cum.map((c, i) => ({ date: `${ym}-${String(c.day).padStart(2, '0')}`, cur: ym === T.slice(0, 7) && c.day > +T.slice(8) ? null : c.km, prev: cumPrev[i]?.km ?? cumPrev.at(-1)?.km }))
  const tot = { n: list.length, km: list.filter((a) => a.sport_class === 'run').reduce((s, a) => s + (a.distance_m || 0), 0) / 1000, time: list.reduce((s, a) => s + (a.duration_s || 0), 0), tl: list.reduce((s, a) => s + (a.training_load || 0), 0) }

  const flat = [...(Hist.data?.length ? Hist.data : (A.data || []))].sort((x, y) => (y.date + (y.start_ts || '')).localeCompare(x.date + (x.start_ts || ''))), at = sel ? flat.findIndex((a) => (a.ids || [a.id]).includes(sel)) : -1
  const older = at >= 0 ? flat[at + 1] : null, newer = at > 0 ? flat[at - 1] : null

  if (sel) return <section className="screen">
    <div className="actv56-topbar">
      <button type="button" className="btn sm" onClick={() => go('activity')}><Icon n="left" size={16} /> Back</button>
      <div className="actv56-topbar-nav">
        <button type="button" className="btn sm" disabled={!older} onClick={() => older && go('activity', { id: (older.ids?.[0] || older.id) })}>← Prev</button>
        <button type="button" className="btn sm" disabled={!newer} onClick={() => newer && go('activity', { id: (newer.ids?.[0] || newer.id) })}>Next →</button>
      </div>
    </div>
    <Detail id={sel} page gear={gear} gearList={G.data || []} vdot={vdot} history={Hist.data || []} go={go} settings={settings} />
  </section>

  const prevKm = cumPrev.at(-1)?.km ?? 0, curKm = cum.at(-1)?.km ?? 0, dKm = prevKm ? Math.round(((curKm - prevKm) / prevKm) * 1000) / 10 : null
  const cnt = (k) => all.filter((a) => a.sport_class === k).length, hhmm = (a) => (a.start_ts ? new Date(a.start_ts * 1000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' }) : null)
  const longest = (a) => a.sport_class === 'run' && typeOf(a) === 'long'

  return <section className="screen acts">
    <div className="actgrid">
      <div className="card acthead">
        <div className="monthbar slim">
          <button onClick={() => setYm(shiftMonth(ym, -1))} aria-label="Previous month"><Icon n="left" /></button>
          <div className="mid"><h1 aria-live="polite">All Activities — {MONTHS[+ym.slice(5) - 1]} {ym.slice(0, 4)}</h1><p className="sub">Merged COROS + Strava · click any card to open its dedicated full-page analysis</p></div>
          <button onClick={() => setYm(shiftMonth(ym, 1))} aria-label="Next month" className="flip"><Icon n="left" /></button>
        </div>
        <div className="bigkm"><b>{curKm} km</b><small>{prevKm ? `vs ${prevKm} km last month${dKm != null ? ` (${dKm > 0 ? '+' : ''}${dKm}%)` : ''}` : 'no comparison yet'}</small>{ym !== T.slice(0, 7) && <button className="link" onClick={() => setYm(T.slice(0, 7))}>Go to this month</button>}</div>
        <BandLine data={curve} keys={[{ key: 'cur', color: 'var(--c-long)' }, { key: 'prev', color: 'var(--muted)', cls: 'dash' }]} height={130} label={`Cumulative run km this month ${curKm} vs last month ${prevKm}`} />
        <div className="legend"><span><i className="ll" style={{ borderColor: 'var(--c-long)' }} />This month ({curKm} km)</span><span><i className="ll" style={{ borderColor: 'var(--muted)', borderTopStyle: 'dashed' }} />Last month ({prevKm} km)</span></div>
      </div>
      <div className="card actsum">
        <h2>Monthly Summary &amp; Sport Filter</h2><p className="sub">Filter activities by sport or workout type</p>
        <div className="sumtiles"><div><small>Activities</small><b>{tot.n}</b></div><div><small>Run distance</small><b className="gr">{tot.km.toFixed(1)} km</b></div><div><small>Total time</small><b>{fmtDur(tot.time)}</b></div><div><small>Total load</small><b className="cr">{tot.tl || '—'}</b></div></div>
        <div className="chipfilter" role="group" aria-label="Sport filter">{SPORTS.map(([k, l]) => <button key={k} aria-pressed={sport === k} onClick={() => setSport(k)}>{l}{k === 'all' ? ` (${all.length})` : ` (${cnt(k)})`}</button>)}</div>
        <div className="chipfilter" role="group" aria-label="Workout type filter" style={{ marginTop: 6 }}>{TYPES.map(([k, l]) => <button key={k} aria-pressed={type === k} onClick={() => setType(k)}>{l}</button>)}</div>
      </div>
    </div>

    {A.state === 'loading' && <><div className="skel" style={{ height: 72 }} /><div className="skel" style={{ height: 72 }} /></>}
    {A.state === 'error' && <div className="card empty"><b>Failed to load</b>Server unreachable.</div>}
    {A.state === 'ok' && !list.length && <div className="card empty"><b>{all.length ? 'No activities for this filter' : 'No activities this month yet'}</b>{all.length ? 'Try “All”.' : 'Check Profile › Devices & Connections.'}</div>}
    <div className="acards">{list.map((a) => { const t = typeOf(a), g = a.gear_id && gear[a.gear_id]; return <button key={a.id} className={`acard ${CLS(a)}`} onClick={() => go('activity', { id: (a.ids?.[0] || a.id) })} aria-label={`${fmtLong(a.date)}: ${a.name}`}>
      <div className="ac-top">
        <div><span className="chip t-sport">{SPORT_LABEL[a.sport_class] || a.sport}{t ? ' · ' + TYPES.find((x) => x[0] === t)[1] : ''}</span> <small className="mono">{fmtLong(a.date).replace(/^(\w{3})\w*, (\w{3})\w* /, '$1, $2 ')}{hhmm(a) ? ` · ${hhmm(a)}` : ''}</small></div>
        <div className="ac-km"><b>{a.distance_m ? km(a.distance_m) + ' km' : fmtDur(a.duration_s)}</b>{a.training_load ? <span className="tlb2">TL {a.training_load}</span> : null}</div>
      </div>
      <h3>{a.name || SPORT_LABEL[a.sport_class] || a.sport}</h3>
      <p className="muted">{[g ? 'Shoe: ' + g : null, a.temp_c != null ? `${a.temp_c}°C · RH ${a.humidity ?? '—'}%` : null, a.location].filter(Boolean).join(' · ') || (longest(a) ? 'Long run' : '—')}</p>
      <div className="ac-stats"><div><small>Duration</small><b>{fmtDur(a.duration_s)}</b></div><div><small>Pace</small><b>{a.avg_pace_s_km && a.sport_class === 'run' ? fmtPaceS(a.avg_pace_s_km) + ' /km' : '—'}</b></div><div><small>Avg HR</small><b>{a.avg_hr ? a.avg_hr + ' bpm' : '—'}</b></div><span className="ac-go">Open Analysis →</span></div>
    </button> })}</div>
  </section>
}

function RunCompare({ a, id, history }) {
  const [pick, setPick] = useState('prev')
  const kind = typeOf(a), runs = history.filter((h) => h.sport_class === 'run' && !h.ids?.includes(id) && (h.distance_m || 0) >= 1000 && h.date <= a.date).sort((x, y) => y.date.localeCompare(x.date))
  const same = runs.filter((h) => kind && typeOf(h) === kind)
  const pool = same.length ? same : runs
  const bench = pick === 'prev' ? pool[0] : pick === 'longest' ? [...runs].sort((x, y) => (y.distance_m || 0) - (x.distance_m || 0))[0] : pick === 'bestEF' ? [...pool].filter((h) => efOf(h)).sort((x, y) => efOf(y) - efOf(x))[0] : runs.find((h) => h.ids?.[0] === pick || h.id === pick)
  const rows = [['Distance (km)', (a.distance_m || 0) / 1000, (bench?.distance_m || 0) / 1000, 2, 'neutral'], ['Avg pace (s/km)', a.avg_pace_s_km, bench?.avg_pace_s_km, 0, 'lower'], ['Avg HR (bpm)', a.avg_hr, bench?.avg_hr, 0, 'lower'], ['EF', efOf(a), bench ? efOf(bench) : null, 3, 'higher'], ['Training load', a.training_load, bench?.training_load, 0, 'neutral']]
  const fmt = (label, v, d) => (v == null ? '—' : label.startsWith('Avg pace') ? fmtPaceS(v) : (+v).toFixed(d))
  return <Card title="Pinned Side-by-Side Benchmark Comparison" right={<select aria-label="Benchmark run" value={pick} onChange={(e) => setPick(e.target.value)}><option value="prev">Previous {kind || 'run'}</option><option value="longest">Longest run</option><option value="bestEF">Best EF{kind ? ` (${kind})` : ''}</option>{runs.slice(0, 20).map((h) => <option key={h.ids?.[0] || h.id} value={h.ids?.[0] || h.id}>{h.date.slice(5)} · {((h.distance_m || 0) / 1000).toFixed(1)} km</option>)}</select>}>
    {!bench ? <p className="muted">No earlier run to compare with yet.</p> : <>
      <p className="muted" style={{ marginTop: 0 }}>vs <b>{bench.name}</b> · {bench.date}</p>
      <div className="scroll" tabIndex={0}><table className="lapt"><thead><tr><th>Metric</th><th>This run</th><th>Benchmark</th><th>Δ</th></tr></thead><tbody>{rows.map(([label, v, b, d, good]) => { const dv = v != null && b != null ? v - b : null, tone = dv == null || good === 'neutral' || Math.abs(dv) < 1e-9 ? '' : (good === 'lower' ? dv < 0 : dv > 0) ? 'cmp-good' : 'cmp-bad'
        return <tr key={label}><td>{label}</td><td>{fmt(label, v, d)}</td><td>{fmt(label, b, d)}</td><td className={tone}>{dv == null ? '—' : (dv > 0 ? '+' : '') + (label.startsWith('Avg pace') ? Math.round(dv) + ' s' : dv.toFixed(d))}</td></tr> })}</tbody></table></div>
    </>}
  </Card>
}

const ZCOL = ['var(--c-rest)', 'var(--c-easy)', 'var(--green)', 'var(--c-long)', 'var(--yellow)', 'var(--c-quality)', 'var(--red)']
const ZROWS = (cfg, kind) => [kind === 'hr' ? `<Z1 (<${Math.round(cfg.lthr * 0.65)} bpm)` : 'Slower than Z1', ...[1, 2, 3, 4, 5, 6].map((z) => { const r = kind === 'hr' ? hrRange(z, cfg) : paceRange(z, cfg); return kind === 'hr' ? `Z${z} ${ZONES[z].name} · ${z === 6 ? r[0] + '+' : r[0] + '–' + r[1]} bpm` : `Z${z} ${ZONES[z].name} · ${fmtPaceS(r[0])}–${fmtPaceS(r[1])}` })].map((k, i) => ({ k, c: ZCOL[i] }))

function group5k(laps) {
  const out = []
  for (let i = 0; i < laps.length; i += 5) {
    const chunk = laps.slice(i, i + 5)
    const dist = chunk.reduce((s, l) => s + (l.distance_m || 0), 0)
    const dur = chunk.reduce((s, l) => s + (l.duration_s || 0), 0)
    const pace = dist > 0 ? (dur / (dist / 1000)) : mean(chunk.map((l) => l.avg_pace_s_km))
    out.push({
      idx: `Km ${chunk[0].idx}–${chunk.at(-1).idx}`,
      avg_pace_s_km: pace,
      avg_hr: mean(chunk.map((l) => l.avg_hr)) != null ? Math.round(mean(chunk.map((l) => l.avg_hr))) : null,
      cadence: mean(chunk.map((l) => l.cadence)) != null ? Math.round(mean(chunk.map((l) => l.cadence))) : null,
      gct_ms: mean(chunk.map((l) => l.gct_ms)) != null ? Math.round(mean(chunk.map((l) => l.gct_ms))) : null,
      distance_m: dist,
    })
  }
  return out
}

const WORKOUT_TAGS = ['Easy', 'Tempo', 'Interval', 'Long Run', 'Race']

const OFFICIAL_RACES = {
  '2026-11-15': {
    event: 'Bank Jateng Borobudur Marathon 2026',
    bib: '#B13718',
    status: 'QRY (Black Flag)',
    net: '5:09:15 @ 34K Mat',
    gun: '5:30:35 Watch (36.92 km)',
    rank: 'Heat Black Flag · Medal + Jersey',
    provider: 'ScoreNow Official Timing',
    url: 'https://scorenow.id/',
    splits: [
      ['10K', '1:18:59', '7:54/km'],
      ['15K', '1:59:44', '8:09/km'],
      ['21.1K', '2:55:25', '9:08/km'],
      ['28.4K', '4:08:24', '10:00/km'],
      ['31.2K', '4:42:20', '12:07/km'],
      ['34K Mat', '5:09:15', '9:37/km'],
    ],
  },
  '2026-10-25': {
    event: 'HYDROPLUS Jakarta Running Festival FM 2026',
    bib: '#B13144',
    status: 'DNF (Pain Gate)',
    net: '0:33:59 @ 5K Mat',
    gun: '1:03:34 Watch (9.16 km)',
    rank: 'Disciplined Stop at 2/10 Pain Gate',
    provider: 'ScoreNow Official Timing',
    url: 'https://scorenow.id/',
    splits: [
      ['5K Mat', '0:33:59', '6:48/km'],
      ['9.16K Watch', '1:03:34', '6:56/km'],
    ],
  },
  '2026-10-24': {
    event: 'myBCA Jakarta Running Festival HM 2026',
    bib: '#B24456',
    status: 'Official Finisher',
    net: '3:07:12',
    gun: '3:13:40',
    rank: '11,198 Overall · 6,605 National · 8,499 Male',
    provider: 'ScoreNow Official Timing',
    url: 'https://scorenow.id/',
    splits: [
      ['5K', '0:42:45', '8:33/km'],
      ['10K', '1:23:04', '8:04/km'],
      ['15K', '2:08:35', '9:06/km'],
      ['20K', '2:57:22', '9:45/km'],
      ['21.1K Finish', '3:07:12', '8:56/km'],
    ],
  },
  '2026-06-14': {
    event: 'BTN Jakarta International Marathon (Jakim) 2026',
    bib: '#44708',
    status: 'Official Finisher · 1st FM',
    net: '6:53:03',
    gun: '7:03:43',
    rank: '6,717/8,347 Overall · 5,896/7,221 Gender · 4,127/5,021 Cat',
    provider: 'Codeine Official Timing',
    url: 'https://jakim.id/',
    splits: [
      ['5K', '0:38:15', '7:39/km'],
      ['10K', '1:17:52', '7:55/km'],
      ['15K', '1:59:44', '8:22/km'],
      ['21.1K', '2:57:41', '9:30/km'],
      ['30K', '4:30:10', '10:23/km'],
      ['35K', '5:33:58', '12:46/km'],
      ['40K', '6:28:10', '10:50/km'],
      ['42.2K Finish', '6:53:03', '11:20/km'],
    ],
  },
}

const FEEL_OPTIONS = ['Felt strong', 'Heat / Humidity', 'Workout felt too long', 'Sore legs', 'GI / Nausea', 'Technical / GPS']

function defaultTagFor(a, plan) {
  if (!a) return 'Easy'
  if (OFFICIAL_RACES[a.date] || plan?.kind === 'race' || /marathon|race|hm\b|10k|5k/i.test(a.name || '')) return 'Race'
  const k = typeOf(a)
  if (k === 'tt') return 'Race'
  if (k === 'long') return 'Long Run'
  if (k === 'interval') return 'Interval'
  if (k === 'tempo') return 'Tempo'
  return 'Easy'
}

function fmtDeltaSec(diff) {
  if (diff == null || Number.isNaN(diff)) return { text: '—', cls: 'flat' }
  const r = Math.round(diff)
  if (r === 0) return { text: '0:00', cls: 'flat' }
  const sign = r > 0 ? '+' : '-'
  const abs = Math.abs(r)
  return { text: `${sign}${Math.floor(abs / 60)}:${String(abs % 60).padStart(2, '0')}`, cls: r > 0 ? 'pos' : 'neg' }
}

function ribbonZoneColor(hr, lthr) {
  if (!hr || !lthr) return '#4658D6'
  const pct = hr / lthr
  if (pct < 0.81) return '#06B6D4'
  if (pct < 0.89) return '#22C55E'
  if (pct < 0.94) return '#EAB308'
  if (pct < 1.00) return '#F97316'
  if (pct < 1.04) return '#EF4444'
  return '#9333EA'
}


function computePowerZones(laps, ftp = 199) {
  const defs = [
    ['Z1 Active Rec', `1–${Math.round(ftp * 0.52)}w`, 0, ftp * 0.52, '#06B6D4'],
    ['Z2 Endurance', `${Math.round(ftp * 0.52) + 1}–${Math.round(ftp * 0.71)}w`, ftp * 0.52, ftp * 0.71, '#22C55E'],
    ['Z3 Tempo', `${Math.round(ftp * 0.71) + 1}–${Math.round(ftp * 0.86)}w`, ftp * 0.71, ftp * 0.86, '#EAB308'],
    ['Z4 Threshold', `${Math.round(ftp * 0.86) + 1}–${ftp}w`, ftp * 0.86, ftp, '#F97316'],
    ['Z5 VO2 Max', `${ftp + 1}–${Math.round(ftp * 1.15)}w`, ftp, ftp * 1.15, '#EF4444'],
    ['Z6 Anaerobic', `${Math.round(ftp * 1.15) + 1}w+`, ftp * 1.15, 9999, '#C026D3'],
  ]
  const secs = defs.map(() => 0)
  let ss = 0
  for (const l of laps) {
    const pw = l.power, dur = l.duration_s || 0
    if (!pw || !dur) continue
    const idx = defs.findIndex((d) => pw > d[2] && pw <= d[3])
    if (idx >= 0) secs[idx] += dur
    if (pw >= ftp * 0.80 && pw <= ftp * 0.93) ss += dur
  }
  const rows = defs.map((d, i) => ({ k: `${d[0]} · ${d[1]}`, c: d[4], s: secs[i] }))
  rows.push({ k: `SS Sweet Spot · ${Math.round(ftp * 0.80)}–${Math.round(ftp * 0.93)}w`, c: '#EA580C', s: ss })
  return rows
}

function SvgAreaChart({ values, color, fill, label, yFmt, invert = false, minY, maxY, secondary }) {
  if (!values || values.length < 2) return <p className="muted" style={{ fontSize: 12 }}>Needs ≥ 2 laps for telemetry curve.</p>
  const W = 440, H = 150, PL = 38, PR = 10, PT = 10, PB = 22
  const lo = minY ?? Math.min(...values), hi = maxY ?? Math.max(...values), span = (hi - lo) || 1
  const xOf = (i) => PL + (i / (values.length - 1)) * (W - PL - PR)
  const yOf = (v) => {
    const n = (v - lo) / span
    return invert ? PT + n * (H - PT - PB) : H - PB - n * (H - PT - PB)
  }
  const pts = values.map((v, i) => `${xOf(i).toFixed(1)},${yOf(v).toFixed(1)}`).join(' ')
  const area = `${PL},${H - PB} ${pts} ${(W - PR).toFixed(1)},${H - PB}`
  let secArea = null
  if (secondary && secondary.length === values.length) {
    const slo = Math.min(...secondary), shi = Math.max(...secondary), sspan = (shi - slo) || 1
    const spts = secondary.map((v, i) => `${xOf(i).toFixed(1)},${(H - PB - ((v - slo) / sspan) * (H - PT - PB) * 0.82).toFixed(1)}`).join(' ')
    secArea = `${PL},${H - PB} ${spts} ${(W - PR).toFixed(1)},${H - PB}`
  }
  const ticks = [lo, lo + span / 2, hi]
  return <svg viewBox={`0 0 ${W} ${H}`} className="actv56-svg" role="img" aria-label={label}>
    {ticks.map((t, idx) => {
      const y = yOf(t)
      return <g key={idx}>
        <line x1={PL} x2={W - PR} y1={y} y2={y} stroke="var(--line)" strokeDasharray="3 3" />
        <text x={PL - 5} y={y + 3} textAnchor="end" fontSize="9.5" fill="var(--muted)" fontFamily="var(--f-mono)">{yFmt ? yFmt(t) : Math.round(t)}</text>
      </g>
    })}
    {secArea && <polygon points={secArea} fill="rgba(148,163,184,0.22)" />}
    <polygon points={area} fill={fill} />
    <polyline points={pts} fill="none" stroke={color} strokeWidth="2.2" strokeLinejoin="round" />
    <text x={PL} y={H - 5} fontSize="9.5" fill="var(--muted)" fontFamily="var(--f-mono)">Km 1</text>
    <text x={(PL + W - PR) / 2} y={H - 5} textAnchor="middle" fontSize="9.5" fill="var(--muted)" fontFamily="var(--f-mono)">Km {Math.ceil(values.length / 2)}</text>
    <text x={W - PR} y={H - 5} textAnchor="end" fontSize="9.5" fill="var(--muted)" fontFamily="var(--f-mono)">Km {values.length}</text>
  </svg>
}

function SvgScatterChart({ pts1, pts2, label, xUnit, yUnit }) {
  const all = [...(pts1 || []), ...(pts2 || [])]
  if (all.length < 2) return <p className="muted" style={{ fontSize: 12 }}>Needs Power &amp; HR per-lap telemetry.</p>
  const W = 440, H = 150, PL = 38, PR = 12, PT = 10, PB = 22
  const xs = all.map((p) => p.x), ys = all.map((p) => p.y)
  const xlo = Math.min(...xs), xhi = Math.max(...xs), xsp = (xhi - xlo) || 1
  const ylo = Math.min(...ys), yhi = Math.max(...ys), ysp = (yhi - ylo) || 1
  const xOf = (x) => PL + ((x - xlo) / xsp) * (W - PL - PR)
  const yOf = (y) => H - PB - ((y - ylo) / ysp) * (H - PT - PB)
  const yticks = [ylo, ylo + ysp / 2, yhi]
  return <svg viewBox={`0 0 ${W} ${H}`} className="actv56-svg" role="img" aria-label={label}>
    {yticks.map((t, idx) => {
      const y = yOf(t)
      return <g key={idx}>
        <line x1={PL} x2={W - PR} y1={y} y2={y} stroke="var(--line)" strokeDasharray="3 3" />
        <text x={PL - 5} y={y + 3} textAnchor="end" fontSize="9.5" fill="var(--muted)" fontFamily="var(--f-mono)">{yUnit === 'ratio' ? t.toFixed(2) : Math.round(t)}</text>
      </g>
    })}
    {(pts1 || []).map((p, i) => <circle key={'a' + i} cx={xOf(p.x)} cy={yOf(p.y)} r="4" fill="rgba(147,51,234,0.78)" />)}
    {(pts2 || []).map((p, i) => <circle key={'b' + i} cx={xOf(p.x)} cy={yOf(p.y)} r="4" fill="rgba(234,58,58,0.78)" />)}
    <text x={PL} y={H - 5} fontSize="9.5" fill="var(--muted)" fontFamily="var(--f-mono)">{Math.round(xlo)}{xUnit}</text>
    <text x={W - PR} y={H - 5} textAnchor="end" fontSize="9.5" fill="var(--muted)" fontFamily="var(--f-mono)">{Math.round(xhi)}{xUnit}</text>
  </svg>
}

function fmtZoneDur(sec) {
  const s = Math.max(0, Math.round(sec || 0))
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${String(r).padStart(2, '0')}s`
  return `${r}s`
}

function ZoneListV57({ rows }) {
  const tot = rows.reduce((acc, r) => acc + (r.s || 0), 0) || 1
  const maxS = Math.max(...rows.map((r) => r.s || 0), 1)
  return <div className="actv56-zlist">
    {rows.map((r) => {
      const pct = Math.round(((r.s || 0) / tot) * 1000) / 10
      const w = r.s > 0 ? Math.max(4, Math.round((r.s / maxS) * 100)) : 0
      const parts = String(r.k || '').split(' · ')
      return <div key={r.k} className="actv56-zrow">
        <div className="actv56-zmeta">
          <b className="actv56-zname">{parts[0]}</b>
          {parts[1] && <span className="actv56-zrange">{parts[1]}</span>}
        </div>
        <div className="actv56-ztrack"><div className="actv56-zfill" style={{ width: `${w}%`, background: r.c }} /></div>
        <div className="actv56-zstat"><b>{fmtZoneDur(r.s)}</b><span>{pct.toFixed(1)}%</span></div>
      </div>
    })}
  </div>
}

function collapseTo5Zones(rows) {
  if (rows.length < 7) return rows
  return [
    { k: 'Z1 Warm Up · Recovery', c: '#94A3B8', s: (rows[0]?.s || 0) + (rows[1]?.s || 0) },
    { k: 'Z2 Easy · Aerobic', c: '#3B82F6', s: rows[2]?.s || 0 },
    { k: 'Z3 Tempo · Steady', c: '#10B981', s: rows[3]?.s || 0 },
    { k: 'Z4 Threshold · Sub-Max', c: '#F97316', s: (rows[4]?.s || 0) + (rows[5]?.s || 0) },
    { k: 'Z5 Max · Anaerobic', c: '#EF4444', s: rows[6]?.s || 0 },
  ]
}


const KNOWN_ROUTES = {
  '2026-11-15': [
    [-7.6079, 110.2038], [-7.6115, 110.2010], [-7.6142, 110.1945], [-7.6120, 110.1865],
    [-7.6045, 110.1905], [-7.5988, 110.1872], [-7.5930, 110.1935], [-7.5955, 110.2035],
    [-7.5880, 110.2050], [-7.5815, 110.2135], [-7.5735, 110.2105], [-7.5685, 110.2195],
    [-7.5745, 110.2260], [-7.5845, 110.2185], [-7.5915, 110.2215], [-7.6015, 110.2210],
    [-7.6092, 110.2265], [-7.6115, 110.2215], [-7.6048, 110.2155], [-7.6062, 110.2080],
    [-7.6079, 110.2038],
  ],
}

function decodePolyline(str) {
  if (!str || typeof str !== 'string') return []
  let idx = 0, lat = 0, lng = 0
  const pts = []
  while (idx < str.length) {
    let b, shift = 0, res = 0
    do { b = str.charCodeAt(idx++) - 63; res |= (b & 0x1f) << shift; shift += 5 } while (b >= 0x20)
    lat += (res & 1) ? ~(res >> 1) : (res >> 1)
    shift = 0; res = 0
    do { b = str.charCodeAt(idx++) - 63; res |= (b & 0x1f) << shift; shift += 5 } while (b >= 0x20)
    lng += (res & 1) ? ~(res >> 1) : (res >> 1)
    pts.push([lat / 1e5, lng / 1e5])
  }
  return pts
}

function extractRouteCoords(a) {
  if (!a) return []
  const poly = a.summary_polyline || a.map?.summary_polyline || a.polyline
  if (poly) {
    const decoded = decodePolyline(poly)
    if (decoded.length >= 2) return decoded
  }
  if (Array.isArray(a.track) && a.track.length >= 2) {
    return a.track.map((p) => Array.isArray(p) ? p : [p.lat, p.lon ?? p.lng]).filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]))
  }
  if (KNOWN_ROUTES[a.date]) return KNOWN_ROUTES[a.date]
  return []
}

function ActivityHeroMap({ a, laps, onShare }) {
  const elRef = useRef(null)
  const mapRef = useRef(null)
  const [style, setStyle] = useState('clean')
  const [mapKey] = useStore('lumpad.mapkey', '')
  const keyed = tileSpec(mapKey, false).keyed
  const coords = useMemo(() => extractRouteCoords(a), [a])

  useEffect(() => {
    if (!elRef.current || coords.length < 2) return
    if (mapRef.current) { mapRef.current.remove(); mapRef.current = null }
    const map = L.map(elRef.current, { zoomControl: false, attributionControl: false, scrollWheelZoom: false })
    mapRef.current = map
    const sp = tileSpec(mapKey, false, style)
    L.tileLayer(sp.url, { maxZoom: 18, subdomains: sp.subdomains || 'abc', attribution: '' }).addTo(map)
    const line = L.polyline(coords, { color: '#F26B5B', weight: 4.2, opacity: 0.95, lineJoin: 'round', lineCap: 'round' }).addTo(map)
    L.circleMarker(coords[0], { radius: 6.5, fillColor: '#10B981', color: '#fff', weight: 2.5, fillOpacity: 1 }).addTo(map).bindTooltip('Start')
    const end = coords[coords.length - 1]
    if (end[0] !== coords[0][0] || end[1] !== coords[0][1]) {
      L.circleMarker(end, { radius: 6.5, fillColor: '#EA3A3A', color: '#fff', weight: 2.5, fillOpacity: 1 }).addTo(map).bindTooltip('Finish')
    }
    map.fitBounds(line.getBounds(), { padding: [30, 30] })
    setTimeout(() => map.invalidateSize(), 120)
    return () => { if (mapRef.current) { mapRef.current.remove(); mapRef.current = null } }
  }, [coords, style, mapKey])

  if (coords.length >= 2) {
    return <div className="actv60-map-card">
      {!keyed && <div className="actv60-map-note">OpenStreetMap tiles. Add your CARTO key in Profile for the Clean and Street styles.</div>}
      <div ref={elRef} className="actv60-map-canvas" />
      <div className="actv60-map-controls">
        {keyed && <button type="button" className="actv60-map-pill" onClick={() => setStyle((s) => s === 'clean' ? 'street' : 'clean')}>
          {style === 'clean' ? 'Clean Map' : 'Street Map'}
        </button>}
        <button type="button" className="actv60-map-pill" onClick={onShare}>Share ↗</button>
      </div>
    </div>
  }

  // Graceful Pace + HR Profile Hero Card when activity has no GPS track (e.g., treadmill or COROS summary without polyline)
  const hrVals = (laps || []).map((l) => l.avg_hr).filter(Boolean)
  const paceVals = (laps || []).map((l) => l.avg_pace_s_km).filter(Boolean)
  return <div className="card actv60-map-fallback">
    <div className="actv56-ribbon-top">
      <span>SESSION TELEMETRY PROFILE</span>
      <span>{laps?.length ? `${laps.length} laps` : 'Summary'}</span>
    </div>
    <SvgAreaChart values={paceVals.length >= 2 ? paceVals : hrVals} color="#F26B5B" fill="rgba(242,107,91,0.18)" label="Session pace profile" invert={paceVals.length >= 2} yFmt={paceVals.length >= 2 ? (v) => fmtPaceS(v) : undefined} />
    <p className="muted" style={{ fontSize: 11.5, margin: '6px 0 0' }}>GPS polyline not attached to this record — showing per-lap pace telemetry curve.</p>
  </div>
}

function Detail({ id, gear, gearList = [], vdot, history, go, settings }) {
  const D = useApi(id ? `/api/activities/detail?id=${encodeURIComponent(id)}` : '', !!id), a = D.data
  const [ctx, setCtx] = useStore('lumpad.act.' + (id || 'none').replace(/[^A-Za-z0-9._-]/g, '_'), {
    rpe: '', gels: '', cho_g: '', note: '', tag: '', feels: [], official_bib: '', official_url: '', official_net: '',
  })
  const [tab, setTab] = useState('overview')
  const [lapMode, setLapMode] = useState('all')
  const [hrZoneMode, setHrZoneMode] = useState(7)
  const [shareOpen, setShareOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => { setLapMode('all') }, [id])
  useEffect(() => {
    if (!shareOpen) return
    const onKey = (e) => { if (e.key === 'Escape') setShareOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [shareOpen])

  const p = paces(vdot.v), plan = a ? BY_DATE[a.date] : null, laps = a?.laps || []
  const ef = a ? efOf(a) : null, kind = a ? typeOf(a) : null
  const efHist = a && kind ? history.filter((h) => typeOf(h) === kind && h.date <= a.date && efOf(h)).sort((x, y) => x.date.localeCompare(y.date)).slice(-10).map(efOf) : []
  const dc = decoupling(laps), steady = laps.length >= 4
  const zcfg = cfgOf(settings || {}), zs = laps.length ? zoneSeconds(laps, zcfg) : null, pz = zs && zs.pace.some((x) => x > 0), hz = zs && zs.hr.some((x) => x > 0)

  const activeTag = ctx.tag || defaultTagFor(a, plan)
  const isRace = activeTag === 'Race'
  const officialBase = a ? OFFICIAL_RACES[a.date] : null
  const activeTab = !isRace && tab === 'official' ? 'overview' : tab

  const baseLaps = lapMode === '5k' && laps.length >= 10 ? group5k(laps) : laps
  const shownLaps = useMemo(() => {
    const withDelta = baseLaps.map((l, i) => ({
      ...l,
      delta_s: i === 0 || !l.avg_pace_s_km || !baseLaps[i - 1]?.avg_pace_s_km ? null : (baseLaps[i - 1].avg_pace_s_km - l.avg_pace_s_km),
    }))
    if (lapMode === 'fast') return [...withDelta].filter((l) => l.avg_pace_s_km).sort((x, y) => x.avg_pace_s_km - y.avg_pace_s_km).slice(0, 8)
    if (lapMode === 'fade') return withDelta.filter((l) => (l.avg_pace_s_km || 0) >= 540)
    return withDelta
  }, [baseLaps, lapMode])

  const validPaces = shownLaps.map((l) => l.avg_pace_s_km).filter(Boolean)
  const maxPace = validPaces.length ? Math.max(...validPaces) : 1
  const minPace = validPaces.length ? Math.min(...validPaces) : 1
  const dyn = (k) => { const v = mean(laps.map((l) => l[k])); return v == null ? null : Math.round(v * 100) / 100 }
  const E = [p.E[1], p.E[0]]
  const verdict = a && a.sport_class === 'run' && a.avg_pace_s_km && plan && ['easy', 'social', 'long', 'speed'].includes(plan.kind) ? (a.avg_pace_s_km < E[0] - 3 ? ['yellow', `Faster than easy (${fmtPace(E[0])}–${fmtPace(E[1])})`] : a.avg_pace_s_km > E[1] + 3 ? ['yellow', 'Slower than easy range'] : ['green', 'Within easy range']) : null
  const setC = (patch) => setCtx({ ...ctx, ...patch })
  const activeFeels = Array.isArray(ctx.feels) ? ctx.feels : []
  const toggleFeel = (f) => setC({ feels: activeFeels.includes(f) ? activeFeels.filter((x) => x !== f) : [...activeFeels, f] })

  const tabs = [
    ['overview', 'Overview'],
    ['zones', 'Zones'],
    ['splits', 'Splits'],
    ['drift', 'Drift & GAP'],
    ['matched', 'Matched'],
    ...(isRace ? [['official', 'Official Result']] : []),
  ]

  const copyShare = () => {
    if (!a) return
    const txt = `${a.name} (${activeTag}) — ${a.distance_m ? km(a.distance_m) + ' km' : ''} in ${fmtDur(a.duration_s)} (${fmtPaceS(a.avg_pace_s_km)}/km, Avg HR ${a.avg_hr ?? '—'} bpm) · Lumpad OS 4.5`
    navigator.clipboard?.writeText(txt).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return <div className="detail-page actv56-root" role="region" aria-label={a?.name || 'Activity detail'}>
    {D.state === 'loading' && <div className="skel" style={{ height: 140 }} />}
    {D.state === 'error' && <p className="muted">Could not load this activity — it may not exist, or the server is unreachable.</p>}
    {a && <>
      {/* Preview-Matched Hero: Left Leaflet Route Map + Right Unified Header & Intensity Ribbon */}
      <div className="actv56-hero-grid">
        <ActivityHeroMap a={a} laps={laps} onShare={() => setShareOpen(true)} />

        <div className="card actv60-hero-col">
          <div>
            <div className="actv56-title-row">
              <h2 className="actv56-title">{officialBase && (!a.name || /^outdoor run$/i.test(a.name.trim())) ? officialBase.event : a.name}</h2>
              {a.training_load != null && <span className="actv56-pill cobalt">TL {a.training_load}</span>}
            </div>

            <div className="actv56-badges">
              <StatusPill tone="green">{SPORT_LABEL[a.sport_class] || a.sport}</StatusPill>
              {(a.sources || []).map((s) => <span key={s} className="actv56-pill">{s}</span>)}
              {a.temp_c != null && <span className="actv56-pill amber">{a.temp_c}°C · RH {a.humidity ?? '—'}%</span>}
              <div className="actv56-tag-wrap">
                <span className="actv56-tag-lbl">Tag</span>
                <select className="actv56-wtag-select" data-wtag={activeTag} aria-label="Workout type tag" value={activeTag} onChange={(e) => setC({ tag: e.target.value })}>
                  {WORKOUT_TAGS.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            </div>

            <p className="actv56-meta">
              📅 {fmtLong(a.date)}
              {(ctx.gear_id || a.gear_id) && gear[ctx.gear_id || a.gear_id] ? ` · 👟 ${gear[ctx.gear_id || a.gear_id]}` : ''}
              {officialBase ? ` · 🏷️ ${ctx.official_bib || officialBase.bib}` : ''}
            </p>

            {/* Compact Intervals.icu Intensity Ribbon inside Header */}
            <div className="actv60-ribbon-box">
              <div className="actv56-ribbon-top">
                <span>INTENSITY RIBBON (HR / LAPS)</span>
                <span>{laps.length ? `${laps.length} laps` : fmtDur(a.duration_s)}</span>
              </div>
              <div className="actv56-ribbon-bars" aria-label="Per-lap intensity ribbon">
                {(laps.length ? laps : [{ avg_hr: a.avg_hr }]).map((l, i) => {
                  const hr = l.avg_hr || a.avg_hr || 140
                  const h = Math.max(24, Math.min(100, Math.round(((hr - 105) / 85) * 100)))
                  return <div key={i} className="actv56-rbar" title={`Lap ${i + 1}: ${hr} bpm`} style={{ height: `${h}%`, background: ribbonZoneColor(hr, zcfg.lthr) }} />
                })}
              </div>
              <div className="actv56-ribbon-stats">
                <span>Time <b>{fmtDur(a.duration_s)}</b></span>
                {ef != null && <span>EF <b>{ef}</b></span>}
                {dc && steady && <span>Pa:Hr <b>{dc.pct}%</b></span>}
                {a.adjusted_pace_s_km && <span>GAP <b>{fmtPaceS(a.adjusted_pace_s_km)}/km</b></span>}
              </div>
            </div>

            {officialBase && <div className="actv56-ach-pill" onClick={() => { setC({ tag: 'Race' }); setTab('official') }} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setC({ tag: 'Race' }); setTab('official') } }} role="button" tabIndex={0}>
              <span>♥ {officialBase.status} · {officialBase.net}</span>
              <b>{ctx.official_bib || officialBase.bib} →</b>
            </div>}
          </div>

          <div className="actv56-actions" style={{ marginTop: 12 }}>
            <button type="button" className="actv56-btn-dark" onClick={() => setShareOpen(true)}>Share Card</button>
            <button type="button" className="actv56-btn-cobalt" onClick={() => go('coach')}>Ask Coach</button>
          </div>
        </div>
      </div>

      {/* Runna-Style Unified Borderless 3x2 Mobile / 6-Col Desktop KPI Strip */}
      <div className="card actv60-kpi-card">
        <div className="actv60-kpi"><small>Distance</small><b>{a.distance_m ? `${km(a.distance_m)} km` : '—'}</b><em>{officialBase ? officialBase.net.split('@')[1]?.trim() || 'Official race' : (activeTag + ' session')}</em></div>
        <div className="actv60-kpi"><small>Time</small><b>{fmtDur(a.duration_s)}</b><em>{a.elapsed_s && a.elapsed_s > a.duration_s ? `Elapsed ${fmtDur(a.elapsed_s)}` : 'Moving time'}</em></div>
        <div className="actv60-kpi"><small>Avg Pace</small><b>{a.sport_class === 'run' ? `${fmtPaceS(a.avg_pace_s_km)} /km` : '—'}</b><em>{a.adjusted_pace_s_km ? `GAP ${fmtPaceS(a.adjusted_pace_s_km)} /km` : 'Pace'}</em></div>
        <div className="actv60-kpi"><small>Elev Gain</small><b>{(a.elev_gain_m ?? a.ascent_m ?? a.total_elevation_gain) != null ? `▲ ${Math.round(a.elev_gain_m ?? a.ascent_m ?? a.total_elevation_gain)} m` : (dyn('cadence') ? `${Math.round(dyn('cadence'))} spm` : '—')}</b><em>{dyn('cadence') ? `Cadence ${Math.round(dyn('cadence'))} spm` : 'Elevation'}</em></div>
        <div className="actv60-kpi"><small>Avg HR</small><b>{a.avg_hr ? `${a.avg_hr} bpm` : '—'}</b><em>{a.max_hr ? `Max ${a.max_hr} bpm` : 'Heart rate'}</em></div>
        <div className="actv60-kpi"><small>{a.calories ? 'Calories' : 'Efficiency'}</small><b>{a.calories ? Math.round(a.calories).toLocaleString() : (ef ?? '—')}</b><em>{dc && steady ? `EF ${ef ?? '—'} · Pa:Hr ${dc.pct}%` : `EF ${ef ?? '—'}`}</em></div>
      </div>

      {/* Sticky Thumb-Friendly Segmented Tabs */}
      <div className="actv56-tabs-wrap">
        <nav className="actv56-tabs" role="tablist" aria-label="Activity detail sections">
          {tabs.map(([k, label]) => (
            <button key={k} type="button" role="tab" aria-selected={activeTab === k} className={`actv56-tab ${activeTab === k ? 'active' : ''}`} onClick={() => setTab(k)}>
              {label}
            </button>
          ))}
        </nav>
      </div>

      {/* TAB 1: OVERVIEW (1-Col Mobile, 2-Col Desktop) */}
      {activeTab === 'overview' && <div className="actv56-overview-grid">
        <div>
          <div className="card actv56-insight-wrap">
            <div className="actv56-card-head">
              <div>
                <h3 className="actv56-card-title">Workout Insights</h3>
                <p className="muted" style={{ margin: '2px 0 0', fontSize: 12 }}>Grounded in FIT telemetry &amp; Coach RAG</p>
              </div>
              <span className="actv56-ai-badge">✦ Lumpad AI</span>
            </div>
            <div className="actv56-feel-chips">
              {FEEL_OPTIONS.map((f) => (
                <button key={f} type="button" className={`actv56-feel ${activeFeels.includes(f) ? 'active' : ''}`} onClick={() => toggleFeel(f)}>{f}</button>
              ))}
            </div>
            {a.sport_class === 'run' && (a.distance_m || 0) >= 5000
              ? <ActivityCoach id={a.ids?.[0] || id} label={String(a.ids?.[0] || id).replace(/^coros:/, '')} />
              : <p className="muted" style={{ margin: '8px 0 0' }}>AI deep narrative runs automatically on runs ≥ 5 km. Use Ask Coach to query this session.</p>}
            <div className="actv56-rate-bar">
              <span>{ctx.rating ? 'Feedback logged to Coach' : 'Rate this insight'}</span>
              <div style={{ display: 'flex', gap: 6 }}>
                <button type="button" className={`actv56-rate-btn ${ctx.rating === 'up' ? 'active' : ''}`} aria-label="Thumbs up" onClick={() => setC({ rating: ctx.rating === 'up' ? '' : 'up' })}>👍</button>
                <button type="button" className={`actv56-rate-btn ${ctx.rating === 'down' ? 'active' : ''}`} aria-label="Thumbs down" onClick={() => setC({ rating: ctx.rating === 'down' ? '' : 'down' })}>👎</button>
              </div>
            </div>
          </div>
        </div>

        <div>
          <div className="card">
            <div className="actv56-card-head">
              <h3 className="actv56-card-title">Running Dynamics</h3>
              <span className="actv56-pill cobalt">TE {a.aerobic_te ?? '—'} / {a.anaerobic_te ?? '—'}</span>
            </div>
            <div className="actv56-dyn-grid">
              <div className="actv56-dyn-tile"><small>GCT</small><b>{dyn('gct_ms') != null ? `${Math.round(dyn('gct_ms'))} ms` : '—'}</b></div>
              <div className="actv56-dyn-tile"><small>Vert Osc</small><b>{dyn('vo_cm') != null ? `${dyn('vo_cm')} cm` : '—'}</b></div>
              <div className="actv56-dyn-tile"><small>Vert Ratio</small><b>{dyn('vratio_pct') != null ? `${dyn('vratio_pct')}%` : '—'}</b></div>
              <div className="actv56-dyn-tile"><small>Avg Power</small><b>{dyn('power') != null ? `${Math.round(dyn('power'))} W` : '—'}</b></div>
              <div className="actv56-dyn-tile"><small>Stride</small><b>{dyn('stride_m') != null ? `${dyn('stride_m')} m` : '—'}</b></div>
              <div className="actv56-dyn-tile"><small>EF / Pa:Hr</small><b>{ef ?? '—'}{dc && steady ? ` / ${dc.pct}%` : ''}</b></div>
            </div>
          </div>

          <Card title="Session Log & Fueling">
            <div className="form two">
              <label className="fld"><span>Shoe used (syncs to Twin &amp; FIT)</span>
                <select value={ctx.gear_id ?? a.gear_id ?? ''} onChange={(e) => { const g = e.target.value; setC({ gear_id: g }); fetch('/api/activities/shoe', { method: 'POST', headers: { 'content-type': 'application/json', 'x-lumpad': '1' }, body: JSON.stringify({ id: a.ids?.[0] || id, gear_id: g || null }) }).catch(() => {}) }}>
                  <option value="">— Not assigned —</option>
                  {Object.entries(gear).map(([gid, gname]) => <option key={gid} value={gid}>{gname}</option>)}
                </select>
              </label>
              <div className="fld"><span>GI distress</span>
                <div className="pain" role="group" aria-label="GI distress" style={{ gridTemplateColumns: 'repeat(4,1fr)' }}>{[[0, 'None'], [1, 'Mild'], [2, 'Mod'], [3, 'Severe']].map(([n, l]) => <button key={n} type="button" aria-pressed={ctx.gi === n} className={n >= 2 ? 'hi' : ''} onClick={() => setC({ gi: ctx.gi === n ? '' : n })}>{l}</button>)}</div>
              </div>
            </div>
            <div className="fld" style={{ marginTop: 12 }}><span>Session RPE (1–10)</span><div className="pill10" role="group" aria-label="RPE">{Array.from({ length: 10 }, (_, i) => i + 1).map((n) => <button key={n} type="button" aria-pressed={ctx.rpe === n} onClick={() => setC({ rpe: ctx.rpe === n ? '' : n })}>{n}</button>)}</div></div>
            <div className="form two" style={{ marginTop: 10 }}>
              <label className="fld"><span>Gels taken</span><input inputMode="numeric" type="number" value={ctx.gels} onChange={(e) => setC({ gels: e.target.value === '' ? '' : +e.target.value })} /></label>
              <label className="fld"><span>Actual carbs (g)</span><input inputMode="numeric" type="number" value={ctx.cho_g} onChange={(e) => setC({ cho_g: e.target.value === '' ? '' : +e.target.value })} /></label>
            </div>
            {ctx.cho_g !== '' && a.duration_s > 0 && <p className="muted">≈ {Math.round(ctx.cho_g / (a.duration_s / 3600))} g/h (target &gt;90 min: 30–60 g/h)</p>}
            <label className="fld" style={{ display: 'block', marginTop: 10 }}><span>Session notes</span><input type="text" placeholder="Pacing, heat, mechanical feel…" value={ctx.note || ''} onChange={(e) => setC({ note: e.target.value })} /></label>
          </Card>
        </div>
      </div>}

      {/* TAB 2: ZONES (Hybrid 1-Col Top + 2-Col Bottom on Desktop) */}
      {activeTab === 'zones' && <>
        {(pz || hz) && <div className="card">
          <div className="actv56-card-head">
            <div>
              <h3 className="actv56-card-title">Heart Rate Zones</h3>
              <p className="muted" style={{ margin: '2px 0 0', fontSize: 12 }}>LTHR {zcfg.lthr} bpm · Avg {a.avg_hr ?? '—'} · Max {a.max_hr ?? '—'}</p>
            </div>
            <div className="actv56-mtoggle" role="group" aria-label="HR zone model">
              <button type="button" className={hrZoneMode === 7 ? 'active' : ''} onClick={() => setHrZoneMode(7)}>7-Zone</button>
              <button type="button" className={hrZoneMode === 5 ? 'active' : ''} onClick={() => setHrZoneMode(5)}>5-Zone</button>
            </div>
          </div>
          {hz && (() => {
            const rawHr = ZROWS(zcfg, 'hr').map((r, i) => ({ ...r, s: zs.hr[i] }))
            return <ZoneListV57 rows={hrZoneMode === 5 ? collapseTo5Zones(rawHr) : rawHr} />
          })()}
          {hz && pz && (() => { const top = (arr) => arr.indexOf(Math.max(...arr)), dh = top(zs.hr), dp = top(zs.pace); return dh - dp >= 2 ? <p className="banner" style={{ marginTop: 12 }}>HR sat {dh - dp} zones higher than pace (HR Z{dh} vs pace {dp ? 'Z' + dp : '<Z1'}): judge by HR, not pace.</p> : null })()}
        </div>}
        <div className="actv56-two-col">
          {laps.some((l) => l.power > 0) && <Card title={`Power Zones (Avg ${Math.round(dyn('power') || 0)}W · incl. Sweet Spot)`}>
            <ZoneListV57 rows={computePowerZones(laps, settings?.ftp || 199)} />
          </Card>}
          {pz && <Card title={`Pace Zones (T-Pace ${fmtPaceS(zcfg.tpace)}/km)`}>
            <ZoneListV57 rows={ZROWS(zcfg, 'pace').map((r, i) => ({ ...r, s: zs.pace[i] }))} />
          </Card>}
        </div>
        <Card title="Aerobic Efficiency & Plan vs Actual">
            <div className="mgrid two">
              <div><small>Efficiency Factor <Info k="EF" /></small><b>{ef ?? '—'}</b><Sparkline data={efHist} label={`EF last 10 ${kind} runs`} w={110} /></div>
              <div><small>Decoupling Pa:Hr <Info k="Decoupling" /></small><b>{dc && steady ? dc.pct + '%' : '—'}</b>{dc && steady ? <Chip tone={dc.band}>{dc.band === 'green' ? 'durable' : dc.band === 'yellow' ? 'moderate drift' : 'high drift'}</Chip> : <em className="muted">{steady ? 'needs ≥4 laps' : 'steady runs only'}</em>}</div>
            </div>
            {plan && <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--line)' }}>
              <div className="vs"><div><small>Planned</small><b>{plan.label}{plan.km ? ` · ${plan.km} km` : ''}</b></div><div><small>Actual</small><b>{a.distance_m ? km(a.distance_m) + ' km' : fmtDur(a.duration_s)}</b></div></div>
              {verdict && <div style={{ marginTop: 6 }}><Chip tone={verdict[0]}>{verdict[1]}</Chip></div>}
            </div>}
          </Card>
      </>}

      {/* TAB 3: SPLITS (Runna Bars — 1-Col Mobile, 2-Col Desktop) */}
      {activeTab === 'splits' && <Card title={`Kilometer Splits (${shownLaps.length} shown)`}>
        <div className="actv56-split-filters">
          {[['all', `All (${laps.length})`], ['5k', '5K Blocks'], ['fast', 'Fastest 8'], ['fade', 'Fade (>9:00)']].map(([k, l]) => (
            <button key={k} type="button" className={`actv56-fchip ${lapMode === k ? 'active' : ''}`} onClick={() => setLapMode(k)}>{l}</button>
          ))}
        </div>
        {!shownLaps.length
          ? <p className="muted">No splits match this filter.</p>
          : <>
            <div className="actv56-splits-hdr-wrap">
              <div className="actv56-splits-hdr"><span>KM</span><span>AVG PACE</span><span style={{ textAlign: 'right' }}>HR</span><span style={{ textAlign: 'right' }}>+/-</span></div>
              <div className="actv56-splits-hdr actv56-dup" aria-hidden="true"><span>KM</span><span>AVG PACE</span><span style={{ textAlign: 'right' }}>HR</span><span style={{ textAlign: 'right' }}>+/-</span></div>
            </div>
            {(() => {
              const renderRow = (l) => {
                const sec = l.avg_pace_s_km || maxPace
                const ratio = maxPace === minPace ? 0.85 : 0.45 + 0.55 * ((maxPace - sec) / (maxPace - minPace))
                const pct = Math.round(Math.max(35, Math.min(100, ratio * 100)))
                const isFast = l.avg_pace_s_km && l.avg_pace_s_km === minPace
                const d = fmtDeltaSec(l.delta_s)
                return <div key={l.idx} className="actv56-split-row">
                  <span className="actv56-skm">{l.idx}{lapMode === 'all' && l.distance_m && l.distance_m < 950 ? ` (${(l.distance_m / 1000).toFixed(2)})` : ''}</span>
                  <div className="actv56-strack"><div className={`actv56-sfill ${isFast ? 'fast' : ''}`} style={{ width: `${pct}%` }}>{fmtPaceS(l.avg_pace_s_km)}/km</div></div>
                  <span className="actv56-shr">{l.avg_hr ?? '—'}</span>
                  <span className={`actv56-sdelta ${d.cls}`}>{d.text}</span>
                </div>
              }
              const mid = Math.ceil(shownLaps.length / 2)
              return <div className="actv56-splits-cols">
                <div className="actv56-splits-col">{shownLaps.slice(0, mid).map(renderRow)}</div>
                <div className="actv56-splits-col">{shownLaps.slice(mid).map(renderRow)}</div>
              </div>
            })()}
          </>}
      </Card>}

      {/* TAB 4: DRIFT & GAP (4 Preview Charts + Per-Second FIT) */}
      {activeTab === 'drift' && <>
        {laps.length > 1 && (() => {
          const paceVals = laps.map((l) => l.avg_pace_s_km || a.avg_pace_s_km || 480)
          const hrVals = laps.map((l) => l.avg_hr || a.avg_hr || 150)
          const elevVals = laps.map((l, i) => l.elev_gain_m ?? l.elevation_m ?? (i * 4))
          const half = Math.ceil(laps.length / 2)
          let cumMin = 0
          const phr1 = [], phr2 = [], dr1 = [], dr2 = []
          laps.forEach((l, i) => {
            cumMin += (l.duration_s || 0) / 60
            if (l.power > 0 && l.avg_hr > 0) {
              const pObj = { x: cumMin, y: l.power / l.avg_hr }
              const dObj = { x: l.power, y: l.avg_hr }
              if (i < half) { phr1.push(pObj); dr1.push(dObj) } else { phr2.push(pObj); dr2.push(dObj) }
            }
          })
          return <div className="actv56-two-col">
            <Card title="Grade Adjusted Pace (GAP) & Elevation">
              <div className="actv56-chart-kpis"><span>Avg GAP <Info k="GAP" /> <b>{a.adjusted_pace_s_km ? fmtPaceS(a.adjusted_pace_s_km) + '/km' : fmtPaceS(a.avg_pace_s_km) + '/km'}</b></span><span>Fastest <b>{fmtPaceS(Math.min(...paceVals))}/km</b></span></div>
              <SvgAreaChart values={paceVals} secondary={elevVals} color="#3B82F6" fill="rgba(59,130,246,0.18)" label="Pace and elevation" invert yFmt={(v) => fmtPaceS(v)} />
            </Card>
            <Card title="Heart Rate Stream">
              <div className="actv56-chart-kpis"><span>Avg HR <b>{a.avg_hr ?? '—'} bpm</b></span><span>Max HR <b>{a.max_hr ?? '—'} bpm</b></span><span>LTHR <b>{zcfg.lthr} bpm</b></span></div>
              <SvgAreaChart values={hrVals} color="#EA3A3A" fill="rgba(234,58,58,0.16)" label="Heart rate stream" minY={Math.max(100, Math.min(...hrVals) - 10)} maxY={Math.max(...hrVals) + 6} />
            </Card>
            <Card title="Power / HR Decoupling">
              <div className="actv56-chart-kpis"><span>EF <b>{ef ?? '—'}</b></span><span>Decoupling <b>{dc ? dc.pct + '%' : '—'}</b></span><span><b style={{ color: '#9333EA' }}>●</b> 1st Half</span><span><b style={{ color: '#EA3A3A' }}>●</b> 2nd Half</span></div>
              <SvgScatterChart pts1={phr1} pts2={phr2} label="Power to HR ratio over time" xUnit="m" yUnit="ratio" />
            </Card>
            <Card title="Power–HR Drift (1st vs 2nd Half)">
              <div className="actv56-chart-kpis"><span>Avg Power <b>{dyn('power') ? Math.round(dyn('power')) + 'W' : '—'}</b></span><span><b style={{ color: '#9333EA' }}>●</b> 1st Half</span><span><b style={{ color: '#EA3A3A' }}>●</b> 2nd Half</span></div>
              <SvgScatterChart pts1={dr1} pts2={dr2} label="Power vs HR drift" xUnit="w" yUnit="bpm" />
            </Card>
          </div>
        })()}
        {a.sport_class === 'run' && <FitPanel id={a.ids?.[0] || id} go={go} />}
      </>}

      {/* TAB 5: MATCHED RUNS, EF TREND & GEAR LIFESPAN */}
      {activeTab === 'matched' && (() => {
        const recentRuns = history.filter((h) => h.sport_class === 'run' && (h.distance_m || 0) >= 3000 && h.date <= a.date).sort((x, y) => y.date.localeCompare(x.date)).slice(0, 6)
        const efSeries = [...recentRuns].reverse().map((r) => efOf(r)).filter(Boolean)
        const activeGearId = ctx.gear_id || a.gear_id
        const gearObj = gearList.find((g) => String(g.id) === String(activeGearId))
        const shoeKm = gearObj ? Math.round((gearObj.distance_m || (gearObj.km ? gearObj.km * 1000 : 0)) / 1000) : null
        const shoeMax = gearObj?.max_km || 650
        const shoePct = shoeKm != null ? Math.min(100, Math.round((shoeKm / shoeMax) * 100)) : 45
        return <div className="actv56-overview-grid">
          <div>
            <Card title="Matched & Recent Runs (EF Trend)">
              {efSeries.length >= 2 && <SvgAreaChart values={efSeries} color="#4658D6" fill="rgba(70,88,214,0.14)" label="Efficiency Factor trend" yFmt={(v) => v.toFixed(2)} />}
              <div className="actv60-matched-list">
                {recentRuns.map((r) => (
                  <div key={r.ids?.[0] || r.id} className="actv60-matched-row" onClick={() => go('activity', { id: r.ids?.[0] || r.id })} role="button" tabIndex={0}>
                    <div>
                      <div className="actv60-mtitle">{OFFICIAL_RACES[r.date]?.event || r.name}</div>
                      <div className="actv60-msub">{fmtLong(r.date)} · {km(r.distance_m)} km</div>
                    </div>
                    <div className="actv60-mright">
                      <div className="actv60-mpace">{fmtPaceS(r.avg_pace_s_km)} /km</div>
                      <div className="actv60-mef">EF {efOf(r) ?? '—'}</div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
            {a.sport_class === 'run' && <RunCompare a={a} id={id} history={history} />}
          </div>

          <div>
            <Card title="Gear & Sensors">
              <div className="actv60-gear-tile">
                <div className="actv60-gear-ico">👟</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="actv56-gear-row">
                    <b style={{ fontSize: 13.5 }}>{activeGearId && gear[activeGearId] ? gear[activeGearId] : 'No shoe assigned'}</b>
                    <span className="actv56-pill" style={{ color: 'var(--green-t)' }}>{shoePct >= 85 ? 'Near Retire' : 'Healthy Foam'}</span>
                  </div>
                  <div className="muted" style={{ fontSize: 11.5, marginTop: 2 }}>
                    {shoeKm != null ? `${shoeKm} / ${shoeMax} km logged · ${shoePct}% lifespan` : 'Assign a shoe in Overview to track mileage'}
                  </div>
                  {shoeKm != null && <div className="actv60-gear-bar"><div style={{ width: `${shoePct}%`, background: shoePct >= 85 ? 'var(--amber)' : 'var(--green)' }} /></div>}
                </div>
              </div>
              <div className="actv60-gear-tile" style={{ marginBottom: 0 }}>
                <div className="actv60-gear-ico">⌚</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="actv56-gear-row">
                    <b style={{ fontSize: 13.5 }}>COROS APEX 4 42mm</b>
                    <button type="button" className="actv56-fchip" onClick={() => go('profile')}>Manage Gear →</button>
                  </div>
                  <div className="muted" style={{ fontSize: 11.5, marginTop: 2 }}>{(a.sources || []).join(' + ') || 'COROS'} · FIT Telemetry Synced</div>
                </div>
              </div>
            </Card>
            {a.sport_class === 'run' && (a.distance_m || 0) >= 16000 && <LongRunContext label={String(a.ids?.[0] || id).replace(/^coros:/, '')} go={go} />}
          </div>
        </div>
      })()}

      {/* TAB 6: OFFICIAL RESULT (Shown only when Tag === 'Race') */}
      {activeTab === 'official' && isRace && <div className="actv56-overview-grid">
        <div className="card">
          <div className="actv56-card-head">
            <div>
              <h3 className="actv56-card-title">{officialBase?.event || a.name}</h3>
              <p className="muted" style={{ margin: '2px 0 0', fontSize: 12 }}>{officialBase?.provider || 'Official Chip Timing'}</p>
            </div>
            <span className="actv56-pill red">{ctx.official_bib || officialBase?.bib || 'Bib N/A'}</span>
          </div>

          <div className="actv56-off-grid" style={{ marginBottom: 12 }}>
            <div className="actv56-dyn-tile"><small>Net / Chip</small><b>{ctx.official_net || officialBase?.net || fmtDur(a.duration_s)}</b></div>
            <div className="actv56-dyn-tile"><small>Gun / Watch</small><b>{officialBase?.gun || fmtDur(a.duration_s)}</b></div>
            <div className="actv56-dyn-tile"><small>Status</small><b>{officialBase?.status || 'Race'}</b></div>
          </div>

          {officialBase?.rank && <p className="muted" style={{ margin: '0 0 12px', fontSize: 12.5 }}><b>Rank / Standing:</b> {officialBase.rank}</p>}

          {(ctx.official_url || officialBase?.url) && (
            <a href={ctx.official_url || officialBase.url} target="_blank" rel="noopener noreferrer" className="actv56-btn-cobalt" style={{ display: 'inline-flex', textDecoration: 'none', padding: '0 16px' }}>
              Open Official Result Link ↗
            </a>
          )}

          <div className="form two" style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--line)' }}>
            <label className="fld"><span>Bib Number</span><input type="text" placeholder="#B13718" value={ctx.official_bib || officialBase?.bib || ''} onChange={(e) => setC({ official_bib: e.target.value })} /></label>
            <label className="fld"><span>Official Result URL</span><input type="url" placeholder="https://scorenow.id/..." value={ctx.official_url || officialBase?.url || ''} onChange={(e) => setC({ official_url: e.target.value })} /></label>
          </div>
        </div>

        <Card title="Official Timing Mat Splits">
          {officialBase?.splits?.length ? (
            <div className="scroll" tabIndex={0}><table className="lapt">
              <thead><tr><th>Checkpoint</th><th>Cumulative Time</th><th>Split Pace</th></tr></thead>
              <tbody>
                {officialBase.splits.map(([cp, t, sp]) => (
                  <tr key={cp}><td><b>{cp}</b></td><td style={{ fontFamily: 'var(--f-mono)' }}>{t}</td><td style={{ fontFamily: 'var(--f-mono)' }}>{sp}</td></tr>
                ))}
              </tbody>
            </table></div>
          ) : <p className="muted">No preloaded official mat splits for this date. Watch splits are available in the Splits tab.</p>}
        </Card>
      </div>}

      {/* Share Card Modal */}
      {shareOpen && <div className="actv56-modal-bg" onClick={(e) => { if (e.target === e.currentTarget) setShareOpen(false) }}>
        <div className="card actv56-modal" role="dialog" aria-modal="true" aria-label="Share activity card">
          <div className="actv56-card-head">
            <h3 className="actv56-card-title">Share Activity Card</h3>
            <button type="button" className="actv56-fchip" onClick={() => setShareOpen(false)}>Close</button>
          </div>
          <div className="actv56-poster">
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#A5B4FC', fontWeight: 700 }}>
              <span>LUMPAD OS 4.5</span>
              <span>{fmtLong(a.date)}</span>
            </div>
            <div style={{ fontSize: 18, fontWeight: 800, marginTop: 6 }}>{a.name}</div>
            <div style={{ fontSize: 12, color: '#CBD5E1', marginTop: 2 }}>{activeTag}{officialBase ? ` · Bib ${ctx.official_bib || officialBase.bib}` : ''}</div>
            <div className="actv56-poster-grid">
              <div><small>Distance</small><b>{a.distance_m ? `${km(a.distance_m)} km` : '—'}</b></div>
              <div><small>Time</small><b>{fmtDur(a.duration_s)}</b></div>
              <div><small>Avg Pace</small><b>{fmtPaceS(a.avg_pace_s_km)}/km</b></div>
              <div><small>Avg HR</small><b>{a.avg_hr ?? '—'} bpm</b></div>
              <div><small>Load</small><b>{a.training_load ?? '—'}</b></div>
              <div><small>EF</small><b>{ef ?? '—'}</b></div>
            </div>
          </div>
          <button type="button" className="actv56-btn-cobalt" style={{ width: '100%' }} onClick={copyShare}>{copied ? 'Copied Summary ✓' : 'Copy Share Summary'}</button>
        </div>
      </div>}
    </>}
  </div>
}
