import { useMemo, useState } from 'react'
import { paces, fmtPace } from './lib/vdot.js'
import { BY_DATE, today, addDays, fmtLong, MONTHS } from './lib/calendar.js'
import { efOf, decoupling, cumulativeKm } from './lib/analysis.js'
import { mean } from './lib/stats.js'
import { useStore } from './store.js'
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

  const flat = [...(A.data || [])].sort((x, y) => (y.date + (y.start_ts || '')).localeCompare(x.date + (x.start_ts || ''))), at = sel ? flat.findIndex((a) => a.ids.includes(sel)) : -1
  const older = at >= 0 ? flat[at + 1] : null, newer = at > 0 ? flat[at - 1] : null

  if (sel) return <section className="screen">
    {/* Unified Dedicated Run Analysis Top Bar */}
    <div className="card prof-cmd">
      <div className="prof-cmd-top">
        <div className="prof-chips">
          <button type="button" className="btn sm" onClick={() => go('activity')}><Icon n="left" size={16} /> Back to Activities</button>
          <StatusPill tone="cobalt">Dedicated Run Analysis · COROS + Strava</StatusPill>
        </div>
        <div className="prof-chips">
          <button type="button" className="btn sm" disabled={!older} onClick={() => older && go('activity', { id: (older.ids?.[0] || older.id) })}>← Previous Run</button>
          <button type="button" className="btn sm" disabled={!newer} onClick={() => newer && go('activity', { id: (newer.ids?.[0] || newer.id) })}>Next Run →</button>
        </div>
      </div>
      <nav className="chipjump prof-cmd-bar" style={{ margin: 0 }} aria-label="Jump to section">
        {[['KPIs', null], ['Per-second FIT', 'Per-second'], ['Long-run comparison', 'Long-run'], ['AI analysis', 'Coach'], ['Per-lap telemetry', 'Per-lap'], ['Laps & Zones', 'Splits']].map(([l, h]) => <button key={l} onClick={() => { const el = h ? [...document.querySelectorAll('.card h2')].find((x) => x.textContent.includes(h)) : document.querySelector('.screen'); el?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }}>{l}</button>)}
      </nav>
    </div>
    <Detail id={sel} page gear={gear} vdot={vdot} history={Hist.data || []} go={go} settings={settings} />
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
  const bench = pick === 'prev' ? same[0] : pick === 'longest' ? [...runs].sort((x, y) => (y.distance_m || 0) - (x.distance_m || 0))[0] : pick === 'bestEF' ? [...same].filter((h) => efOf(h)).sort((x, y) => efOf(y) - efOf(x))[0] : runs.find((h) => h.ids?.[0] === pick || h.id === pick)
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
function ZoneBars({ title, rows }) { const tot = rows.reduce((a, r) => a + r.s, 0) || 1; return <div className="zbars"><h3>{title}</h3>{rows.map((r) => <div key={r.k} className="zrow"><span>{r.k}</span><div className="tb"><i style={{ width: (r.s / tot) * 100 + '%', background: r.c }} /></div><b>{Math.round((r.s / tot) * 100)}%</b></div>)}</div> }

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

function Detail({ id, gear, vdot, history, go, settings }) {
  const D = useApi(id ? `/api/activities/detail?id=${encodeURIComponent(id)}` : '', !!id), a = D.data
  const [ctx, setCtx] = useStore('lumpad.act.' + (id || 'none').replace(/[^A-Za-z0-9._-]/g, '_'), {
    rpe: '', gels: '', cho_g: '', note: '', tag: '', feels: [], official_bib: '', official_url: '', official_net: '',
  })
  const [tab, setTab] = useState('overview')
  const [lapMode, setLapMode] = useState('all')
  const [shareOpen, setShareOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  const p = paces(vdot.v), plan = a ? BY_DATE[a.date] : null, laps = a?.laps || []
  const ef = a ? efOf(a) : null, kind = a ? typeOf(a) : null
  const efHist = a && kind ? history.filter((h) => typeOf(h) === kind && h.date <= a.date && efOf(h)).sort((x, y) => x.date.localeCompare(y.date)).slice(-10).map(efOf) : []
  const dc = decoupling(laps), steady = kind === 'easy' || kind === 'long'
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
      {/* Hybrid 1-Col Mobile / 2-Col Desktop Hero */}
      <div className="actv56-hero-grid">
        <div className="card actv56-hero-main">
          <div className="actv56-title-row">
            <h2 className="actv56-title">{a.name}</h2>
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
            {fmtLong(a.date)}
            {(ctx.gear_id || a.gear_id) && gear[ctx.gear_id || a.gear_id] ? ` · Shoe: ${gear[ctx.gear_id || a.gear_id]}` : ''}
            {officialBase ? ` · Bib ${ctx.official_bib || officialBase.bib}` : ''}
          </p>

          <div className="actv56-actions">
            <button type="button" className="actv56-btn-dark" onClick={() => setShareOpen(true)}>Share Card</button>
            <button type="button" className="actv56-btn-cobalt" onClick={() => go('coach')}>Ask Coach</button>
          </div>
        </div>

        {/* Intervals.icu Intensity Ribbon Card */}
        <div className="card actv56-ribbon-card">
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
            {a.training_load != null && <span>Load <b>{a.training_load}</b></span>}
            {ef != null && <span>EF <b>{ef}</b></span>}
            {dc && steady && <span>Pa:Hr <b>{dc.pct}%</b></span>}
            {a.adjusted_pace_s_km && <span>GAP <b>{fmtPaceS(a.adjusted_pace_s_km)}/km</b></span>}
          </div>
          {officialBase && <div className="actv56-ach-pill" onClick={() => { setC({ tag: 'Race' }); setTab('official') }} role="button" tabIndex={0}>
            <span>♥ {officialBase.status} · {officialBase.net}</span>
            <b>{ctx.official_bib || officialBase.bib} →</b>
          </div>}
        </div>
      </div>

      {/* Full-Width 3x2 Mobile / 6-Col Desktop KPI Strip */}
      <div className="card actv56-kpi-strip">
        <div className="actv56-kpi"><small>Distance</small><b>{a.distance_m ? `${km(a.distance_m)} km` : '—'}</b></div>
        <div className="actv56-kpi"><small>Moving Time</small><b>{fmtDur(a.duration_s)}</b></div>
        <div className="actv56-kpi"><small>Avg Pace</small><b>{a.sport_class === 'run' ? `${fmtPaceS(a.avg_pace_s_km)} /km` : '—'}</b></div>
        <div className="actv56-kpi"><small>GAP <Info k="GAP" /></small><b>{a.adjusted_pace_s_km ? `${fmtPaceS(a.adjusted_pace_s_km)} /km` : '—'}</b></div>
        <div className="actv56-kpi"><small>Avg / Max HR</small><b>{a.avg_hr ?? '—'}{a.max_hr ? ` / ${a.max_hr}` : ''}</b></div>
        <div className="actv56-kpi"><small>Efficiency <Info k="EF" /></small><b>{ef ?? '—'}{dc && steady ? ` / ${dc.pct}%` : ''}</b></div>
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
          </div>
        </div>

        <div>
          <div className="card">
            <div className="actv56-card-head">
              <h3 className="actv56-card-title">Running Dynamics</h3>
              <span className="actv56-pill cobalt">TE {a.aerobic_te ?? '—'} / {a.anaerobic_te ?? '—'}</span>
            </div>
            <div className="actv56-dyn-grid">
              <div className="actv56-dyn-tile"><small>GCT</small><b>{dyn('gct_ms') != null ? `${dyn('gct_ms')} ms` : '—'}</b></div>
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
        {(pz || hz) && <Card title={`Heart Rate Zones (LTHR ${zcfg.lthr} bpm)`}>
          {hz && <ZoneBars title="Heart Rate Distribution" rows={ZROWS(zcfg, 'hr').map((r, i) => ({ ...r, s: zs.hr[i] }))} />}
          {hz && pz && (() => { const top = (arr) => arr.indexOf(Math.max(...arr)), dh = top(zs.hr), dp = top(zs.pace); return dh - dp >= 2 ? <p className="banner">HR sat {dh - dp} zones higher than pace (HR Z{dh} vs pace {dp ? 'Z' + dp : '<Z1'}): judge by HR, not pace.</p> : null })()}
        </Card>}
        <div className="actv56-two-col">
          {pz && <Card title={`Pace Zones (T-Pace ${fmtPaceS(zcfg.tpace)}/km)`}>
            <ZoneBars title="Pace Distribution" rows={ZROWS(zcfg, 'pace').map((r, i) => ({ ...r, s: zs.pace[i] }))} />
          </Card>}
          <Card title="Aerobic Efficiency & Plan vs Actual">
            <div className="mgrid two">
              <div><small>Efficiency Factor <Info k="EF" /></small><b>{ef ?? '—'}</b><Sparkline data={efHist} label={`EF last 10 ${kind} runs`} w={110} /></div>
              <div><small>Decoupling Pa:Hr <Info k="Decoupling" /></small><b>{dc && steady ? dc.pct + '%' : '—'}</b>{dc && steady ? <Chip tone={dc.band}>{dc.band === 'green' ? 'durable' : dc.band === 'yellow' ? 'moderate drift' : 'high drift'}</Chip> : <em className="muted">{steady ? 'needs ≥4 laps' : 'steady runs only'}</em>}</div>
            </div>
            {plan && <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
              <div className="vs"><div><small>Planned</small><b>{plan.label}{plan.km ? ` · ${plan.km} km` : ''}</b></div><div><small>Actual</small><b>{a.distance_m ? km(a.distance_m) + ' km' : fmtDur(a.duration_s)}</b></div></div>
              {verdict && <div style={{ marginTop: 6 }}><Chip tone={verdict[0]}>{verdict[1]}</Chip></div>}
            </div>}
          </Card>
        </div>
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
            <div className="actv56-splits-grid">
              {shownLaps.map((l) => {
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
              })}
            </div>
          </>}
      </Card>}

      {/* TAB 4: DRIFT & GAP (Per-Second FIT + Multi-Channel Telemetry) */}
      {activeTab === 'drift' && <>
        {a.sport_class === 'run' && <FitPanel id={a.ids?.[0] || id} go={go} />}
        {laps.length > 1 && <Card title="Per-Lap Multi-Channel Telemetry"><MultiTrack laps={laps} tracks={[{ key: 'avg_pace_s_km', label: 'Pace', color: 'var(--c-long)', invert: true, fmt: fmtPaceS }, { key: 'avg_hr', label: 'HR', color: 'var(--red)' }, { key: 'cadence', label: 'Cadence', color: 'var(--c-quality)' }, { key: 'power', label: 'Power', color: 'var(--c-tt)' }, { key: 'stride_m', label: 'Stride', color: 'var(--c-social)' }]} /></Card>}
      </>}

      {/* TAB 5: MATCHED RUNS & LONG-RUN CONTEXT */}
      {activeTab === 'matched' && <div className="actv56-overview-grid">
        <div>{a.sport_class === 'run' && <RunCompare a={a} id={id} history={history} />}</div>
        <div>{a.sport_class === 'run' && (a.distance_m || 0) >= 16000 && <LongRunContext label={String(a.ids?.[0] || id).replace(/^coros:/, '')} go={go} />}</div>
      </div>}

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

          <div className="actv56-dyn-grid" style={{ marginBottom: 12 }}>
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

          <div className="form two" style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
            <label className="fld"><span>Bib Number</span><input type="text" placeholder="#B13718" value={ctx.official_bib || officialBase?.bib || ''} onChange={(e) => setC({ official_bib: e.target.value })} /></label>
            <label className="fld"><span>Official Result URL</span><input type="url" placeholder="https://scorenow.id/..." value={ctx.official_url || officialBase?.url || ''} onChange={(e) => setC({ official_url: e.target.value })} /></label>
          </div>
        </div>

        <Card title="Official Timing Mat Splits">
          {officialBase?.splits?.length ? (
            <table className="lapt">
              <thead><tr><th>Checkpoint</th><th>Cumulative Time</th><th>Split Pace</th></tr></thead>
              <tbody>
                {officialBase.splits.map(([cp, t, sp]) => (
                  <tr key={cp}><td><b>{cp}</b></td><td style={{ fontFamily: 'var(--font-mono)' }}>{t}</td><td style={{ fontFamily: 'var(--font-mono)' }}>{sp}</td></tr>
                ))}
              </tbody>
            </table>
          ) : <p className="muted">No preloaded official mat splits for this date. Watch splits are available in the Splits tab.</p>}
        </Card>
      </div>}

      {/* Share Card Modal */}
      {shareOpen && <div className="actv56-modal-bg" onClick={(e) => { if (e.target === e.currentTarget) setShareOpen(false) }}>
        <div className="card actv56-modal">
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
