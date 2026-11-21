import { useEffect, useRef, useState } from 'react'
import { useStore } from './store.js'
import { evaluate, weeklyGate, EMPTY_DAY, hasInput, HARD } from './lib/gate.js'
import { paces, fmtPace } from './lib/vdot.js'
import { BY_DATE, today, addDays, fmtLong, KIND } from './lib/calendar.js'
import { PILLAR } from './lib/readiness.js'
import { formZone, progressionBand } from './lib/load.js'
import { mean, r1 } from './lib/stats.js'
import Conditions from './Conditions.jsx'
import { useSub } from './useSub.js'
import { Card, Chip, Icon, Info, Evidence, SegmentedTabs, StatusPill } from './ui.jsx'
import ScaleCard from './ScaleCard.jsx'
import { useHealthDay, hrvLow } from './sync.js'
import { hm } from './api.js'
import { useModel } from './model.js'
import { BandLine, PMCChart, BodyMap, Stacked100, Bullet, GroupedBars, TwinBars } from './charts2.jsx'

const Field = ({ label, hint, err, children }) => <label className="fld"><span>{label}</span>{children}{err ? <small className="err" role="alert">{err}</small> : hint && <small>{hint}</small>}</label>
const Src = ({ children }) => <Evidence>{children}</Evidence>
const sign = (n) => (n == null ? '—' : (n > 0 ? '+' : '') + n)

const SITES = [
  ['vmo_l', 'VMO Left'],
  ['achilles', 'Achilles'],
  ['plantar', 'Plantar'],
  ['tibia', 'Tibia'],
]

const MUSCLE_TILES = [
  ['quads', 'Quadriceps'],
  ['calves', 'Calves & Soleus'],
  ['shins', 'Shin / Tibialis'],
  ['hamstrings', 'Hamstring'],
  ['glutes', 'Glutes / Hips'],
  ['core', 'Lower Back / Core'],
]

export default function Readiness({ vdot, settings, focus }) {
  const T = today(), [date, setDate] = useState(T)
  const [f, setF] = useStore('lumpad.daily.' + date, EMPTY_DAY)
  const [ov, setOv] = useStore('lumpad.muscle.' + date, {})
  const [postLr, setPostLr] = useStore('lumpad.postlr', { gi: '0', gels: 4, hyd: 'yes' })
  const [panel, setPanel] = useSub(['all', 'conditions', 'load', 'sleep', 'auto'], 'all')
  useEffect(() => {
    if (focus?.mode === 'analysis' || focus?.mode === 'analisis') {
      setTimeout(() => document.getElementById('sec-load')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 250)
    }
  }, [focus])
  const [hist, setHist] = useState({}), [range, setRange] = useState(42), [acwrMode, setAcwrMode] = useState('ewma')
  const hd = useHealthDay(date), row = hd.row, M = useModel(date, settings, vdot, f, ov)
  const [painOpen, setPainOpen] = useState(false)
  useEffect(() => { fetch('/api/kv/prefix?prefix=lumpad.daily.').then((r) => r.json()).then(setHist).catch(() => {}) }, [])
  const topRef = useRef(), [stuck, setStuck] = useState(false)
  useEffect(() => {
    if (!topRef.current) { setStuck(false); return }
    const o = new IntersectionObserver(([e]) => setStuck(!e.isIntersecting))
    o.observe(topRef.current)
    return () => o.disconnect()
  }, [panel])

  const sess = BY_DATE[date] || null, g = evaluate(f, sess), has = hasInput(f), p = paces(vdot.v), rd = M.readiness, tier = rd.tier
  const easy = `${fmtPace(p.E[1])}–${fmtPace(p.E[0])} /km`
  const set = (patch) => setF({ ...f, ...patch }), num = (k) => (e) => set({ [k]: e.target.value === '' ? '' : +e.target.value })
  const shrErr = f.sleepHR !== '' && (f.sleepHR < 30 || f.sleepHR > 130) ? 'Usually 40–80 bpm — check again' : ''
  useEffect(() => {
    if (row && f.sleepHR === '' && f.hrv === '' && (row.sleep_hr_avg != null || row.hrv_status)) {
      setF({ ...f, ...(row.sleep_hr_avg != null ? { sleepHR: Math.round(row.sleep_hr_avg) } : {}), ...(row.hrv_status ? { hrv: hrvLow(row.hrv_status) ? 'reduced' : 'normal' } : {}) })
    }
  }, [row?.date, row?.pulled_at]) // eslint-disable-line
  const feel = (v) => set({ energy: v, ...(v !== '' && f.pain === '' ? { pain: 0, tibia: false } : {}) })
  const setSite = (k, n) => { const ps = { ...(f.painSites || {}), [k]: n }; const worst = Math.max(0, ...Object.values(ps)); set({ painSites: ps, pain: worst, tibia: (ps.tibia || 0) > 0 }) }
  const toggleSiteChip = (k) => setSite(k, (f.painSites?.[k] || 0) >= 2 ? 0 : 2)
  const days7 = Array.from({ length: 7 }, (_, i) => addDays(date, i - 6)), rec = (d) => (d === date ? f : hist['lumpad.daily.' + d] || null), wg = weeklyGate(days7.map(rec).filter(Boolean))
  const label = rd.score != null ? `${tier.label} · ${rd.score}` : has ? { green: 'Go', yellow: 'Scale down', red: 'Swap to easy / rest' }[g.level] : 'Waiting for morning data'
  const hard = sess && HARD.has(sess.kind), needsMod = hard && (tier?.id === 'compromised' || tier?.id === 'depleted' || g.level !== 'green')
  const cutKm = sess?.km ? Math.round(sess.km * 0.75 * 10) / 10 : null
  const cur = M.cur, fz = formZone(cur?.tsbPct), pmcData = M.pmc.slice(-range)
  const acwrShown = acwrMode === 'ewma' ? cur?.acwr : M.acwrRoll
  const pb = progressionBand(M.prog.pct), sl = M.sleep, hv = M.hrv, rh = M.rhr
  const hvPct = hv.enough && hv.roll7 ? Math.round(((hv.today - hv.roll7) / hv.roll7) * 100) : null
  const sys = (() => { const a = rd.pillars.ans, s = rd.pillars.sleep, w = a.haveWeight + s.haveWeight; return w ? Math.round(((a.earned + s.earned) / w) * 100) : null })()
  const str = rd.pillars.msk.haveWeight ? Math.round((rd.pillars.msk.earned / rd.pillars.msk.haveWeight) * 100) : null
  const weeksIE = Array.from({ length: 6 }, (_, i) => {
    const end = addDays(date, -7 * (5 - i)), st = addDays(end, -6)
    const tl = M.series.filter((d) => d.date >= st && d.date <= end).reduce((a, d) => a + d.load, 0)
    const km = M.acts.filter((a) => a.sport_class === 'run' && a.date >= st && a.date <= end).reduce((s, a) => s + (a.distance_m || 0) / 1000, 0)
    return { label: end.slice(5), tl, km }
  })
  const mTl = mean(weeksIE.map((w) => w.tl)) || 1, mKm = mean(weeksIE.map((w) => w.km)) || 1
  const tapRegion = (k) => { const auto = M.muscle[k] || 0, curv = ov[k]; const next = curv == null ? Math.min(3, Math.round(auto) + 1) : curv >= 3 ? null : curv + 1; const o = { ...ov }; if (next == null) delete o[k]; else o[k] = next; setOv(o) }
  const musclePct = (k) => {
    const raw = ov[k] ?? M.muscle?.[k] ?? 0
    return Math.min(100, Math.max(0, Math.round((raw / 3) * 100)))
  }
  const lastLr = M.acts.find((a) => a.sport_class === 'run' && (a.distance_m || 0) >= 16000)

  const PANEL_TABS = [
    { id: 'all', label: 'Overview' },
    { id: 'conditions', label: 'Conditions Now' },
    { id: 'load', label: 'Load · PMC · ACWR' },
    { id: 'sleep', label: 'Sleep' },
    { id: 'auto', label: 'HRV · Autonomic' },
  ]

  return <section className="screen">
    {/* 1. Unified Readiness Command Header */}
    <div className="card prof-cmd">
      <div className="prof-cmd-top">
        <div>
          <div className="chips" style={{ margin: '0 0 6px' }}>
            <StatusPill tone={tier ? { prime: 'green', optimal: 'green', compromised: 'amber', depleted: 'red' }[tier.id] : 'neutral'}>
              {rd.score != null ? `${rd.score}/100 · Data ${rd.coverage}/100` : `Data ${rd.coverage}/100`}
            </StatusPill>
            {rd.caps.length > 0 && <StatusPill tone="red">GATE ACTIVE</StatusPill>}
          </div>
          <h1>Readiness &amp; Physiological Load</h1>
          <p className="sub">Evidence-based transparent model · Morning check-in and all 6 telemetry charts unified on one page</p>
        </div>
        <div className="datebar" style={{ margin: 0 }}>
          <button onClick={() => setDate(addDays(date, -1))} aria-label="Previous day"><Icon n="left" /></button>
          <div><b>{fmtLong(date)}</b>{date === T && <small>today</small>}</div>
          <button onClick={() => setDate(addDays(date, 1))} aria-label="Next day" className="flip"><Icon n="left" /></button>
        </div>
      </div>

      <div className="prof-cmd-bar">
        <div className="subtabs-scroll"><SegmentedTabs tabs={PANEL_TABS} value={panel} onChange={setPanel} label="Readiness sections" /></div>
      </div>
    </div>

    {stuck && <div className={`gatemini g-${tier ? { prime: 'green', optimal: 'green', compromised: 'yellow', depleted: 'red' }[tier.id] : has ? g.level : 'none'}`}><span className="gdot" aria-hidden="true" /><span>{label}</span><small>{sess ? `${sess.label || KIND[sess.kind].label}${sess.km ? ' · ' + sess.km + ' km' : ''}` : ''}</small></div>}

    {panel === 'conditions' && <Conditions />}

    {panel === 'all' && date === T && <div id="sec-scaler" tabIndex={-1}><ScaleCard rd={rd} M={M} T={T} /></div>}

    {/* 4. Top Row (7 / 5): Morning Subjective & Mechanical Check-in + Readiness Score Breakdown */}
    {panel === 'all' && <div id="sec-check" tabIndex={-1} className="bio-split-75">
      <Card title="Morning Subjective & Mechanical Check-in" className="coros" right={<StatusPill tone={has ? 'green' : 'neutral'}>{has ? '✓ saved' : 'pending'}</StatusPill>}>
        <p className="muted" style={{ marginTop: 0 }}>
          {row ? `Auto-synced from COROS · Sleep HR ${row.sleep_hr_avg ?? '—'} bpm · HRV ${row.hrv_avg ?? '—'} ms${row.hrv_status ? ` (${row.hrv_status})` : ''}` : 'COROS data not pulled for this date yet — enter Sleep HR manually under Details.'}
        </p>

        <div className="fld" style={{ marginBottom: 12 }}>
          <span>Subjective Feel Today <small className="muted">(1 = exhausted · 5 = fresh)</small></span>
          <div className="pill5" role="group" aria-label="Subjective Feel Today">
            {[1, 2, 3, 4, 5].map((n) => <button key={n} aria-pressed={f.energy === n} onClick={() => feel(f.energy === n ? '' : n)}>{n}</button>)}
          </div>
        </div>

        <div className="fld" style={{ marginBottom: 12 }}>
          <span>Mechanical / Plantar Pain Gate (Jakim Rule)</span>
          <div className="seg" role="group" aria-label="Pain gate">
            <button aria-pressed={!painOpen && !(f.pain >= 1)} className={!painOpen && !(f.pain >= 1) ? 'on' : ''} onClick={() => { setPainOpen(false); set({ pain: f.energy !== '' || f.pain !== '' ? 0 : '', tibia: false, painSites: {} }) }}>✓ Pain-Free (0/10)</button>
            <button aria-pressed={painOpen || f.pain >= 1} className={painOpen || f.pain >= 1 ? 'on' : ''} onClick={() => setPainOpen(true)}>⚠ Mechanical Pain / Stiffness (≥2/10)</button>
          </div>
        </div>

        {(painOpen || f.pain >= 1) && <div className="painsites" style={{ marginBottom: 12 }}>
          {SITES.map(([k, l]) => <div key={k} className="fld"><span>{l}</span>
            <div className="pain" role="group" aria-label={`Pain ${l}`}>{[0, 1, 2, 3, 4, 5, 6].map((n) => <button key={n} aria-pressed={(f.painSites?.[k] || 0) === n} className={n >= 2 ? 'hi' : ''} onClick={() => setSite(k, n)}>{n === 6 ? '6+' : n}</button>)}</div>
          </div>)}
          <small className="muted">≥ 2/10 = durability event (rule): session is scaled down automatically.</small>
        </div>}

        {/* Prototype P0.4a 1-Tap MSK Pillar + Post-Long-Run Card (2-col sub-grid) */}
        <div className="rd-subgrid">
          <div className="rd-subbox">
            <div className="kpi-top">
              <b style={{ fontSize: '.8rem' }}>P0.4a 1-Tap MSK Pillar</b>
              <StatusPill tone={rd.pillars.msk.earned < 18 ? 'red' : 'green'}>{Math.round(rd.pillars.msk.earned)} / {rd.pillars.msk.weight} pts</StatusPill>
            </div>
            <p className="muted" style={{ fontSize: '.74rem', margin: '4px 0 8px' }}>Pain 15 pts (≥2/10 caps Readiness at 44) + Feel 12 pts + Muscle Load 3 pts.</p>
            <div className="chips" style={{ margin: 0 }}>
              {SITES.map(([k, l]) => {
                const v = f.painSites?.[k] || 0
                return <button key={k} type="button" className="btn sm" style={v >= 2 ? { background: 'var(--crimson)', color: '#fff', borderColor: 'var(--crimson)', minHeight: 34, padding: '0 10px', fontSize: '.75rem' } : { minHeight: 34, padding: '0 10px', fontSize: '.75rem' }} onClick={() => toggleSiteChip(k)}>
                  {l} ({v})
                </button>
              })}
            </div>
          </div>

          <div className="rd-subbox warn">
            <div className="kpi-top">
              <b style={{ fontSize: '.8rem' }}>Post-Long-Run Card (≥16 km)</b>
              {lastLr && <Chip>{(lastLr.distance_m / 1000).toFixed(1)} km</Chip>}
            </div>
            <div className="rd-lr-inputs">
              <label className="fld"><span>GI (0–3)</span>
                <select value={postLr.gi} onChange={(e) => setPostLr({ ...postLr, gi: e.target.value })}>
                  <option value="0">0 (None)</option><option value="1">1 (Mild)</option><option value="2">2 (Mod)</option><option value="3">3 (Severe)</option>
                </select>
              </label>
              <label className="fld"><span>Gels</span>
                <input type="number" inputMode="numeric" value={postLr.gels} onChange={(e) => setPostLr({ ...postLr, gels: +e.target.value })} />
              </label>
              <label className="fld"><span>Hydrated?</span>
                <select value={postLr.hyd} onChange={(e) => setPostLr({ ...postLr, hyd: e.target.value })}>
                  <option value="yes">Yes</option><option value="no">No</option>
                </select>
              </label>
            </div>
          </div>
        </div>

        <details className="more" style={{ marginTop: 10 }}><summary>Additional Details (Sleep HR, HRV, DOMS, Meal Buffer)</summary><div className="form">
          <Field label="Sleep HR (bpm)" hint="> 67 = no hard running" err={shrErr}><input inputMode="numeric" type="number" value={f.sleepHR} aria-invalid={!!shrErr} onChange={num('sleepHR')} /></Field>
          <Field label="Sleep HRV"><div className="seg" role="group" aria-label="HRV">{[['normal', 'Normal'], ['reduced', 'Reduced']].map(([v, l]) => <button key={v} aria-pressed={f.hrv === v} className={f.hrv === v ? 'on ' + v : ''} onClick={() => set({ hrv: f.hrv === v ? '' : v })}>{l}</button>)}</div></Field>
          <Field label="Yesterday's TE"><input inputMode="decimal" type="number" step="0.1" value={f.te} onChange={num('te')} /></Field>
          <Field label="Meal buffer (min)" hint="≥ 90 before running"><input inputMode="numeric" type="number" value={f.mealBufferMin} onChange={num('mealBufferMin')} /></Field>
          <label className="sw"><input type="checkbox" checked={f.fasted} onChange={(e) => set({ fasted: e.target.checked })} /><span>Fasted run</span></label>
        </div></details>
      </Card>

      {/* Right 5 Cols: Readiness Score Breakdown (Prototype 2×2 tiles + Active Gate Rule box) */}
      <div ref={topRef} className="card" role="status" aria-live="polite">
        <div className="prof-cmd-top" style={{ marginBottom: 10 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '1.05rem' }}>Readiness Score Breakdown ({rd.score ?? '—'}/100)</h2>
            <p className="muted" style={{ margin: '2px 0 0', fontSize: '.78rem' }}>
              {M.recov?.recovery_hours != null ? `COROS Full Recovery: ~${M.recov.recovery_hours}h · ` : ''}Data {rd.coverage}/100 pts{rd.capped ? ` · capped (raw ${rd.raw})` : ''}
            </p>
          </div>
          {tier && <StatusPill tone={{ prime: 'green', optimal: 'green', compromised: 'amber', depleted: 'red' }[tier.id]}>{tier.label}</StatusPill>}
        </div>

        {/* 4-Pillar Horizontal Progress Bar */}
        <div className="pbar" style={{ marginBottom: 12 }} role="img" aria-label={Object.entries(rd.pillars).map(([k, v]) => `${PILLAR[k]} ${Math.round(v.earned)} of ${v.weight}`).join(', ')}>
          {Object.entries(rd.pillars).map(([k, v]) => <i key={k} className={'pb-' + k} style={{ width: v.earned + '%' }} />)}
        </div>

        {/* 2x2 Summary KPI Grid (Prototype Parity) */}
        <div className="rd-kpi2x2">
          <div className="rd-ktile">
            <span>HRV <Info k="HRV" /> ({hv.today ?? '—'} ms)</span>
            <b style={{ color: 'var(--green-t)' }}>{hvPct != null ? `${sign(hvPct)}%` : '—'}</b>
          </div>
          <div className="rd-ktile">
            <span>Sleep ({sl.enough ? hm(sl.asleep_min) : '—'})</span>
            <b style={{ color: 'var(--cobalt-t)' }}>{sl.enough ? `${sl.eff}% Eff` : '—'}</b>
          </div>
          <div className="rd-ktile">
            <span>RHR <Info k="RHR" /> ({rh.value ?? '—'} bpm)</span>
            <b style={{ color: 'var(--cobalt-t)' }}>{rh.enough ? `${sign(rh.dev)} bpm` : '—'}</b>
          </div>
          <div className={`rd-ktile ${cur?.tsb < -30 ? 'warn' : ''}`}>
            <span>Form ({sign(cur?.tsb)})</span>
            <b style={{ color: cur?.tsb < -30 ? 'var(--red-t)' : 'var(--green-t)' }}>{fz ? fz.label : '—'}</b>
          </div>
        </div>

        {/* Active Gate Rule Callout */}
        <div className={`mod ${rd.caps.length > 0 || (cur?.tsb < -30) ? 'yellow' : 'green'}`} style={{ marginTop: 12 }}>
          <b>Active Gate Rule:</b>
          <p style={{ margin: '4px 0 0', fontSize: '.82rem' }}>
            {rd.caps.length > 0 ? rd.caps.map((c) => c.why).join(' · ') : tier ? tier.advice : 'Fill in your morning check-in for a live gate verdict.'}
          </p>
        </div>

        {sess && needsMod && <div className="row2" style={{ marginTop: 10 }}>
          <button className="btn sm" aria-pressed={f.adjust === 'easy'} onClick={() => set({ adjust: f.adjust === 'easy' ? '' : 'easy' })}>{f.adjust === 'easy' ? '✓ ' : ''}Swap to easy ({easy})</button>
          <button className="btn sm" aria-pressed={f.adjust === 'cut'} onClick={() => set({ adjust: f.adjust === 'cut' ? '' : 'cut' })}>{f.adjust === 'cut' ? '✓ ' : ''}Cut 25% (±{cutKm} km)</button>
        </div>}

        <details className="more" style={{ marginTop: 10 }}><summary>Inspect Pillar Point Weights (MSK 30 · ANS 30 · Sleep 20 · Load 20)</summary>
          {Object.entries(rd.pillars).map(([k, v]) => <div key={k} style={{ marginTop: 6 }}>
            <b style={{ fontSize: '.78rem' }}>{PILLAR[k]} · {Math.round(v.earned)}/{v.weight}</b>
            {v.comps.map((c) => <div key={c.id} className="prow"><span>{c.label}</span><b>{c.pts == null ? '—' : `${r1(c.pts)}/${r1(c.max)}`}</b><small>{c.value == null ? 'no data' : c.value}</small></div>)}
          </div>)}
        </details>
      </div>
    </div>}

    {/* 5. 2-Column Telemetry Bento Grid (3 clean pairs of 2 cards) */}
    {panel === 'load' && <div id="sec-load" tabIndex={-1} className="rgrid">
      <Card title="Performance Management Chart (PMC)" right={<div className="seg" role="group" aria-label="Range">{[[42, '6W'], [90, '3M']].map(([d, l]) => <button key={d} aria-pressed={range === d} className={range === d ? 'on' : ''} onClick={() => setRange(d)}>{l}</button>)}</div>}>
        <p className="muted" style={{ marginTop: 0, fontSize: '.78rem' }}>
          Fitness (CTL <Info k="CTL" /> <b>{cur?.ctl ?? '—'}</b>) · Fatigue (ATL <Info k="ATL" /> <b>{cur?.atl ?? '—'}</b>) · Form (TSB <Info k="TSB" /> <b>{sign(cur?.tsb)}</b>) · Monotony <Info k="Monotony" /> {M.mono?.monotony ?? '—'} · Strain {M.mono?.strain ?? '—'}
        </p>
        <PMCChart data={pmcData} proj={M.proj} label={`Fitness ${cur?.ctl}, fatigue ${cur?.atl}, form ${cur?.tsb}`} />
        <div className="legend"><span><i className="ll" style={{ borderColor: 'var(--c-long)' }} />CTL</span><span><i className="ll" style={{ borderColor: 'var(--c-tt)' }} />ATL</span><span><i className="ll" style={{ borderColor: 'var(--text)' }} />Form %</span><span><i className="ll" style={{ borderTopStyle: 'dashed', borderColor: 'var(--muted)' }} />Plan</span></div>
      </Card>

      <Card title="ACWR & Weekly Load Progression" right={<div className="seg" role="group" aria-label="ACWR method">{[['ewma', 'EWMA'], ['roll', '7:28']].map(([k, l]) => <button key={k} aria-pressed={acwrMode === k} className={acwrMode === k ? 'on' : ''} onClick={() => setAcwrMode(k)}>{l}</button>)}</div>}>
        <p className="muted" style={{ marginTop: 0, fontSize: '.78rem' }}>
          ACWR <Info k="ACWR" /> <b>{acwrShown ?? '—'}</b> (0.8–1.3 sweet spot) · Last 7d: <b>{M.prog.cur} km</b> vs {M.prog.prev} km (<Chip tone={pb === 'safe' ? 'green' : pb === 'caution' ? 'yellow' : pb === 'alert' ? 'red' : undefined}>{M.prog.pct == null ? '—' : sign(M.prog.pct) + '%'}</Chip>)
        </p>
        <BandLine data={M.pmc.slice(-30)} keys={[{ key: 'acwr', color: 'var(--cobalt)' }]} refBand={[0.8, 1.3]} label="ACWR 30 days with 0.8–1.3 band" height={125} />
        <Bullet value={M.prog.pct} unit="%" bands={[{ from: -50, to: 10, cls: 'b-safe' }, { from: 10, to: 30, cls: 'b-caution' }, { from: 30, to: 80, cls: 'b-alert' }]} label={`Weekly distance progression ${M.prog.pct}%`} />
        <GroupedBars groups={weeksIE.map((w) => ({ label: w.label, int: Math.round((w.tl / mTl) * 100), ext: Math.round((w.km / mKm) * 100) }))} series={[{ key: 'int', color: 'var(--c-tt)' }, { key: 'ext', color: 'var(--c-long)' }]} label="Internal vs external load" fmt={(v) => v} />
      </Card>
    </div>}

    {panel === 'auto' && <div id="sec-auto" tabIndex={-1} className="rgrid">
      <Card title="Overnight HRV & Normal Band" right={<StatusPill tone={hv.flagTrend ? 'amber' : 'green'}>{hv.enough ? (hv.flagTrend ? 'Suppressed' : 'Optimal') : 'Building'}</StatusPill>}>
        <p className="muted" style={{ marginTop: 0, fontSize: '.78rem' }}>
          Last night: <b>{hv.today ?? '—'} ms</b> · 7d avg: <b>{hv.roll7 ?? '—'} ms</b> · 60d corridor: {hv.enough ? `${hv.lo}–${hv.hi} ms` : 'needs 14d'} · CV <Info k="CV" /> {hv.cv7 != null ? `${hv.cv7}%` : '—'}
        </p>
        <BandLine data={M.hrvSeries} keys={[{ key: 'roll7', color: 'var(--green)' }]} band={['lo', 'hi']} dots={{ key: 'hrv', cls: (d) => (d.lo != null && d.hrv < d.lo ? 'low' : '') }} label={`Daily HRV and 7-day mean; latest ${hv.today} ms`} height={150} />
        <div className="legend"><span><i className="kdot" style={{ background: 'var(--green)' }} />7-day mean &amp; corridor</span><span><i className="kdot" style={{ background: 'var(--yellow)' }} />Below corridor</span></div>
      </Card>

      <Card title={`Resting HR (${rh.value ?? '—'} bpm) & Autonomic State`} right={<StatusPill tone={rh.spike ? 'red' : 'cobalt'}>{rh.spike ? 'RHR Spike' : 'Parasympathetic'}</StatusPill>}>
        <p className="muted" style={{ marginTop: 0, fontSize: '.78rem' }}>
          {rh.enough ? `${sign(rh.dev)} bpm vs 30d avg (${rh.base} bpm)` : 'Building 30d baseline'} · Sleep HR: <b>{sl.hr_avg ?? '—'} bpm</b> (&gt;67 = gate)
        </p>
        <BandLine data={M.rhrSeries} keys={[{ key: 'rhr', color: 'var(--c-quality)' }, { key: 'base', color: 'var(--muted)', cls: 'dash' }]} label={`Resting HR ${rh.value}, baseline ${rh.base}`} height={150} />
        <div style={{ marginTop: 10 }}>
          <TwinBars a={{ label: 'Systemic (HRV, RHR, sleep)', v: sys }} b={{ label: 'Structural (muscle, pain, tibia)', v: str }} />
        </div>
      </Card>
    </div>}

    {panel === 'sleep' && <div id="sec-sleep" tabIndex={-1} className="rgrid">
      <Card title={`Sleep Architecture & 14-Day Debt (${sl.debt_min != null ? hm(Math.abs(sl.debt_min)) : '—'})`} right={<StatusPill tone="cobalt">{sl.enough ? `${sign(Math.round(sl.vs_need_min))}m vs need` : 'No sleep data'}</StatusPill>}>
        <p className="muted" style={{ marginTop: 0, fontSize: '.78rem' }}>
          Asleep <b>{sl.enough ? hm(sl.asleep_min) : '—'}</b> · Efficiency <b>{sl.enough ? sl.eff + '%' : '—'}</b> · Deep+REM <b>{sl.enough ? (sl.deep + sl.rem) + '%' : '—'}</b> · COROS score {sl.score ?? '—'}
        </p>
        {sl.enough && <Stacked100 parts={[{ k: 'Deep', v: sl.deep, c: 'var(--c-long)' }, { k: 'REM', v: sl.rem, c: 'var(--c-tt)' }, { k: 'Light', v: sl.light, c: 'color-mix(in srgb, var(--c-long) 40%, var(--surface2))' }, { k: 'Awake', v: sl.awake, c: 'var(--c-quality)' }]} label={`Deep ${sl.deep}%, REM ${sl.rem}%`} />}
        <div className="score-grid" style={{ marginTop: 12 }}>
          <div><small>Deep + REM</small><b>{sl.enough ? `${sl.deep + sl.rem}%` : '—'}</b><em>Deep {sl.deep ?? '—'}% · REM {sl.rem ?? '—'}%</em></div>
          <div><small>Light Sleep</small><b>{sl.enough ? `${sl.light}%` : '—'}</b><em>Awake {sl.awake ?? '—'}%</em></div>
          <div><small>14d Sleep Debt</small><b style={{ color: sl.debt_min > 60 ? 'var(--red-t)' : undefined }}>{sl.debt_min != null ? `${(sl.debt_min / 60).toFixed(1)}h` : '—'}</b><em>{sl.nights ?? 0} nights</em></div>
        </div>
        <div className={`mod ${wg.blocked ? 'red' : 'green'}`} style={{ marginTop: 12 }}>
          <b>Weekly Gate · ◇ Thursday Tempo:</b> {wg.blocked ? 'Hold to strides / hills' : 'Cleared for ◇ tempo'} ({wg.bad} flagged nights in 7d).
        </div>
      </Card>

      <Card title="Localized Muscle Load Map" right={Object.keys(ov).length ? <button className="link" onClick={() => setOv({})}>Reset manual</button> : <StatusPill tone="amber">Tap tile to override</StatusPill>}>
        <p className="muted" style={{ marginTop: 0, fontSize: '.78rem' }}>Structural load decay (12–36h half-life from runs &amp; lower-body gym). Tap any muscle group to adjust manually.</p>
        <div className="rd-muscle-grid">
          {MUSCLE_TILES.map(([k, lbl]) => {
            const pct = musclePct(k)
            const warn = pct >= 70
            return <button key={k} type="button" className={`rd-mtile ${warn ? 'warn' : 'ok'}`} onClick={() => tapRegion(k)}>
              <span>{lbl}{ov[k] != null ? ' *' : ''}</span>
              <b>{pct}%</b>
            </button>
          })}
        </div>
        <details className="more" style={{ marginTop: 10 }}>
          <summary>Show Anatomical Front / Back Body Diagram</summary>
          <BodyMap load={M.muscle} overrides={ov} onTap={tapRegion} />
        </details>
        <Src>Automatic heuristic from logged sessions (runs + lower-body strength) decaying over 12–36h. * = manual override.</Src>
      </Card>
    </div>}
  </section>
}
