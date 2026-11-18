import { useEffect, useRef, useState } from 'react'
import { useStore } from './store.js'
import { evaluate, weeklyGate, EMPTY_DAY, hasInput, HARD } from './lib/gate.js'
import { paces, fmtPace } from './lib/vdot.js'
import { BY_DATE, today, addDays, fmtLong, KIND } from './lib/calendar.js'
import { PILLAR } from './lib/readiness.js'
import { formZone, progressionBand } from './lib/load.js'
import { quadrantLabel } from './lib/hrv.js'
import { mean, r1 } from './lib/stats.js'
import { Card, Chip, Screen, Icon, Info, Evidence } from './ui.jsx'
import { useHealthDay, hrvLow, ago } from './sync.js'
import { hm } from './api.js'
import { useModel } from './model.js'
import { RadialGauge, Speedometer, BandLine, PMCChart, Quadrant, Waterfall, BodyMap, Stacked100, Bullet, GroupedBars, TwinBars } from './charts2.jsx'

const Field = ({ label, hint, err, children }) => <label className="fld"><span>{label}</span>{children}{err ? <small className="err" role="alert">{err}</small> : hint && <small>{hint}</small>}</label>
const Src = ({ children }) => <Evidence>{children}</Evidence>
const sign = (n) => (n == null ? '—' : (n > 0 ? '+' : '') + n)
const TIER_TONE = { prime: 'green', optimal: 'teal', compromised: 'yellow', depleted: 'red' }
const Pill5 = ({ label, value, onChange, lo, hi }) => <div className="fld" style={{ gridColumn: 'span 2' }}><span>{label} <small className="muted">(1 = {lo} · 5 = {hi})</small></span>
  <div className="pill5" role="group" aria-label={label}>{[1, 2, 3, 4, 5].map((n) => <button key={n} aria-pressed={value === n} onClick={() => onChange(value === n ? '' : n)}>{n}</button>)}</div></div>

const SITES = [['vmo_l', 'Left VMO (thigh)'], ['achilles', 'Achilles'], ['plantar', 'Sole of foot'], ['tibia', 'Tibia'], ['other', 'Other']]

export default function Readiness({ vdot, settings, focus }) {
  const T = today(), [date, setDate] = useState(T)
  const [f, setF] = useStore('lumpad.daily.' + date, EMPTY_DAY), [ov, setOv] = useStore('lumpad.muscle.' + date, {})
  const [mode, setMode] = useStore('lumpad.ready.mode', 'pagi')
  useEffect(() => { if (focus?.mode === 'pagi' || focus?.mode === 'analisis') setMode(focus.mode) }, [focus]) // eslint-disable-line
  const [hist, setHist] = useState({}), [range, setRange] = useState(42), [acwrMode, setAcwrMode] = useState('ewma')
  const hd = useHealthDay(date), row = hd.row, M = useModel(date, settings, vdot, f, ov)
  const [painOpen, setPainOpen] = useState(false)
  useEffect(() => { fetch('/api/kv/prefix?prefix=lumpad.daily.').then((r) => r.json()).then(setHist).catch(() => {}) }, [])
  const topRef = useRef(), [stuck, setStuck] = useState(false)
  useEffect(() => { if (mode !== 'pagi' || !topRef.current) { setStuck(false); return } const o = new IntersectionObserver(([e]) => setStuck(!e.isIntersecting)); o.observe(topRef.current); return () => o.disconnect() }, [mode])

  const sess = BY_DATE[date] || null, g = evaluate(f, sess), has = hasInput(f), p = paces(vdot.v), rd = M.readiness, tier = rd.tier
  const easy = `${fmtPace(p.E[1])}–${fmtPace(p.E[0])} /km`
  const set = (patch) => setF({ ...f, ...patch }), num = (k) => (e) => set({ [k]: e.target.value === '' ? '' : +e.target.value })
  const shrErr = f.sleepHR !== '' && (f.sleepHR < 30 || f.sleepHR > 130) ? 'Usually 40–80 bpm — check again' : ''
  // minimal check-in: COROS values are applied silently the first time a day with data is opened; one tap on "How the body feels" completes a normal day
  useEffect(() => { if (row && f.sleepHR === '' && f.hrv === '' && (row.sleep_hr_avg != null || row.hrv_status)) setF({ ...f, ...(row.sleep_hr_avg != null ? { sleepHR: Math.round(row.sleep_hr_avg) } : {}), ...(row.hrv_status ? { hrv: hrvLow(row.hrv_status) ? 'reduced' : 'normal' } : {}) }) }, [row?.date, row?.pulled_at]) // eslint-disable-line
  const feel = (v) => set({ energy: v, ...(v !== '' && f.pain === '' ? { pain: 0, tibia: false } : {}) })
  const setSite = (k, n) => { const ps = { ...(f.painSites || {}), [k]: n }; const worst = Math.max(0, ...Object.values(ps)); set({ painSites: ps, pain: worst, tibia: (ps.tibia || 0) > 0 }) }
  const days7 = Array.from({ length: 7 }, (_, i) => addDays(date, i - 6)), rec = (d) => (d === date ? f : hist['lumpad.daily.' + d] || null), wg = weeklyGate(days7.map(rec).filter(Boolean))
  const label = rd.score != null ? `${tier.label} · ${rd.score}` : has ? { green: 'Go', yellow: 'Scale down', red: 'Swap to easy / rest' }[g.level] : 'Waiting for morning data'
  const hard = sess && HARD.has(sess.kind), needsMod = hard && (tier?.id === 'compromised' || tier?.id === 'depleted' || g.level !== 'green')
  const cutKm = sess?.km ? Math.round(sess.km * 0.75 * 10) / 10 : null
  const cur = M.cur, fz = formZone(cur?.tsbPct), pmcData = M.pmc.slice(-range), prevAtl = M.pmc.at(-8)?.atl
  const acwrShown = acwrMode === 'ewma' ? cur?.acwr : M.acwrRoll
  const pb = progressionBand(M.prog.pct), sl = M.sleep, hv = M.hrv, rh = M.rhr
  const sys = (() => { const a = rd.pillars.ans, s = rd.pillars.sleep, w = a.haveWeight + s.haveWeight; return w ? Math.round(((a.earned + s.earned) / w) * 100) : null })()
  const str = rd.pillars.msk.haveWeight ? Math.round((rd.pillars.msk.earned / rd.pillars.msk.haveWeight) * 100) : null
  const weeksIE = Array.from({ length: 6 }, (_, i) => { const end = addDays(date, -7 * (5 - i)), st = addDays(end, -6); const tl = M.series.filter((d) => d.date >= st && d.date <= end).reduce((a, d) => a + d.load, 0), km = M.acts.filter((a) => a.sport_class === 'run' && a.date >= st && a.date <= end).reduce((s, a) => s + (a.distance_m || 0) / 1000, 0); return { label: end.slice(5), tl, km } })
  const mTl = mean(weeksIE.map((w) => w.tl)) || 1, mKm = mean(weeksIE.map((w) => w.km)) || 1
  const tapRegion = (k) => { const auto = M.muscle[k] || 0, curv = ov[k]; const next = curv == null ? Math.min(3, Math.round(auto) + 1) : curv >= 3 ? null : curv + 1; const o = { ...ov }; if (next == null) delete o[k]; else o[k] = next; setOv(o) }

  return <Screen title="Readiness" sub="Transparent evidence-based model · your validated rules win">
    {(stuck || mode === 'analisis') && <div className={`gatemini g-${tier ? { prime: 'green', optimal: 'green', compromised: 'yellow', depleted: 'red' }[tier.id] : has ? g.level : 'none'}`}><span className="gdot" aria-hidden="true" /><span>{label}</span><small>{sess ? `${sess.label || KIND[sess.kind].label}${sess.km ? ' · ' + sess.km + ' km' : ''}` : ''}</small></div>}
    <div className="datebar">
      <button onClick={() => setDate(addDays(date, -1))} aria-label="Previous day"><Icon n="left" /></button>
      <div><b>{fmtLong(date)}</b>{date === T && <small>today</small>}</div>
      <button onClick={() => setDate(addDays(date, 1))} aria-label="Next day" className="flip"><Icon n="left" /></button>
    </div>
    <div className="seg3" role="group" aria-label="Readiness view">{[['pagi', 'Morning'], ['analisis', 'Analysis']].map(([k, l]) => <button key={k} aria-pressed={mode === k} onClick={() => { setMode(k); window.scrollTo(0, 0) }}>{l}</button>)}</div>

    {mode === 'pagi' && <>
    {/* ---- Layer 2.1: verdict & prescription ---- */}
    <div ref={topRef} className="card" role="status" aria-live="polite">
      <div className="hero">
        <RadialGauge value={rd.score} tone={tier ? TIER_TONE[tier.id] : 'none'} label="Skor readiness" sub={rd.score == null ? 'not enough data' : '/ 100'} />
        <div className="hx">
          {tier ? <span className={'tierc tier-' + tier.id}>{tier.label}</span> : <span className="tierc">No score yet</span>}
          <h2>{tier ? tier.advice : 'Needs ≥ 60 points of data — fill in the check-in or wait for the sync.'}</h2>
          <p className="muted">Data: {rd.coverage}/100 pts{rd.capped ? ` · score capped (raw ${rd.raw})` : ''}</p>
          {M.recov?.recovery_hours != null && <p className="muted">Full recovery (COROS): ±{M.recov.recovery_hours} h · as of {M.recov.date.slice(5)}</p>}
        </div>
      </div>
      {(rd.caps.length > 0 || (has && g.reasons.length > 0)) && <ul className="gatebig-ul">{[...rd.caps.map((c) => ({ level: 'red', msg: c.why })), ...(has ? g.reasons.filter((r) => !rd.caps.some((c) => c.why.startsWith(r.msg.slice(0, 8)))) : [])].map((r, i) => <li key={i} className={r.level}>{r.msg}</li>)}</ul>}
      {sess && <div className={'mod ' + (needsMod ? (tier?.id === 'depleted' || g.level === 'red' ? 'red' : 'yellow') : 'green')}>
        <b>Today: {sess.label || KIND[sess.kind].label}{sess.km ? ` · ${sess.km} km` : ''}</b>
        {needsMod ? <><p>Advice: {tier?.id === 'depleted' || g.level === 'red' ? `rest or easy at ${easy}` : `drop to easy (${easy}) or cut to ±${cutKm} km`}.</p>
          <div className="row2"><button className="btn sm" aria-pressed={f.adjust === 'easy'} onClick={() => set({ adjust: f.adjust === 'easy' ? '' : 'easy' })}>{f.adjust === 'easy' ? '✓ ' : ''}Swap to easy</button><button className="btn sm" aria-pressed={f.adjust === 'cut'} onClick={() => set({ adjust: f.adjust === 'cut' ? '' : 'cut' })}>{f.adjust === 'cut' ? '✓ ' : ''}Cut 25%</button></div></>
          : <p>{rd.score != null || has ? 'No reason to scale the session down.' : 'Fill in the check-in for a verdict.'}</p>}
      </div>}
      {(needsMod && g.level !== 'green' && has) && <input className="ovr" aria-label="Override reason" placeholder="Going ahead anyway? Write why (saved)" value={f.override} onChange={(e) => set({ override: e.target.value })} />}
    </div>

    {/* ---- Morning check-in: 1 tap on a normal day (Feel). Sleep HR / HRV come from COROS automatically; pain defaults to 0 ---- */}
    <Card title="Morning check-in" className="coros" right={<span className="saved" aria-live="polite">{has ? 'saved' : ''}</span>}>
      {hd.state === 'none' && <p className="muted">COROS data has not been pulled for this date — enter Sleep HR manually under “Details”.</p>}
      {row && <p className="muted">COROS read automatically · Sleep HR {row.sleep_hr_avg ?? '—'} · HRV {row.hrv_avg ?? '—'} ms {row.hrv_status ? `(${row.hrv_status})` : ''}</p>}
      <Pill5 label="How the body feels today" value={f.energy} onChange={feel} lo="drained" hi="fresh" />
      <div className="seg" role="group" aria-label="Pain" style={{ marginTop: 10 }}>
        <button aria-pressed={!painOpen && !(f.pain >= 1)} className={!painOpen && !(f.pain >= 1) ? 'on' : ''} onClick={() => { setPainOpen(false); set({ pain: f.energy !== '' || f.pain !== '' ? 0 : '', tibia: false, painSites: {} }) }}>No pain</button>
        <button aria-pressed={painOpen || f.pain >= 1} className={painOpen || f.pain >= 1 ? 'on' : ''} onClick={() => setPainOpen(true)}>Some pain</button>
      </div>
      {(painOpen || f.pain >= 1) && <div className="painsites">{SITES.map(([k, l]) => <div key={k} className="fld"><span>{l}</span>
        <div className="pain" role="group" aria-label={`Pain ${l}`}>{[0, 1, 2, 3, 4, 5, 6].map((n) => <button key={n} aria-pressed={(f.painSites?.[k] || 0) === n} className={n >= 2 ? 'hi' : ''} onClick={() => setSite(k, n)}>{n === 6 ? '6+' : n}</button>)}</div></div>)}
        <small className="muted">≥ 2/10 = durability event (rule): the session is scaled down automatically.</small></div>}
      <details className="more"><summary>Details (optional)</summary><div className="form">
        <Field label="Sleep HR (bpm)" hint="> 67 = no hard running" err={shrErr}><input inputMode="numeric" type="number" value={f.sleepHR} aria-invalid={!!shrErr} onChange={num('sleepHR')} /></Field>
        <Field label="Sleep HRV"><div className="seg" role="group" aria-label="HRV">{[['normal', 'Normal'], ['reduced', 'Reduced']].map(([v, l]) => <button key={v} aria-pressed={f.hrv === v} className={f.hrv === v ? 'on ' + v : ''} onClick={() => set({ hrv: f.hrv === v ? '' : v })}>{l}</button>)}</div></Field>
        <Pill5 label="Muscle soreness" value={f.doms} onChange={(v) => set({ doms: v })} lo="very sore" hi="not sore" />
        <Pill5 label="Hydration / food" value={f.hydration} onChange={(v) => set({ hydration: v })} lo="poor" hi="good" />
        <Field label="Yesterday's TE"><input inputMode="decimal" type="number" step="0.1" value={f.te} onChange={num('te')} /></Field>
        <Field label="Meal buffer (minutes)" hint="≥ 90 before running"><input inputMode="numeric" type="number" value={f.mealBufferMin} onChange={num('mealBufferMin')} /></Field>
        <Field label="Planned duration (minutes)"><input inputMode="numeric" type="number" value={f.plannedMin} onChange={num('plannedMin')} /></Field>
        <label className="sw"><input type="checkbox" checked={f.fasted} onChange={(e) => set({ fasted: e.target.checked })} /><span>Fasted run</span></label>
      </div></details>
    </Card>


    <div className="score-grid two" role="group" aria-label="Recovery summary">
      <div><small>Overnight HRV <Info k="HRV" /></small><b>{hv.today ?? '—'}</b><em>{hv.enough ? `7 hr ${hv.roll7} ms` : 'needs 14 d'}</em></div>
      <div><small>Resting HR <Info k="RHR" /></small><b>{rh.value ?? '—'}</b><em>{rh.enough ? `${sign(rh.dev)} vs 30 hr` : ''}</em></div>
      <div><small>Sleep (asleep)</small><b>{sl.enough ? hm(sl.asleep_min) : '—'}</b><em>{sl.enough ? `${sign(Math.round(sl.vs_need_min))} min vs need` : ''}</em></div>
      <div><small>Form (TSB) <Info k="TSB" /></small><b>{sign(cur?.tsb)}</b><em>{fz ? `${cur.tsbPct}% · ${fz.label}` : ''}</em></div>
    </div>

    {wg.blocked && <>
    <Card title="Weekly gate · ◇ Thursday tempo" tone={wg.blocked ? 'red' : 'green'}>
      <p><b>{wg.blocked ? 'Thursday stays strides / hills' : 'No reason to hold back the ◇ tempo'}</b></p>
      <p className="muted">{wg.bad} nights with Sleep HR &gt; 67 / HRV Reduced in the last 7 days{wg.pain ? ' · pain / tibia positive' : ''}.</p>
    </Card>
    </>}
    <button className="btn wide" onClick={() => { setMode('analisis'); window.scrollTo(0, 0) }}>See the full analysis →</button>
    </>}

    {mode === 'analisis' && <>
    <Card title="Pillar contribution">
      <div className="pbar" role="img" aria-label={Object.entries(rd.pillars).map(([k, v]) => `${PILLAR[k]} ${Math.round(v.earned)} of ${v.weight}`).join(', ')}>
        {Object.entries(rd.pillars).map(([k, v]) => <i key={k} className={'pb-' + k} style={{ width: v.earned + '%' }} />)}</div>
      {Object.entries(rd.pillars).map(([k, v]) => <details key={k} className="more"><summary>{PILLAR[k]} · {Math.round(v.earned)}/{v.weight}{v.haveWeight < v.weight ? ` (data ${Math.round(v.haveWeight)})` : ''}</summary>
        {v.comps.map((c) => <div key={c.id} className="prow"><span>{c.label}</span><b>{c.pts == null ? '—' : `${r1(c.pts)}/${r1(c.max)}`}</b><small>{c.value == null ? 'no data yet' : c.value}</small></div>)}</details>)}
      <Src>Weights: musculoskeletal & subjective 30 · autonomic 30 · sleep 20 · load 20 (taper/peak phase ±5). Rationale & formulas: docs/readiness-model.md. Saw 2016 (PMID 26423706): subjective measures are more sensitive than objective ones.</Src>
    </Card>

    {/* ---- Layer 2.2: load ---- */}
    <h2 className="sech">Training load & injury risk</h2>
    {M.state === 'ok' && !M.series.some((d) => d.load) ? <div className="card empty"><b>No Training Load yet</b>Connect COROS and pull the history — the load panel fills in automatically.</div> : <>
      <div className="score-grid">
        <div><small>Fitness (CTL) <Info k="CTL" /></small><b>{cur?.ctl ?? '—'}</b><em>{M.ramp != null ? `${sign(M.ramp)} / 7 d` : ''}</em></div>
        <div><small>Fatigue (ATL) <Info k="ATL" /></small><b>{cur?.atl ?? '—'}</b><em>{prevAtl ? `${sign(Math.round(((cur.atl - prevAtl) / prevAtl) * 100))}% vs last week` : ''}</em></div>
        <div><small>Form (TSB) <Info k="TSB" /></small><b>{sign(cur?.tsb)}</b><em>{fz ? `${cur.tsbPct}% · ${fz.label}` : ''}</em></div>
        <div><small>ACWR ({acwrMode === 'ewma' ? 'EWMA' : '7:28'}) <Info k="ACWR" /></small><b>{acwrShown ?? '—'}</b><em>{acwrShown == null ? 'needs 35 d' : acwrShown > 1.5 ? 'high' : acwrShown > 1.3 ? 'caution' : acwrShown < 0.8 ? 'low' : 'sweet spot'}</em></div>
        <div><small>CTL ramp</small><b>{sign(M.ramp)}</b><em>per 7 days</em></div>
        <div><small>Monotony · Strain <Info k="Monotony" /></small><b>{M.mono?.monotony ?? '—'}</b><em>{M.mono?.strain != null ? `strain ${M.mono.strain}` : ''}</em></div>
      </div>
      <Card title="PMC: fitness · fatigue · form" right={<div className="seg" role="group" aria-label="Rentang">{[[42, '6M'], [90, '3B']].map(([d, l]) => <button key={d} aria-pressed={range === d} className={range === d ? 'on' : ''} onClick={() => setRange(d)}>{l}</button>)}</div>}>
        <PMCChart data={pmcData} proj={M.proj} label={`Fitness ${cur?.ctl}, fatigue ${cur?.atl}, form ${cur?.tsb}; 14-day projection from the plan`} />
        <div className="legend"><span><i className="ll" style={{ borderColor: 'var(--c-long)' }} />Fitness (CTL)</span><span><i className="ll" style={{ borderColor: 'var(--c-tt)' }} />Fatigue (ATL)</span><span><i className="ll" style={{ borderColor: 'var(--text)' }} />Form % (bawah)</span><span><i className="ll" style={{ borderTopStyle: 'dashed', borderColor: 'var(--muted)' }} />Plan projection</span></div>
        <Src>[calc] CTL τ42 / ATL τ7 from daily COROS Training Load; TSB = yesterday's CTL − yesterday's ATL. Form zones are relative to fitness (convention, not evidence) because COROS Training Load is not on the TSS scale. Projection = planned km × your own TL/km per session type.</Src>
      </Card>
      <Card title="ACWR" right={<div className="seg" role="group" aria-label="Metode ACWR">{[['ewma', 'EWMA'], ['roll', '7:28']].map(([k, l]) => <button key={k} aria-pressed={acwrMode === k} className={acwrMode === k ? 'on' : ''} onClick={() => setAcwrMode(k)}>{l}</button>)}</div>}>
        <Speedometer value={acwrShown} />
        <BandLine data={M.pmc.slice(-30)} keys={[{ key: 'acwr', color: 'var(--text)' }]} refBand={[0.8, 1.3]} label="ACWR 30 days with the 0.8–1.3 band" height={110} />
        <Src>[LITERATURE] EWMA is more sensitive (Griffin 2020, PMID 31691167; Maupin 2020, PMID 32158285); 0.8–1.3 tends to carry the lowest risk. Methodological critique: Impellizzeri 2020 (PMID 32502973). Information, not a gate.</Src>
      </Card>
      <Card title="Distance progression & internal vs external load">
        <p><b>{M.prog.cur} km</b> in the last 7 days vs {M.prog.prev} km before · <Chip tone={pb === 'safe' ? 'green' : pb === 'caution' ? 'yellow' : pb === 'alert' ? 'red' : undefined}>{M.prog.pct == null ? 'no comparison yet' : sign(M.prog.pct) + '%'}</Chip></p>
        <Bullet value={M.prog.pct} unit="%" bands={[{ from: -50, to: 10, cls: 'b-safe' }, { from: 10, to: 30, cls: 'b-caution' }, { from: 30, to: 80, cls: 'b-alert' }]} label={`Weekly distance progression ${M.prog.pct}%`} />
        <GroupedBars groups={weeksIE.map((w) => ({ label: w.label, int: Math.round((w.tl / mTl) * 100), ext: Math.round((w.km / mKm) * 100) }))} series={[{ key: 'int', color: 'var(--c-tt)' }, { key: 'ext', color: 'var(--c-long)' }]} label="Internal load (Training Load) and external load (km), percent of the 6-week average" fmt={(v) => v} />
        <div className="legend"><span><i className="kdot" style={{ background: 'var(--c-tt)' }} />Internal (TL)</span><span><i className="kdot" style={{ background: 'var(--c-long)' }} />External (km)</span><span className="muted">% of the 6-week average</span></div>
        <Src>Nielsen 2014 (PMID 25155475): &gt;30% per week was linked to distance-related injury — including MTSS (exploratory, novice runners). CTL ramp is shown without a band (the +5–7 CTL/week band is a TSS convention).</Src>
      </Card></>}

    {/* ---- Layer 2.3: autonomic ---- */}
    <h2 className="sech">Autonomic nervous system</h2>
    <div className="score-grid">
      <div><small>Overnight HRV <Info k="HRV" /></small><b>{hv.today ?? '—'}</b><em>{hv.enough ? `7 hr ${hv.roll7} ms` : 'needs 14 d'}</em></div>
      <div><small>60-day corridor</small><b>{hv.enough ? `${hv.lo}–${hv.hi}` : '—'}</b><em>± 0,5 SD (ln)</em></div>
      <div><small>CV 7-day <Info k="CV" /></small><b>{hv.cv7 != null ? hv.cv7 + '%' : '—'}</b><em>{hv.flagCv ? 'unstable' : hv.enough ? 'stable' : ''}</em></div>
      <div><small>Resting HR <Info k="RHR" /></small><b>{rh.value ?? '—'}</b><em>{rh.enough ? `${sign(rh.dev)} vs 30 hr` : ''}</em></div>
      <div><small>7-day status</small><b>{hv.enough ? (hv.flagTrend ? 'down' : 'normal') : '—'}</b><em>{hv.flagDay ? 'suppressed today' : ''}</em></div>
      <div><small>RHR spike</small><b>{rh.enough ? (rh.spike ? 'yes' : 'no') : '—'}</b><em>≥ +5 bpm</em></div>
    </div>
    <Card title="60-day HRV corridor">
      <BandLine data={M.hrvSeries} keys={[{ key: 'roll7', color: 'var(--c-long)' }]} band={['lo', 'hi']} dots={{ key: 'hrv', cls: (d) => (d.lo != null && d.hrv < d.lo ? 'low' : '') }} label={`Daily HRV and 7-day mean with a ±0.5 SD corridor; latest ${hv.today} ms`} />
      <div className="legend"><span><i className="kdot" style={{ background: 'var(--c-long)' }} />Daily HRV</span><span><i className="ll" style={{ borderColor: 'var(--c-long)' }} />7-day mean</span><span><i className="kdot" style={{ background: 'var(--green)', opacity: 0.4 }} />Normal corridor</span><span><i className="kdot" style={{ background: 'var(--yellow)' }} />Below corridor</span></div>
      <Src>Plews 2013 (PMID 23852425): use a rolling mean and an individual baseline. Yellow dot = acute drop (normal after a hard session); the 7-day line leaving the corridor = a systemic signal. The spec uses ±0.75 SD; Lumpad uses ±0.5 SD (smallest worthwhile change).</Src>
    </Card>
    <Card title="Resting HR vs 30-day baseline"><BandLine data={M.rhrSeries} keys={[{ key: 'rhr', color: 'var(--c-quality)' }, { key: 'base', color: 'var(--muted)', cls: 'dash' }]} label={`Resting HR ${rh.value}, baseline ${rh.base}`} height={110} /></Card>
    <Card title="Autonomic quadrant (7 days)" right={M.quadrant.length ? <Chip tone={quadrantLabel(M.quadrant.at(-1).x, M.quadrant.at(-1).y)[0] === 'purple' ? undefined : quadrantLabel(M.quadrant.at(-1).x, M.quadrant.at(-1).y)[0]}>{quadrantLabel(M.quadrant.at(-1).x, M.quadrant.at(-1).y)[1].split(' · ')[0]}</Chip> : null}>
      {M.quadrant.length ? <><Quadrant points={M.quadrant} /><p className="muted">Today: {quadrantLabel(M.quadrant.at(-1).x, M.quadrant.at(-1).y)[1]}. Descriptive, not a diagnosis.</p></> : <p className="muted">Needs ≥ 14 days of HRV and 7 days of RHR.</p>}
    </Card>

    {/* ---- Layer 2.4: sleep & musculoskeletal ---- */}
    <h2 className="sech">Sleep & muscles</h2>
    <div className="score-grid">
      <div><small>Sleep (asleep)</small><b>{sl.enough ? hm(sl.asleep_min) : '—'}</b><em>{sl.enough ? `${sign(Math.round(sl.vs_need_min))} min vs need` : ''}</em></div>
      <div><small>Need</small><b>{hm(settings.sleepNeedMin || 480)}</b><em>change in Profile</em></div>
      <div><small>Efficiency</small><b>{sl.enough ? sl.eff + '%' : '—'}</b><em>asleep / in bed</em></div>
      <div><small>14-day debt</small><b>{hm(sl.debt_min)}</b><em>{sl.nights} nights</em></div>
      <div><small>COROS score</small><b>{sl.score ?? '—'}</b><em>[COROS]</em></div>
      <div><small>Sleep HR</small><b>{sl.hr_avg ?? '—'}</b><em>&gt; 67 = gate</em></div>
    </div>
    {sl.enough && <Card title="Sleep stages"><Stacked100 parts={[{ k: 'Deep', v: sl.deep, c: 'var(--c-long)' }, { k: 'REM', v: sl.rem, c: 'var(--c-tt)' }, { k: 'Light', v: sl.light, c: 'color-mix(in srgb, var(--c-long) 40%, var(--surface2))' }, { k: 'Awake', v: sl.awake, c: 'var(--c-quality)' }]} label={`Deep ${sl.deep}%, REM ${sl.rem}%, light ${sl.light}%, awake ${sl.awake}%`} />
      <Src>The hypnogram and overnight HR curve are not shown: the COROS MCP only gives totals per stage, not their time order.</Src></Card>}
    <Card title="14-day sleep debt"><Waterfall series={sl.series} label={`Sleep vs need over 14 days; debt ${Math.round(sl.debt_min / 6) / 10} hours`} />
      <Src>Walsh 2021 (PMID 33144349): sleep need is individual; chronic &lt; 7 h raises infection risk. The need is not increased automatically by load — there is no evidence-based formula.</Src></Card>
    <Card title="Muscle load map" right={Object.keys(ov).length ? <button className="link" onClick={() => setOv({})}>Reset manual</button> : null}>
      <BodyMap load={M.muscle} overrides={ov} onTap={tapRegion} />
      <Src>[heuristic] Automatic from the sessions actually done (gym lower/plyo from plan tags, runs from session type), decaying with a 12–36 h half-life. Tap an area to change it manually (* = manual).</Src></Card>
    <Card title="Systemic vs structural readiness"><TwinBars a={{ label: 'Systemic (HRV, RHR, sleep)', v: sys }} b={{ label: 'Structural (muscle, pain, tibia)', v: str }} />
      {sys != null && str != null && sys - str >= 25 && <p className="banner">Heart is ready, muscles/structure are not — avoid fast intervals and hills today.</p>}</Card>

    <Card title="Weekly gate · ◇ Thursday tempo" tone={wg.blocked ? 'red' : 'green'}>
      <p><b>{wg.blocked ? 'Thursday stays strides / hills' : 'No reason to hold back the ◇ tempo'}</b></p>
      <p className="muted">{wg.bad} nights with Sleep HR &gt; 67 / HRV Reduced in the last 7 days{wg.pain ? ' · pain / tibia positive' : ''}.</p>
    </Card>
    </>}
  </Screen>
}
