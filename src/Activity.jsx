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

function Detail({ id, gear, vdot, history, go, settings }) {
  const D = useApi(id ? `/api/activities/detail?id=${encodeURIComponent(id)}` : '', !!id), a = D.data
  const [ctx, setCtx] = useStore('lumpad.act.' + (id || 'none').replace(/[^A-Za-z0-9._-]/g, '_'), { rpe: '', gels: '', cho_g: '', note: '' })
  const [lapMode, setLapMode] = useState('all')
  const p = paces(vdot.v), plan = a ? BY_DATE[a.date] : null, laps = a?.laps || []
  const ef = a ? efOf(a) : null, kind = a ? typeOf(a) : null
  const efHist = a && kind ? history.filter((h) => typeOf(h) === kind && h.date <= a.date && efOf(h)).sort((x, y) => x.date.localeCompare(y.date)).slice(-10).map(efOf) : []
  const dc = decoupling(laps), steady = kind === 'easy' || kind === 'long'
  const zcfg = cfgOf(settings || {}), zs = laps.length ? zoneSeconds(laps, zcfg) : null, pz = zs && zs.pace.some((x) => x > 0), hz = zs && zs.hr.some((x) => x > 0)
  const shownLaps = lapMode === '5k' && laps.length >= 10 ? group5k(laps) : laps
  const maxPace = Math.max(...shownLaps.map((l) => l.avg_pace_s_km || 0), 1), minPace = Math.min(...shownLaps.filter((l) => (l.distance_m || 1000) >= 900 && l.avg_pace_s_km).map((l) => l.avg_pace_s_km))
  const dyn = (k) => { const v = mean(laps.map((l) => l[k])); return v == null ? null : Math.round(v * 100) / 100 }
  const E = [p.E[1], p.E[0]]
  const verdict = a && a.sport_class === 'run' && a.avg_pace_s_km && plan && ['easy', 'social', 'long', 'speed'].includes(plan.kind) ? (a.avg_pace_s_km < E[0] - 3 ? ['yellow', `Faster than easy (${fmtPace(E[0])}–${fmtPace(E[1])})`] : a.avg_pace_s_km > E[1] + 3 ? ['yellow', 'Slower than easy range'] : ['green', 'Within easy range']) : null
  const setC = (patch) => setCtx({ ...ctx, ...patch })

  return <div className="detail-page" role="region" aria-label={a?.name || 'Activity detail'}>
    {D.state === 'loading' && <div className="skel" style={{ height: 120 }} />}
    {D.state === 'error' && <p className="muted">Could not load this activity — it may not exist, or the server is unreachable.</p>}
    {a && <>
      <Card>
        <div className="prof-cmd-top" style={{ marginBottom: 12 }}>
          <div>
            <div className="chips" style={{ margin: '0 0 6px' }}>
              <StatusPill tone="green">{SPORT_LABEL[a.sport_class] || a.sport}</StatusPill>
              {a.sources.map((s) => <Chip key={s}>{s}</Chip>)}
              {a.training_focus && <Chip tone="str">{a.training_focus}</Chip>}
              {a.temp_c != null && <Chip tone="yellow">{a.temp_c}°C · RH {a.humidity ?? '—'}%</Chip>}
            </div>
            <h2 className="sess-title" style={{ margin: 0 }}>{a.name}</h2>
            <p className="muted" style={{ margin: '4px 0 0' }}>{fmtLong(a.date)}{(ctx.gear_id || a.gear_id) && gear[ctx.gear_id || a.gear_id] ? ` · Shoe: ${gear[ctx.gear_id || a.gear_id]}` : ''}</p>
          </div>
          {a.training_load != null && <StatusPill tone="red">TL {a.training_load} · TE {a.aerobic_te ?? '—'}/{a.anaerobic_te ?? '—'}</StatusPill>}
        </div>
        <div className="score-grid">
          <div><small>Distance</small><b>{a.distance_m ? km(a.distance_m) : '—'}</b><em>km</em></div>
          <div><small>Moving time</small><b>{fmtDur(a.duration_s)}</b></div>
          <div><small>Avg Pace</small><b>{a.sport_class === 'run' ? fmtPaceS(a.avg_pace_s_km) : '—'}</b><em>/km</em></div>
          <div><small>GAP <Info k="GAP" /></small><b>{a.adjusted_pace_s_km ? fmtPaceS(a.adjusted_pace_s_km) : '—'}</b><em>[COROS]</em></div>
          <div><small>Avg / Max HR</small><b>{a.avg_hr ?? '—'}</b><em>{a.max_hr ? `max ${a.max_hr} bpm` : 'bpm'}</em></div>
          <div><small>Efficiency <Info k="EF" /></small><b>{ef ?? '—'}</b><em>{dc && steady ? `Pa:Hr ${dc.pct}%` : 'EF'}</em></div>
        </div>
      </Card>

      {a.sport_class === 'run' && (a.distance_m || 0) >= 5000 && <ActivityCoach id={a.ids?.[0] || id} label={String(a.ids?.[0] || id).replace(/^coros:/, '')} />}
      {a.sport_class === 'run' && <FitPanel id={a.ids?.[0] || id} go={go} />}
      {a.sport_class === 'run' && (a.distance_m || 0) >= 16000 && <LongRunContext label={String(a.ids?.[0] || id).replace(/^coros:/, '')} go={go} />}
      {a.sport_class === 'run' && <RunCompare a={a} id={id} history={history} />}

      <div className="rgrid">
        {a.sport_class === 'run' && <Card title="Aerobic Efficiency & Decoupling">
          <div className="mgrid two"><div><small>Efficiency Factor <Info k="EF" /></small><b>{ef ?? '—'}</b><Sparkline data={efHist} label={`EF last 10 ${kind} runs`} w={110} /></div>
            <div><small>Decoupling Pa:Hr <Info k="Decoupling" /></small><b>{dc && steady ? dc.pct + '%' : '—'}</b>{dc && steady ? <Chip tone={dc.band}>{dc.band === 'green' ? 'durable' : dc.band === 'yellow' ? 'moderate drift' : 'high drift'}</Chip> : <em className="muted">{steady ? 'needs ≥4 laps' : 'steady runs only'}</em>}</div></div>
        </Card>}
        {plan && <Card title="Plan vs Actual">
          <div className="vs"><div><small>Planned</small><b>{plan.label}{plan.km ? ` · ${plan.km} km` : ''}</b></div><div><small>Actual</small><b>{a.distance_m ? km(a.distance_m) + ' km' : fmtDur(a.duration_s)}</b></div></div>
          {a.distance_m && plan.km ? <p className="muted">{Math.round(((a.distance_m / 1000) / plan.km) * 100)}% of plan</p> : null}{verdict && <Chip tone={verdict[0]}>{verdict[1]}</Chip>}
        </Card>}
      </div>

      {laps.length > 1 && <Card title="Per-Lap Multi-Channel Telemetry"><MultiTrack laps={laps} tracks={[{ key: 'avg_pace_s_km', label: 'Pace', color: 'var(--c-long)', invert: true, fmt: fmtPaceS }, { key: 'avg_hr', label: 'HR', color: 'var(--red)' }, { key: 'cadence', label: 'Cadence', color: 'var(--c-quality)' }, { key: 'power', label: 'Power', color: 'var(--c-tt)' }, { key: 'stride_m', label: 'Stride', color: 'var(--c-social)' }]} /></Card>}

      {/* Side-by-side Splits (7) + Zones & Running Dynamics (5) */}
      <div className="bio-split-75">
        {laps.length > 0 && <Card title={`Splits per km (${laps.length} laps)`} right={laps.length >= 10 && <SegmentedTabs tabs={[{ id: '5k', label: '5K Blocks' }, { id: 'all', label: `All ${laps.length} Laps` }]} value={lapMode} onChange={setLapMode} label="Split grouping" />}>
          <div className="scroll" style={{ maxHeight: 520 }} tabIndex={0}><table className="lapt"><thead><tr><th>Lap</th><th>Pace</th><th>HR</th><th>Cad</th><th>GCT</th></tr></thead><tbody>
            {shownLaps.map((l) => <tr key={l.idx}><td>{l.idx}{lapMode === 'all' && l.distance_m < 990 ? <small className="muted"> ({(l.distance_m / 1000).toFixed(2)})</small> : ''}</td><td className={'pbar-td ' + (l.avg_pace_s_km === minPace ? 'fast' : '')}><i style={{ width: (maxPace ? (l.avg_pace_s_km / maxPace) * 100 : 0) + '%' }} /><span>{fmtPaceS(l.avg_pace_s_km)}</span></td><td>{l.avg_hr ?? '—'}</td><td>{l.cadence ?? '—'}</td><td>{l.gct_ms ?? '—'}</td></tr>)}
          </tbody></table></div>
        </Card>}

        <div>
          {(pz || hz) && <Card title="Heart Rate vs. Pace Zone Distribution">
            {hz && <ZoneBars title={`HR zones (LTHR ${zcfg.lthr} bpm)`} rows={ZROWS(zcfg, 'hr').map((r, i) => ({ ...r, s: zs.hr[i] }))} />}
            {pz && <ZoneBars title={`Pace zones (T-Pace ${fmtPaceS(zcfg.tpace)}/km)`} rows={ZROWS(zcfg, 'pace').map((r, i) => ({ ...r, s: zs.pace[i] }))} />}
            {hz && pz && (() => { const top = (arr) => arr.indexOf(Math.max(...arr)), dh = top(zs.hr), dp = top(zs.pace); return dh - dp >= 2 ? <p className="banner">HR sat {dh - dp} zones higher than pace (HR Z{dh} vs pace {dp ? 'Z' + dp : '<Z1'}): judge by HR, not pace.</p> : null })()}
          </Card>}

          <Card title="Running Dynamics & Session Log">
            <div className="score-grid"><div><small>GCT</small><b>{dyn('gct_ms') ?? '—'}</b><em>ms</em></div><div><small>Vert Osc</small><b>{dyn('vo_cm') ?? '—'}</b><em>cm</em></div><div><small>Vert Ratio</small><b>{dyn('vratio_pct') ?? '—'}</b><em>%</em></div>
              <div><small>Stride</small><b>{dyn('stride_m') ?? '—'}</b><em>m</em></div></div>
            <div className="form two" style={{ marginTop: 12 }}>
              <label className="fld"><span>Shoe used (syncs to Twin &amp; FIT)</span>
                <select value={ctx.gear_id ?? a.gear_id ?? ''} onChange={(e) => { const g = e.target.value; setC({ gear_id: g }); fetch('/api/activities/shoe', { method: 'POST', headers: { 'content-type': 'application/json', 'x-lumpad': '1' }, body: JSON.stringify({ id: a.ids?.[0] || id, gear_id: g || null }) }).catch(() => {}) }}>
                  <option value="">— Not assigned —</option>
                  {Object.entries(gear).map(([gid, gname]) => <option key={gid} value={gid}>{gname}</option>)}
                </select>
              </label>
              <div className="fld"><span>GI distress</span>
                <div className="pain" role="group" aria-label="GI distress" style={{ gridTemplateColumns: 'repeat(4,1fr)' }}>{[[0, 'None'], [1, 'Mild'], [2, 'Mod'], [3, 'Severe']].map(([n, l]) => <button key={n} aria-pressed={ctx.gi === n} className={n >= 2 ? 'hi' : ''} onClick={() => setC({ gi: ctx.gi === n ? '' : n })}>{l}</button>)}</div>
              </div>
            </div>
            <div className="fld" style={{ marginTop: 12 }}><span>Session RPE (1–10)</span><div className="pill10" role="group" aria-label="RPE">{Array.from({ length: 10 }, (_, i) => i + 1).map((n) => <button key={n} aria-pressed={ctx.rpe === n} onClick={() => setC({ rpe: ctx.rpe === n ? '' : n })}>{n}</button>)}</div></div>
            <div className="form two" style={{ marginTop: 10 }}><label className="fld"><span>Gels taken</span><input inputMode="numeric" type="number" value={ctx.gels} onChange={(e) => setC({ gels: e.target.value === '' ? '' : +e.target.value })} /></label>
              <label className="fld"><span>Actual carbs (g)</span><input inputMode="numeric" type="number" value={ctx.cho_g} onChange={(e) => setC({ cho_g: e.target.value === '' ? '' : +e.target.value })} /></label></div>
            {ctx.cho_g !== '' && a.duration_s > 0 && <p className="muted">≈ {Math.round(ctx.cho_g / (a.duration_s / 3600))} g/h (target &gt;90 min: 30–60 g/h)</p>}
            <label className="fld" style={{ display: 'block', marginTop: 10 }}><span>Session notes</span><input type="text" placeholder="Pacing, heat, mechanical feel…" value={ctx.note || ''} onChange={(e) => setC({ note: e.target.value })} /></label>
          </Card>
        </div>
      </div>
    </>}
  </div>
}
