import { useMemo, useRef, useState } from 'react'
import { ROUTES } from './CourseMap.jsx'
import { splits, clock, runWalk, hms, mss, parseHMS, compass, segmentAt, FM } from './lib/courseplan.js'
import { makeProfile } from './lib/profile.js'
import LOG26 from './data/races/jakim2026.json'
import { makeLog } from './lib/racelog.js'
import { cfgOf } from './lib/zones.js'
import JakimBenchmark from './JakimBenchmark.jsx'
import RouteMapLeaflet from './RouteMapLeaflet.jsx'
import { RACES, RACE_BY_DATE } from './lib/season.js'
import { useStore } from './store.js'
import { Card, Chip, Evidence, Screen } from './ui.jsx'

const W = 300, H = 400, PAD = 14, GR = { down: 'var(--c-tt)', flat: 'var(--green)', gentle: 'var(--yellow)', rise: 'var(--c-quality)' }
const STRAT = [['even', 'Even pace'], ['negative', 'Negative split'], ['runwalk', 'Run–walk']]
const NAV = [['s-sum', 'Summary'], ['s-map', 'Map'], ['s-seg', 'Segment'], ['s-climb', 'Climbs'], ['s-terr', 'Terrain'], ['s-km', 'Per km'], ['s-cot', 'Cut-offs'], ['s-arr', 'Arrival'], ['s-bench', '2026 benchmark'], ['s-last', 'Your 2026'], ['s-sec', 'Sections'], ['s-data', 'Data']]
const f1 = (x) => (Math.round(x * 10) / 10).toFixed(1), f0 = (x) => Math.round(x)
const sgn = (x, d = 1) => (x > 0 ? '+' : '') + x.toFixed(d)
const hm = (m) => { m = ((Math.round(m) % 1440) + 1440) % 1440; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}` }
const toMin = (s) => { const m = String(s || '').match(/^(\d{1,2}):(\d{2})$/); return m ? +m[1] * 60 + +m[2] : null }

// Elevation profile: coloured by gradient, climbs shaded, selection and cursor; flat (from 0 m) or detail scale
function ProfileChart({ P, climbs, km, setKm, sel, setSel, hl, detail }) {
  const VW = 600, VH = 170, L = 34, Rt = 8, T = 10, B = 22, ref = useRef(null)
  const lo = detail ? Math.floor(Math.min(...P.s) - 1) : 0, hi = Math.ceil(Math.max(...P.s) + (detail ? 1 : 6)), X = (k) => L + (k / P.total) * (VW - L - Rt), Y = (e) => T + (1 - (e - lo) / (hi - lo)) * (VH - T - B)
  const pts = useMemo(() => { const out = []; for (let k = 0; k <= P.total + 1e-9; k += 0.15) out.push([k, P.at(Math.min(k, P.total))]); return out }, [P])
  const area = `M${X(0)},${Y(lo)}` + pts.map(([k, e]) => `L${X(k).toFixed(1)},${Y(e).toFixed(1)}`).join('') + `L${X(P.total)},${Y(lo)}Z`
  const kmOf = (e) => { const r = ref.current.getBoundingClientRect(), x = ((e.clientX - r.left) / r.width) * VW; return Math.max(0, Math.min(P.total, ((x - L) / (VW - L - Rt)) * P.total)) }
  const drag = useRef(false), ticks = [lo, Math.round((lo + hi) / 2), hi]
  return <svg ref={ref} viewBox={`0 0 ${VW} ${VH}`} className="pchart" role="img" aria-label="Elevation profile, estimated. Touch or drag to move the point on the map." style={{ touchAction: 'none' }}
    onPointerDown={(e) => { e.currentTarget.setPointerCapture?.(e.pointerId); drag.current = true; setKm(kmOf(e)) }} onPointerMove={(e) => drag.current && setKm(kmOf(e))} onPointerUp={() => { drag.current = false }}>
    {ticks.map((t) => <g key={t}><line x1={L} x2={VW - Rt} y1={Y(t)} y2={Y(t)} className="gl" /><text x={L - 4} y={Y(t) + 3} className="gt" textAnchor="end">{t} m</text></g>)}
    {[0, 5, 10, 15, 20, 25, 30, 35, 40].map((k) => <text key={k} x={X(k)} y={VH - 6} className="gt" textAnchor="middle">{k}</text>)}
    <path d={area} className="pc-area" />
    {climbs.map((c) => <rect key={c.id} x={X(c.a)} y={T} width={X(c.b) - X(c.a)} height={VH - T - B} className="pc-climb" onClick={(e) => { e.stopPropagation(); setSel([c.a, c.b]) }}><title>{`${c.id} · km ${f1(c.a)}–${f1(c.b)} · +${f0(c.gain)} m`}</title></rect>)}
    <rect x={X(sel[0])} y={T} width={Math.max(2, X(sel[1]) - X(sel[0]))} height={VH - T - B} className="pc-sel" />
    {pts.slice(1).map(([k, e], i) => { const k0 = pts[i][0], c = P.classOf(P.grade((k0 + k) / 2)); return <line key={i} x1={X(k0)} y1={Y(pts[i][1])} x2={X(k)} y2={Y(e)} className="pc-line" style={{ stroke: GR[c], opacity: hl && hl !== c ? 0.2 : 1 }} /> })}
    {climbs.map((c) => <text key={c.id + 't'} x={(X(c.a) + X(c.b)) / 2} y={T + 10} textAnchor="middle" className="pc-lab">{c.id}</text>)}
    <line x1={X(km)} x2={X(km)} y1={T} y2={VH - B} className="pc-cur" /><circle cx={X(km)} cy={Y(P.at(km))} r="4" className="pc-dot" />
  </svg>
}


// Jakim 2026, kilometre by kilometre: bar = speed (taller = faster; green faster than the plan pace, yellow ≤ 9:00/km, red slower), line = heart rate
function LastChart({ L, plan, lthr, km, setKm }) {
  const VW = 600, VH = 190, Lm = 30, Rm = 30, T = 10, B = 22, parts = L.per, X = (k) => Lm + (k / 42.195) * (VW - Lm - Rm), maxV = 3600 / 330
  const Yv = (pace) => T + (1 - Math.min(maxV, 3600 / pace) / maxV) * (VH - T - B), Yh = (h) => T + (1 - (h - 100) / 90) * (VH - T - B), planPace = plan ? plan.sp[0] : 426
  const hr = parts.filter((p) => !p.partial).map((p) => `${X(p.km - 0.5).toFixed(1)},${Yh(p.hr).toFixed(1)}`).join(' ')
  return <svg viewBox={`0 0 ${VW} ${VH}`} className="pchart" role="img" aria-label="Your pace and heart rate for every kilometre of Jakim 2026" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setKm(Math.max(0, Math.min(42.195, (((e.clientX - r.left) / r.width) * VW - Lm) / (VW - Lm - Rm) * 42.195))) }}>
    {[7, 9, 11, 13].map((m) => <g key={m}><line x1={Lm} x2={VW - Rm} y1={Yv(m * 60)} y2={Yv(m * 60)} className="gl" /><text x={Lm - 3} y={Yv(m * 60) + 3} textAnchor="end" className="gt">{m}:00</text></g>)}
    {[120, 150, 180].map((h) => <text key={h} x={VW - Rm + 3} y={Yh(h) + 3} className="gt">{h}</text>)}
    {[0, 5, 10, 15, 20, 25, 30, 35, 40].map((k) => <text key={k} x={X(k)} y={VH - 6} textAnchor="middle" className="gt">{k}</text>)}
    {parts.map((p) => { const w = (X(p.km) - X(p.km - (p.partial ? 0.27 : 0.975))) - 1, y = Yv(p.pace); return <rect key={p.i} x={X(p.km - (p.partial ? 0.27 : 0.975)) + 0.5} y={y} width={Math.max(1, w)} height={VH - B - y} style={{ fill: p.pace <= planPace ? 'var(--green)' : p.pace <= 540 ? 'var(--yellow)' : 'var(--red)', opacity: 0.85 }}><title>{`km ${p.km.toFixed(1)}: ${mss(p.pace)}/km · HR ${p.hr}`}</title></rect> })}
    <polyline points={hr} className="hr-line" /><line x1={Lm} x2={VW - Rm} y1={Yh(lthr)} y2={Yh(lthr)} className="hr-lthr" /><text x={Lm + 3} y={Yh(lthr) - 3} className="gt">LTHR {lthr}</text>
    <line x1={X(km)} x2={X(km)} y1={T} y2={VH - B} className="pc-cur" />
  </svg>
}

export default function Course({ go, settings }) {
  const R = ROUTES.jakim, race = RACES.find((r) => r.route === 'jakim'), E = R.elevation, L = useMemo(() => makeLog(LOG26), []), cfg = cfgOf(settings)
  const [esrc, setEsrc] = useState(E?.watch ? 'watch' : 'model')
  const P = useMemo(() => (E ? makeProfile(esrc === 'watch' && E.watch ? E.watch.ele : E.ele, E.stepKm, R.officialKm) : null), [E, R, esrc])
  const climbs = useMemo(() => (P ? P.climbs() : []), [P]), comp = useMemo(() => (P ? P.composition() : []), [P]), perKm = useMemo(() => (P ? P.perKm() : []), [P])
  const [km, setKm] = useState(0), [sel, setSelRaw] = useState([0, 10]), [hl, setHl] = useState(null), [detail, setDetail] = useState(false), [kmSel, setKmSel] = useState(null), [allKm, setAllKm] = useState(false)
  const setSel = (r) => setSelRaw(r[0] > r[1] ? [r[1], r[0]] : r)
  const [strategy, setStrategy] = useState('even'), [target, setTarget] = useState(hms(4 * 3600 + 51 * 60)), [runMin, setRunMin] = useState(4), [walkMin, setWalkMin] = useState(1)
  const [cot, setCot] = useStore('lumpad.cot.jakim', { start: '05:00', cuts: [] }), [queue, setQueue] = useState(3), [stops, setStops] = useState(10), [nc, setNc] = useState({ name: '', km: '', clock: '' })
  const total = parseHMS(target), ok = total != null && total >= 2 * 3600 && total <= 9 * 3600
  const plan = useMemo(() => { if (!ok) return null; const sp = splits(total, strategy === 'negative' ? 'negative' : 'even'), cl = clock(sp); return { sp, cl, rw: strategy === 'runwalk' ? runWalk(total / FM, runMin, walkMin) : null } }, [ok, total, strategy, runMin, walkMin])
  const clockAtKm = (k) => { if (!plan) return null; const i = Math.floor(k), base = i ? plan.cl[i - 1] : 0; return base + (k - i) * (plan.sp[i] || 0) / (i < 42 ? 1 : FM - 42) }
  const seg = segmentAt(R.segments, km), st = P ? P.stats(sel[0], sel[1]) : null, all = P ? P.stats(0, P.total) : null
  const scroll = (id) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  const steepest = useMemo(() => { if (!P) return null; let b = { k: 0, g: 0 }; for (let k = 0.15; k < P.total - 0.15; k += 0.1) { const g = P.grade(k, 300); if (Math.abs(g) > Math.abs(b.g)) b = { k, g } } return b }, [P])
  const csv = () => { const lines = ['km,split_s_per_km,clock,segment', ...plan.sp.map((s, i) => `${i < 42 ? i + 1 : 42.195},${Math.round(i < 42 ? s : s / (FM - 42))},${hms(plan.cl[i])},"${segmentAt(R.segments, i + 0.5).what}"`)]; const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' })); a.download = `jakim-splits-${target.replace(/:/g, '')}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000) }
  const rows = plan ? plan.sp.map((s, i) => ({ k: i < 42 ? i + 1 : 42.195, split: i < 42 ? s : s / (FM - 42), clock: plan.cl[i], seg: segmentAt(R.segments, i < 42 ? i + 0.5 : 42.1), dir: compass(R.kmHeadings[i] ?? 0) })) : []
  const shown = allKm ? rows : rows.filter((r) => r.k % 5 === 0 || r.k === 42.195 || Math.abs(r.k - 21) < 0.5)
  const startMin = toMin(cot.start), arrive = (k) => (plan && startMin != null ? startMin + queue + (clockAtKm(k) + (stops * 60 * k) / FM) / 60 : null)
  const addCut = () => { const k = +nc.km, c = toMin(nc.clock); if (!nc.name.trim() || !(k > 0 && k <= FM) || c == null) return; setCot({ ...cot, cuts: [...cot.cuts, { name: nc.name.trim().slice(0, 30), km: k, clock: nc.clock }].sort((a, b) => a.km - b.km) }); setNc({ name: '', km: '', clock: '' }) }
  const PRESETS = [['First 10 km', 0, 10], ['10 km → half', 10, 21.1], ['Half → 30', 21.1, 30], ['30 km → finish', 30, FM], ['Mampang out and back', 9.5, 15.5], ['Satrio spur', 22, 26], ['Last 5 km', FM - 5, FM]]
  return <Screen title="Jakim course" sub={`${R.name} · ${race ? RACE_BY_DATE[race.date].cls + '-race · target ' + (race.target || '—') : ''}`}>
    <div className="jnav" role="navigation" aria-label="Sections">{NAV.map(([id, l]) => <button key={id} onClick={() => scroll(id)}>{l}</button>)}</div>

    <Card title="A · Summary in 30 seconds"><div id="s-sum" />
      <div className="wmeta wk4"><div><small>Total climb ({esrc === 'watch' ? 'watch' : 'est.'})</small><b>{all ? f0(all.gain) : '—'}</b><em>m</em></div><div><small>Highest point ({esrc === 'watch' ? 'watch' : 'est.'})</small><b>{all ? f0(all.max) : '—'}</b><em>m</em></div><div><small>Lowest point ({esrc === 'watch' ? 'watch' : 'est.'})</small><b>{all ? f0(all.min) : '—'}</b><em>m</em></div><div><small>Main climbs</small><b>{climbs.length}</b><em>gentle</em></div></div>
      <ul className="rules">
        <li><b>Flat course.</b> {comp.find((c) => c.id === 'flat') ? `${f0(comp.find((c) => c.id === 'flat').pct)}% of the distance is within ±0.5% grade` : ''}; the steepest 300 m is {steepest ? `${sgn(steepest.g)}% around km ${f1(steepest.k)}` : '—'}.</li>
        <li><b>Out and back.</b> The route turns around {R.turns.length} times (km {R.turns.map((t) => t.km).join(', ')}): Mampang is the southernmost point, Sisingamangaraja the westernmost.</li>
        <li><b>{climbs[0] ? `${climbs[0].id}: km ${f1(climbs[0].a)}–${f1(climbs[0].b)}` : 'Longest rise'}</b>{climbs[0] ? ` is the longest rise, about +${f0(climbs[0].gain)} m over ${f1(climbs[0].len)} km, from the Monas lowland up to Mampang.` : ''}</li>
        <li><b>Cut-offs:</b> not published for 2027 yet (see section G, you can enter them).</li>
      </ul>
      <p className="muted">Elevation: <button className="link" onClick={() => setEsrc(esrc === 'watch' ? 'model' : 'watch')}>{esrc === 'watch' ? 'from your watch at Jakim 2026 (barometer)' : 'estimated from a terrain model'} · switch</button>. The official GPX has none, so treat metres as indicative: see section J. Facts only, no pacing advice here except the plan you choose in section H.</p>
    </Card>

    <Card title="B · Map and elevation profile"><div id="s-map" />
      <RouteMapLeaflet R={R} P={P} km={km} setKm={setKm} sel={sel} hl={hl} />
      {P && <ProfileChart P={P} climbs={climbs} km={km} setKm={setKm} sel={sel} setSel={setSel} hl={hl} detail={detail} />}
      <div className="rstats"><div><small>km</small><b>{f1(km)}</b></div><div><small>elevation</small><b>{P ? f0(P.at(km)) : '—'} m</b></div><div><small>grade (300 m)</small><b>{P ? sgn(P.grade(km)) : '—'}%</b></div><div><small>clock</small><b>{plan ? hms(clockAtKm(km)) : '—'}</b></div></div>
      <input type="range" min="0" max={FM} step="0.1" value={km} onChange={(e) => setKm(+e.target.value)} aria-label="Move along the course" />
      <p><b>{seg.what}</b> · heading {compass(R.kmHeadings[Math.min(42, Math.floor(km))] ?? 0)} · you passed here in 2026 at <b>{hms(L.clockAt(km))}</b></p>
      <div className="legend">{comp.map((c) => <span key={c.id}><i className="kdot" style={{ background: GR[c.id] }} />{c.label}</span>)}<button className="link" onClick={() => setDetail(!detail)}>{detail ? 'Flat scale (from 0 m)' : 'Detail scale'}</button></div>
      <p className="muted">Press Move map to pan and zoom (so the page still scrolls normally), tap a km marker, tap the line or touch the profile. Line colour = grade; shaded bands = climbs T1–T4 (tap one to select it); yellow dots = U-turns.</p>
    </Card>

    <Card title="C · Pick your own segment"><div id="s-seg" />
      <div className="chiprow" role="group" aria-label="Quick picks">{PRESETS.map(([l, a, b]) => <button key={l} className={Math.abs(sel[0] - a) < 0.05 && Math.abs(sel[1] - b) < 0.05 ? 'on' : ''} onClick={() => setSel([a, b])}>{l}</button>)}</div>
      <div className="form two"><label className="fld"><span>From km <b>{f1(sel[0])}</b></span><input type="range" min="0" max={FM} step="0.1" value={sel[0]} onChange={(e) => setSel([Math.min(+e.target.value, sel[1] - 0.2), sel[1]])} /></label><label className="fld"><span>To km <b>{f1(sel[1])}</b></span><input type="range" min="0" max={FM} step="0.1" value={sel[1]} onChange={(e) => setSel([sel[0], Math.max(+e.target.value, sel[0] + 0.2)])} /></label></div>
      {st && <div className="wmeta wk4"><div><small>Distance</small><b>{f1(st.len)}</b><em>km</em></div><div><small>Climb</small><b>+{f0(st.gain)}</b><em>m</em></div><div><small>Descent</small><b>−{f0(st.loss)}</b><em>m</em></div><div><small>Average grade</small><b>{sgn(st.avg)}</b><em>%</em></div></div>}
      {st && <p className="muted">Steepest 300 m: {sgn(st.steepUp)}% up, {sgn(st.steepDown)}% down · elevation {f0(st.min)}–{f0(st.max)} m{plan ? ` · ${hms(clockAtKm(sel[1]) - clockAtKm(sel[0]))} at your plan` : ''}.</p>}
    </Card>

    <Card title="D · Main climbs" right={<Chip>{climbs.length} rises ≥ 8 m</Chip>}><div id="s-climb" />
      <div className="cgrid">{climbs.map((c) => { const s = P.stats(c.a, c.b); return <button key={c.id} className="ccard" onClick={() => { setSel([c.a, c.b]); setKm(c.a); scroll('s-map') }}><b>{c.id}</b><span>km {f1(c.a)}–{f1(c.b)}</span><strong>+{f0(c.gain)} m</strong><small>{f1(c.len)} km · avg {sgn(c.avg, 2)}% · steepest {sgn(s.steepUp)}%</small><small>≈ {Math.max(1, Math.round(c.gain / 3))} floors of a building</small></button> })}</div>
      <p className="muted">Rises are valley-to-peak stretches of the smoothed profile. Nothing here is a real hill: the model puts every rise under about 1.5% grade.</p>
    </Card>

    <Card title="E · Terrain"><div id="s-terr" />
      <div className="stack100" role="group" aria-label="Terrain composition">{comp.map((c) => <button key={c.id} style={{ width: Math.max(c.pct, 2) + '%', background: GR[c.id] }} className={hl === c.id ? 'on' : ''} onClick={() => setHl(hl === c.id ? null : c.id)} aria-pressed={hl === c.id} aria-label={`${c.label} ${f0(c.pct)}%`} />)}</div>
      <ul className="rules">{comp.map((c) => <li key={c.id}><i className="kdot" style={{ background: GR[c.id] }} /> <b>{c.label}</b> {f1(c.km)} km · {f0(c.pct)}% <button className="link" onClick={() => setHl(hl === c.id ? null : c.id)}>{hl === c.id ? 'clear' : 'highlight'}</button></li>)}</ul>
      <p className="muted">Grade classes use a 300 m window: downhill ≤ −0.5%, flat within ±0.5%, gentle rise 0.5–1.5%, rise ≥ 1.5%. The highlight shows on the map and the profile in section B.</p>
    </Card>

    <Card title="F · Kilometre by kilometre"><div id="s-km" />
      <div className="kmbars" role="group" aria-label="Climb and descent per kilometre">{perKm.map((k) => { const m = Math.max(...perKm.map((x) => Math.max(x.gain, x.loss)), 1); return <button key={k.km} className={kmSel === k.km ? 'on' : ''} onClick={() => { setKmSel(k.km); setKm(k.km - 0.5) }} aria-label={`km ${k.km}: +${f1(k.gain)} m, −${f1(k.loss)} m`}><i className="up" style={{ height: (k.gain / m) * 100 + '%' }} /><i className="dn" style={{ height: (k.loss / m) * 100 + '%' }} /></button> })}</div>
      {kmSel && (() => { const k = perKm[kmSel - 1]; return <p><b>km {k.km}</b> · +{f1(k.gain)} m / −{f1(k.loss)} m · average {sgn(k.avg, 2)}% · {segmentAt(R.segments, k.km - 0.5).what}{plan ? ` · clock ${hms(plan.cl[k.km - 1])}` : ''}</p> })()}
      <p className="muted">Bars up = metres climbed, bars down = metres descended in that kilometre. Tap one for details.</p>
    </Card>

    <Card title="G · Cut-off times (COP / COT)" right={<Chip tone="yellow">not published</Chip>}><div id="s-cot" />
      <p className="muted">The organiser has not published the 2027 cut-offs. When they do, add them here (name, km, clock time); they are saved on your server and used by the arrival calculator below.</p>
      <label className="fld"><span>Gun time (hh:mm)</span><input inputMode="numeric" value={cot.start} onChange={(e) => setCot({ ...cot, start: e.target.value })} placeholder="05:00" aria-invalid={startMin == null} /></label>
      {cot.cuts.length > 0 && <ul className="logs">{cot.cuts.map((c, i) => <li key={i}><span><b>{c.name}</b><small>km {c.km} · closes {c.clock}</small></span><button className="iconbtn" aria-label={`Delete ${c.name}`} onClick={() => setCot({ ...cot, cuts: cot.cuts.filter((_, j) => j !== i) })}>×</button></li>)}</ul>}
      <div className="form two"><label className="fld"><span>Name</span><input value={nc.name} onChange={(e) => setNc({ ...nc, name: e.target.value })} placeholder="COP 1 / Finish" /></label><label className="fld"><span>km</span><input inputMode="decimal" value={nc.km} onChange={(e) => setNc({ ...nc, km: e.target.value })} /></label><label className="fld"><span>Closes at (hh:mm)</span><input inputMode="numeric" value={nc.clock} onChange={(e) => setNc({ ...nc, clock: e.target.value })} placeholder="10:30" /></label></div>
      <button className="btn sm full" onClick={addCut}>Add cut-off</button>
    </Card>

    <Card title="H · Arrival times and pacing plan" right={<Chip>{ok ? hms(total) : 'enter h:mm:ss'}</Chip>}><div id="s-arr" />
      <div className="seg3 wrap" role="group" aria-label="Strategy">{STRAT.map(([k, l]) => <button key={k} className={strategy === k ? 'on' : ''} aria-pressed={strategy === k} onClick={() => setStrategy(k)}>{l}</button>)}</div>
      <div className="form two"><label className="fld"><span>Finish time (h:mm:ss)</span><input inputMode="numeric" value={target} onChange={(e) => setTarget(e.target.value)} aria-invalid={!ok} /></label>
        <label className="fld"><span>Queue to the start line (min)</span><input inputMode="numeric" type="number" min="0" max="30" value={queue} onChange={(e) => setQueue(Math.max(0, +e.target.value || 0))} /></label>
        <label className="fld"><span>Stops in total, aid and toilet (min)</span><input inputMode="numeric" type="number" min="0" max="60" value={stops} onChange={(e) => setStops(Math.max(0, +e.target.value || 0))} /></label>
        {strategy === 'runwalk' && <><label className="fld"><span>Run (min)</span><input inputMode="numeric" type="number" min="1" max="30" value={runMin} onChange={(e) => setRunMin(Math.max(1, +e.target.value || 1))} /></label><label className="fld"><span>Walk (min)</span><input inputMode="numeric" type="number" min="1" max="10" value={walkMin} onChange={(e) => setWalkMin(Math.max(1, +e.target.value || 1))} /></label></>}</div>
      {!ok && <p className="err" role="alert">Enter a finish time between 2:00:00 and 9:00:00.</p>}
      {plan && <p><b>{mss(total / FM)}/km</b> average{strategy === 'negative' ? <> · first half {mss(plan.sp[0])}, second half {mss(plan.sp[41])}/km</> : null}{plan.rw ? <> · run <b>{mss(plan.rw.runPace)}/km</b> for {runMin}′, walk {walkMin}′ at {mss(plan.rw.walkPace)}/km</> : null}{strategy === 'runwalk' && !plan.rw ? <span className="err"> That walk is too long for this goal.</span> : null}</p>}
      {plan && startMin != null && <p>Finish clock: <b>{hm(arrive(FM))}</b> ({hms(total + stops * 60)} on the clock incl. stops, gun {cot.start}, queue {queue} min).</p>}
      {plan && cot.cuts.length > 0 && <div className="scroll" tabIndex={0} role="region" aria-label="Arrival versus cut-offs"><table className="zm"><thead><tr><th>Point</th><th>Arrive</th><th>Closes</th><th>Margin</th></tr></thead><tbody>{cot.cuts.map((c, i) => { const a = arrive(c.km), cl = toMin(c.clock), mg = a != null && cl != null ? cl - a : null; return <tr key={i}><td>{c.name} <small className="muted">km {c.km}</small></td><td>{a != null ? hm(a) : '—'}</td><td>{c.clock}</td><td><Chip tone={mg == null ? undefined : mg < 0 ? 'red' : mg < 20 ? 'yellow' : 'green'}>{mg == null ? '—' : mg < 0 ? `${-f0(mg)} min late` : `${f0(mg)} min`}</Chip></td></tr> })}</tbody></table></div>}
      {plan && <><div className="scroll" tabIndex={0} role="region" aria-label="Kilometre splits"><table className="zm"><thead><tr><th>km</th><th>Split</th><th>Clock</th><th>2026</th><th>Where</th></tr></thead><tbody>
        {shown.map((r) => <tr key={r.k}><td><b>{r.k === 42.195 ? '42.2' : r.k}</b></td><td>{mss(r.split)}</td><td>{hms(r.clock)}</td><td>{hms(L.clockAt(r.k))}</td><td>{r.seg.what.split(',')[0]} <small className="muted">{r.dir}</small></td></tr>)}</tbody></table></div>
        <button className="btn sm" onClick={() => setAllKm(!allKm)}>{allKm ? 'Show every 5 km' : 'Show every km'}</button> <button className="btn sm" onClick={csv}>Download splits (.csv)</button></>}
      <Evidence>Plain arithmetic: the finish time is split by distance (the elevation, weather and your condition are not modelled), then matched against the cut-off clock times. Negative split = first half 1.5% slower than average. Run–walk walks at {mss(630)}/km. Stops are spread evenly over the distance.</Evidence>
    </Card>


    <div id="s-bench" />
    <JakimBenchmark settings={settings} planSec={ok ? total : undefined} />

    <Card title="K · Your Jakim 2026" right={<Chip>{hms(L.total)} watch time</Chip>}><div id="s-last" />
      <div className="wmeta wk4"><div><small>Watch distance</small><b>{f1(LOG26.gpsKm)}</b><em>km (GPS)</em></div><div><small>Moving time</small><b>{hms(L.moving)}</b><em>{f0(L.stopped / 60)} min stopped</em></div><div><small>Average HR</small><b>{LOG26.avgHr}</b><em>max {LOG26.maxHr}</em></div><div><small>Climb (watch)</small><b>+{LOG26.gain}</b><em>m</em></div></div>
      <LastChart L={L} plan={plan} lthr={cfg.lthr} km={km} setKm={setKm} />
      <div className="legend"><span><i className="kdot" style={{ background: 'var(--green)' }} />faster than plan pace</span><span><i className="kdot" style={{ background: 'var(--yellow)' }} />up to 9:00/km</span><span><i className="kdot" style={{ background: 'var(--red)' }} />slower (walking, queues)</span><span><i className="ll" style={{ borderColor: 'var(--text)' }} />heart rate</span></div>
      <ul className="rules">
        <li><b>First 10 km:</b> {mss(L.avgPace(0, 10))}/km at an average heart rate of {f0(L.avgHr(0, 10))} bpm ({f0((L.avgHr(0, 10) / cfg.lthr) * 100)}% of LTHR {cfg.lthr}).</li>
        <li><b>10–21 km:</b> {mss(L.avgPace(10, 21.0975))}/km, HR {f0(L.avgHr(10, 21.0975))}. Half-way in <b>{hms(L.clockAt(21.0975))}</b>{plan ? ` (plan ${hms(plan.cl[20] + (plan.sp[21] || 0) * 0.0975)})` : ''}.</li>
        <li><b>21–30 km:</b> {mss(L.avgPace(21.0975, 30))}/km, HR {f0(L.avgHr(21.0975, 30))}. <b>30–42.2 km:</b> {mss(L.avgPace(30, 42.195))}/km, HR {f0(L.avgHr(30, 42.2))}.</li>
        <li><b>Walking and stops:</b> {L.slow(540)} of 42 km were slower than 9:00/km and {L.slow(720)} slower than 12:00/km; the watch was running {f0(L.stopped / 60)} min longer than it was moving.</li>
        
      </ul>
      <p className="muted">From your COROS recording of {LOG26.date} (1 km laps); distances are scaled from {f1(LOG26.gpsKm)} km on the watch to the official {FM} km. Facts only: what to do with them is for your plan and coach.</p>
    </Card>

    <Card title="I · Profile by section"><div id="s-sec" />
      <div className="scroll" tabIndex={0} role="region" aria-label="Sections of the course"><table className="zm"><thead><tr><th>km</th><th>Section</th><th>Climb</th><th>Descent</th><th>Grade</th></tr></thead><tbody>
        {P && R.segments.map((s) => { const x = P.stats(s.from, s.to); return <tr key={s.from} onClick={() => { setSel([s.from, s.to]); setKm(s.from) }} style={{ cursor: 'pointer' }}><td><b>{f1(s.from)}–{f1(s.to)}</b></td><td>{s.what}</td><td>+{f0(x.gain)}</td><td>−{f0(x.loss)}</td><td>{sgn(x.avg, 2)}%</td></tr> })}</tbody></table></div>
      <h3>Turn by turn</h3>
      <ol className="cm-segs">{R.corners.map((c, i) => <li key={i}><button onClick={() => setKm(Math.max(0, c.km))}><b>km {c.km.toFixed(1)}</b><span>{c.deg >= 140 ? 'U-turn' : c.deg >= 100 ? 'Sharp' : 'Turn'} {c.dir === 'L' ? 'left' : 'right'} · {c.deg}°{R.turns.find((t) => Math.abs(t.km - c.km) < 0.6 && c.deg >= 140) ? ` · ${R.turns.find((t) => Math.abs(t.km - c.km) < 0.6).name}` : ''}</span></button></li>)}</ol>
    </Card>

    <Card title="J · Data and questions"><div id="s-data" />
      <details className="more" open><summary>Where do the numbers come from?</summary>
        <p className="muted"><b>Your 2026 race:</b> the COROS recording (1 km laps) and its Strava copy (barometric altitude). The watch read {f1(LOG26.gpsKm)} km, scaled to {FM} km. {E?.watch ? `Its altitude curve is aligned to the terrain model on average (barometer offset ${E.watch.shiftM} m); only the shape and the climb are compared.` : ''}</p>
        <p className="muted"><b>Route:</b> {R.source} The track is {R.trackKm} km as drawn and is scaled to the certified 42.195 km so the km markers match the boards.</p>
        <p className="muted"><b>Elevation:</b> the official GPX has no elevation. It is estimated from a global terrain model ({E?.source}), sampled every 50 m along the track. The model is a 90 m grid in whole metres and a surface model (roofs and flyovers appear as spikes; those were removed, e.g. the stadium at the finish), then smoothed over ±500 m. Expect errors of several metres: use it for the shape, not for exact climb figures.</p>
        <p className="muted"><b>Grade:</b> average over 300 m windows. A real watch with a barometer will read differently.</p></details>
      <details className="more"><summary>Why will my watch read more than 42.195 km?</summary><p className="muted">GPS reads long because of corners, weaving and signal bounce. The track in this file is already {R.trackKm} km as drawn; 42.4–43.0 km on a watch is normal. The km boards follow the certified 42.195 km.</p></details>
      <details className="more"><summary>Is the 2027 route the same?</summary><p className="muted">The GPX is the 2026 route. The 2027 course map shows the same route (Monas, Thamrin, Rasuna Said, Mampang, Sudirman, Satrio, Prapanca Raya, Sisingamangaraja, GBK). Check the organiser's latest map before race day.</p></details>
      <a className="btn sm full" href={R.gpx} download>Download the official GPX</a>
      <button className="btn sm full" onClick={() => go('race')}>Back to Races</button>
    </Card>
  </Screen>
}
