import { useState } from 'react'
import { useStore } from './store.js'
import { EMPTY_BIO, validate, classifyBP, classifyGlucose, byDate, latest, windowMean, weightChange, paceHintPerKg } from './lib/bio.js'
import { today, fmtShort } from './lib/calendar.js'
import { Card, Chip, Icon, SegmentedTabs, StatusPill, ProvenanceBadge } from './ui.jsx'
import { BandLine } from './charts2.jsx'
import { parseHealth, mergeHealth } from './lib/healthimport.js'

const TYPES = [
  ['weight', 'Body Comp'],
  ['bp', 'Blood Pressure'],
  ['glu', 'Glucose'],
  ['lab', 'Lab Panel'],
]
const CTX = { fasting: 'fasting', post: 'post-meal', random: 'random' }
const BLANK = {
  weight: { kg: '', bf: '', lbm: '' },
  bp: { sys: '', dia: '', pulse: '' },
  glu: { mgdl: '', ctx: 'fasting' },
  lab: { name: '', value: '', unit: '', ref: '' },
}
const Field = ({ label, children }) => <label className="fld"><span>{label}</span>{children}</label>
const mean = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null)
const r1 = (x) => (x == null ? '—' : (+x).toFixed(1))

// Weight / composition, blood pressure, glucose and lab values. Logs live in the synced store (server KV) — not in the repository.
export default function Biometrics({ settings, setSettings }) {
  const T = today()
  const [bio, setBio] = useStore('lumpad.bio', EMPTY_BIO)
  const B = { ...EMPTY_BIO, ...bio }
  const [sleepLog, setSleepLog] = useStore('lumpad.sleeplog', [])
  const [mcuLog, setMcuLog] = useStore('lumpad.mcu', [])
  const [imp, setImp] = useState(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [type, setType] = useState('weight')
  const [logTab, setLogTab] = useState('weight')
  const [form, setForm] = useState({ d: T, ...BLANK.weight })
  const [err, setErr] = useState('')

  const pick = (t) => { setType(t); setForm({ d: T, ...BLANK[t] }); setErr('') }
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })
  const add = () => {
    const r = validate(type, form)
    if (!r.ok) return setErr(r.error)
    setErr('')
    setBio({ ...B, [type]: byDate([...B[type], r.entry]) })
    setForm({ d: form.d, ...BLANK[type] })
    setLogTab(type)
  }
  const del = (t, i) => setBio({ ...B, [t]: B[t].filter((_, j) => j !== i) })

  const wSorted = byDate(B.weight), bpSorted = byDate(B.bp), gluSorted = byDate(B.glu)
  const w = latest(B.weight), bp = latest(B.bp), gl = latest(B.glu)
  const cBP = bp && classifyBP(bp.sys, bp.dia), cGl = gl && classifyGlucose(gl.mgdl, gl.ctx)
  const dW = weightChange(B.weight, 90)
  const bp30 = windowMean(B.bp, 'sys', T, 30), bpd30 = windowMean(B.bp, 'dia', T, 30)
  const bpAvgSys = mean(bpSorted.map((e) => e.sys)), bpAvgDia = mean(bpSorted.map((e) => e.dia))
  const gluFasting = gluSorted.filter((e) => e.ctx === 'fasting').map((e) => e.mgdl)
  const gluAvg = mean(gluFasting.length ? gluFasting : gluSorted.map((e) => e.mgdl))
  const gluMin = gluSorted.length ? Math.min(...gluSorted.map((e) => e.mgdl)) : null
  const gluMax = gluSorted.length ? Math.max(...gluSorted.map((e) => e.mgdl)) : null
  const leanest = wSorted.length ? wSorted.reduce((a, b) => (b.kg < a.kg ? b : a), wSorted[0]) : null
  const bestBf = wSorted.filter((e) => e.bf != null).reduce((a, b) => (!a || b.bf < a.bf ? b : a), null)
  const hba1c = [...B.lab].reverse().find((l) => /hba1c/i.test(l.name))

  const kgDeltaVsLeanest = w && leanest ? +(w.kg - leanest.kg).toFixed(1) : null
  const paceSecImpact = kgDeltaVsLeanest != null && kgDeltaVsLeanest > 0 ? Math.round(kgDeltaVsLeanest * paceHintPerKg) : 0
  const fmMinImpact = paceSecImpact > 0 ? ((paceSecImpact * 42.195) / 60).toFixed(1) : null

  const series = (arr, ks) => byDate(arr).map((e) => ({ date: e.d, ...Object.fromEntries(ks.map((k) => [k, e[k]])) }))
  const onFile = async (e) => {
    const f = e.target.files?.[0]; e.target.value = ''; if (!f) return
    try {
      const { readXlsx } = await import('./lib/xlsx.js')
      const H = parseHealth(readXlsx(new Uint8Array(await f.arrayBuffer())))
      const M = mergeHealth(B, sleepLog, mcuLog, H)
      setImp({ name: f.name, found: { weight: H.weight.length, bp: H.bp.length, glu: H.glu.length, lab: H.lab.length, sleep: H.sleep.length, mcu: H.mcu ? 1 : 0 }, M, notes: H.notes })
    } catch (x) {
      setImp({ error: String(x.message || x) })
    }
  }
  const apply = () => {
    setBio(imp.M.bio); setSleepLog(imp.M.sleep); setMcuLog(imp.M.mcu)
    setImp({ done: imp.M.added, name: imp.name })
  }

  const bcs = byDate(B.weight.filter((e) => e.bc)), bc0 = bcs[0], bc1 = bcs.at(-1)
  const mcu = byDate(mcuLog || []).at(-1)
  const sl = byDate(sleepLog || [])
  const slAvg = (k) => { const v = sl.map((e) => e[k]).filter((x) => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null }
  const hm = (m) => (m == null ? '—' : `${Math.floor(m / 60)}h ${String(Math.round(m % 60)).padStart(2, '0')}m`)
  const total = B.weight.length + B.bp.length + B.glu.length + B.lab.length

  const segRows = bc1?.bc ? [
    ['Whole Body', bc1.bc.mus, bc1.bc.sub],
    ['Trunk', bc1.bc.musTrunk, bc1.bc.subTrunk],
    ['Arms', bc1.bc.musArms, bc1.bc.subArms],
    ['Legs', bc1.bc.musLegs, bc1.bc.subLegs],
  ].filter(([, m, s]) => m != null || s != null) : []

  const logTabs = TYPES.map(([id, label]) => ({ id, label, badge: B[id].length }))
  const activeLogs = [...B[logTab]].map((e, i) => ({ e, i })).reverse()

  return <div className="screen">
    {/* Unified Biometrics Command Header */}
    <div className="card prof-cmd">
      <div className="prof-cmd-top">
        <div>
          <div className="chips" style={{ margin: '0 0 6px' }}>
            <StatusPill tone="cobalt">HEALTH DICTIONARY · INTEGRATED BIOMETRICS</StatusPill>
            <ProvenanceBadge tag="ACTUAL" />
          </div>
          <h1>Body Composition, Blood Pressure &amp; Glucose</h1>
          <p className="sub">
            Integrated clinical &amp; anthropometric records: <b>{B.weight.length} Body Comp</b> · <b>{B.bp.length} Blood Pressure</b> · <b>{B.glu.length} Glucose</b> · <b>{B.lab.length} Lab values</b>{mcu ? ` · ${mcu.clinic || 'MCU'}` : ''}. Stored in server KV; classifications are reference ranges, not medical diagnosis.
          </p>
        </div>
        <div className="prof-chips">
          <label className="btn sm" style={{ cursor: 'pointer' }}>
            Import .xlsx
            <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={onFile} style={{ position: 'absolute', opacity: 0, width: 1, height: 1 }} />
          </label>
          <button type="button" className="btn primary sm" onClick={() => setDrawerOpen((x) => !x)} aria-expanded={drawerOpen}>
            {drawerOpen ? 'Close Log Form ✕' : '+ Log New Measurement'}
          </button>
        </div>
      </div>

      {/* Import Preview / Confirmation Banner */}
      {imp && <div className="bio-imp-banner" role="status">
        {imp.error && <p className="err" role="alert" style={{ margin: 0 }}>{imp.error}</p>}
        {imp.M && <>
          <p style={{ margin: '0 0 6px' }}><b>{imp.name}</b>: {imp.found.weight} weight/comp · {imp.found.bp} BP · {imp.found.glu} glucose · {imp.found.lab} labs · {imp.found.sleep} sleep nights{imp.found.mcu ? ' · 1 MCU' : ''}</p>
          <p className="muted" style={{ margin: '0 0 8px', fontSize: '.82rem' }}>New entries to add: {imp.M.added.weight} weight, {imp.M.added.bp} BP, {imp.M.added.glu} glucose, {imp.M.added.lab} lab, {imp.M.added.sleep} sleep{imp.M.added.mcu ? ', 1 MCU' : ''}. {imp.notes.join(' ')}</p>
          <div className="prof-chips">
            {Object.values(imp.M.added).some((n) => n > 0)
              ? <button className="btn primary sm" onClick={apply}>Import {Object.values(imp.M.added).reduce((a, b) => a + b, 0)} new entries</button>
              : <Chip tone="green">Up to date — no duplicates to add</Chip>}
            <button className="btn sm" onClick={() => setImp(null)}>Dismiss</button>
          </div>
        </>}
        {imp.done && <div className="prof-chips">
          <Chip tone="green">Imported</Chip>
          <span className="muted" style={{ fontSize: '.84rem' }}>{Object.values(imp.done).reduce((a, b) => a + b, 0)} new entries saved from {imp.name}.</span>
          <button className="btn sm" onClick={() => setImp(null)}>Dismiss</button>
        </div>}
      </div>}

      {/* Collapsible Quick Daily Biometric Log Drawer */}
      {drawerOpen && <div className="bio-drawer">
        <div className="prof-cmd-top" style={{ marginBottom: 10 }}>
          <b style={{ fontSize: '.9rem' }}>Quick Daily Biometric Log</b>
          <SegmentedTabs items={TYPES.map(([id, label]) => ({ id, label }))} value={type} onChange={pick} label="Measurement type" />
        </div>
        <div className="bio-drawer-grid">
          <Field label="Date"><input type="date" value={form.d} max={T} onChange={set('d')} /></Field>
          {type === 'weight' && <>
            <Field label="Weight (kg)"><input inputMode="decimal" placeholder="75.3" value={form.kg} onChange={set('kg')} /></Field>
            <Field label="Body fat % (opt)"><input inputMode="decimal" placeholder="27.8" value={form.bf} onChange={set('bf')} /></Field>
            <Field label="Lean mass kg (opt)"><input inputMode="decimal" placeholder="55.4" value={form.lbm} onChange={set('lbm')} /></Field>
          </>}
          {type === 'bp' && <>
            <Field label="Systolic (mmHg)"><input inputMode="numeric" placeholder="119" value={form.sys} onChange={set('sys')} /></Field>
            <Field label="Diastolic (mmHg)"><input inputMode="numeric" placeholder="78" value={form.dia} onChange={set('dia')} /></Field>
            <Field label="Pulse bpm (opt)"><input inputMode="numeric" placeholder="60" value={form.pulse} onChange={set('pulse')} /></Field>
          </>}
          {type === 'glu' && <>
            <Field label="Glucose (mg/dL)"><input inputMode="numeric" placeholder="93" value={form.mgdl} onChange={set('mgdl')} /></Field>
            <Field label="Condition"><select value={form.ctx} onChange={set('ctx')}><option value="fasting">Fasting</option><option value="post">Post-meal</option><option value="random">Random</option></select></Field>
          </>}
          {type === 'lab' && <>
            <Field label="Test"><input value={form.name} onChange={set('name')} placeholder="e.g. HbA1c" /></Field>
            <Field label="Value"><input value={form.value} onChange={set('value')} placeholder="5.1" /></Field>
            <Field label="Unit"><input value={form.unit} onChange={set('unit')} placeholder="%" /></Field>
            <Field label="Ref (opt)"><input value={form.ref} onChange={set('ref')} placeholder="<5.7" /></Field>
          </>}
          <div style={{ display: 'flex', alignItems: 'flex-end' }}>
            <button type="button" className="btn primary full" onClick={add}>Save Entry</button>
          </div>
        </div>
        {err && <p className="err" role="alert" style={{ marginTop: 8 }}>{err}</p>}
      </div>}
    </div>

    {/* Top 4 Summary KPI Cards */}
    <div className="bio-kpis4">
      <div className="kpi">
        <div className="kpi-top"><small style={{ color: 'var(--cobalt-t)', fontWeight: 700, textTransform: 'uppercase' }}>1. Body Composition</small><Chip>n={B.weight.length}</Chip></div>
        <b>{w ? `${w.kg} kg` : '—'}<span className="u">{w ? ` · ${fmtShort(w.d)}` : ''}</span></b>
        <em>{w ? <>
          {w.bf != null ? `BF ${w.bf}%` : ''}{w.lbm != null ? ` · LBM ${w.lbm} kg` : ''}
          {leanest && leanest !== w ? ` · Leanest ${leanest.kg} kg (${fmtShort(leanest.d)})` : ''}
          {bestBf ? ` · Best BF ${bestBf.bf}%` : ''}
        </> : 'No weight entries yet'}</em>
      </div>

      <div className="kpi">
        <div className="kpi-top"><small style={{ color: 'var(--green-t)', fontWeight: 700, textTransform: 'uppercase' }}>2. Blood Pressure</small><Chip>n={B.bp.length}</Chip></div>
        <b>{bp ? `${bp.sys}/${bp.dia}` : '—'}<span className="u"> mmHg</span></b>
        <em>{bp ? <>{fmtShort(bp.d)} · <Chip tone={cBP.tone}>{cBP.label.split(' (')[0]}</Chip>{bp30.n > 1 ? ` · 30d ${bp30.mean}/${bpd30.mean}` : bpAvgSys ? ` · avg ${Math.round(bpAvgSys)}/${Math.round(bpAvgDia)}` : ''}</> : 'No BP entries yet'}</em>
      </div>

      <div className="kpi">
        <div className="kpi-top"><small style={{ color: 'var(--amber-t)', fontWeight: 700, textTransform: 'uppercase' }}>3. Glucose &amp; HbA1c</small><Chip>n={B.glu.length}</Chip></div>
        <b>{gl ? `${gl.mgdl}` : '—'}<span className="u"> mg/dL{hba1c ? ` · HbA1c ${hba1c.value}${hba1c.unit || '%'}` : ''}</span></b>
        <em>{gl ? <>{fmtShort(gl.d)} ({CTX[gl.ctx]}) · <Chip tone={cGl.tone}>{cGl.label.split(' (')[0]}</Chip>{gluAvg != null ? ` · avg ${Math.round(gluAvg)}` : ''}</> : 'No glucose entries yet'}</em>
      </div>

      <div className="kpi">
        <div className="kpi-top"><small style={{ color: 'var(--red-t)', fontWeight: 700, textTransform: 'uppercase' }}>4. VDOT &amp; Pace Impact</small><ProvenanceBadge tag="RULE" /></div>
        <b>{paceSecImpact > 0 ? `~${paceSecImpact} s/km` : w ? `${w.kg} kg` : '—'}<span className="u">{fmMinImpact ? ` (~${fmMinImpact}m FM)` : ''}</span></b>
        <em>{w ? <>
          {kgDeltaVsLeanest > 0 ? `+${kgDeltaVsLeanest} kg vs leanest (${leanest.kg} kg) · rule ±1 kg ≈ 2–3 s/km` : dW ? `${dW.kg > 0 ? '+' : ''}${dW.kg} kg vs ${fmtShort(dW.since)} · ±1 kg ≈ 2–3 s/km` : 'Rule of thumb: ±1 kg ≈ 2–3 s/km'}
          {' · '}<button className="link" onClick={() => setSettings({ ...settings, bodyMassKg: w.kg })}>Sync {w.kg} kg to Profile</button>
        </> : 'Log weight to estimate pace impact'}</em>
      </div>
    </div>

    {/* Section 1: Body Comp Trajectory (7) + Segmental Muscle vs Subcutaneous Fat (5) */}
    <div className="bio-split-75">
      <Card title="Body Composition Trajectory" right={wSorted.length > 1 && <Chip>{fmtShort(wSorted[0].d)} – {fmtShort(wSorted.at(-1).d)}</Chip>}>
        <BandLine data={series(B.weight, ['kg'])} keys={[{ key: 'kg', color: 'var(--c-long)' }]} height={165} label={`Body weight, ${B.weight.length} entries, latest ${w?.kg} kg`} />
        {B.weight.some((e) => e.bf != null) && <>
          <p className="mini" style={{ marginTop: 10 }}>Body fat (%)</p>
          <BandLine data={series(B.weight.filter((e) => e.bf != null), ['bf'])} keys={[{ key: 'bf', color: 'var(--c-quality)' }]} height={105} label="Body fat percent" />
        </>}
      </Card>

      <Card title="Segmental Analysis: Muscle vs. Subcutaneous Fat" right={bc1 && <Chip>{fmtShort(bc1.d)}</Chip>}>
        {bc1 ? <>
          <div className="score-grid" style={{ marginBottom: 10 }}>
            <div><small>Body fat</small><b>{bc1.bf ?? '—'}%</b><em>{bc0 !== bc1 && bc0.bf != null && bc1.bf != null ? `${bc1.bf - bc0.bf > 0 ? '+' : ''}${(bc1.bf - bc0.bf).toFixed(1)}% vs ${fmtShort(bc0.d)}` : 'latest'}</em></div>
            <div><small>Lean mass</small><b>{bc1.lbm ?? '—'}</b><em>kg</em></div>
            <div><small>Visceral fat</small><b>{bc1.bc.visc ?? '—'}</b><em>rating</em></div>
          </div>
          {segRows.length > 0 && <div className="scroll" tabIndex={0}><table className="lapt">
            <thead><tr><th>Segment</th><th>Skeletal Muscle</th><th>Subcutaneous Fat</th></tr></thead>
            <tbody>{segRows.map(([seg, mus, sub]) => <tr key={seg}>
              <td><b>{seg}</b></td>
              <td>{mus != null ? `${r1(mus)}%` : '—'}</td>
              <td>{sub != null ? `${r1(sub)}%` : '—'}</td>
            </tr>)}</tbody>
          </table></div>}
          <p className="src-note">{bcs.length} body-comp scale readings ({fmtShort(bc0.d)} – {fmtShort(bc1.d)}).</p>
        </> : <p className="muted">No segmental scale readings yet. Import your Health Dictionary (.xlsx) to populate Whole Body / Trunk / Arms / Legs skeletal muscle and subcutaneous fat.</p>}
      </Card>
    </div>

    {/* Section 2: Blood Pressure (6) + Blood Glucose (6) */}
    <div className="rgrid">
      <Card title="Blood Pressure Monitoring" right={<Chip>mmHg</Chip>}>
        <BandLine data={series(B.bp, ['sys', 'dia'])} keys={[{ key: 'sys', color: 'var(--red)' }, { key: 'dia', color: 'var(--c-long)' }]} height={155} label={`Blood pressure, ${B.bp.length} entries, latest ${bp?.sys}/${bp?.dia}`} />
        <div className="legend"><span><i className="ll" style={{ borderColor: 'var(--red)' }} />Systolic</span><span><i className="ll" style={{ borderColor: 'var(--c-long)' }} />Diastolic</span></div>
        <div className="score-grid" style={{ marginTop: 10 }}>
          <div><small>Latest</small><b>{bp ? `${bp.sys}/${bp.dia}` : '—'}</b><em>{bp ? fmtShort(bp.d) : '—'}</em></div>
          <div><small>30-day mean</small><b>{bp30.n ? `${bp30.mean}/${bpd30.mean}` : '—'}</b><em>n={bp30.n}</em></div>
          <div><small>All-time mean</small><b>{bpAvgSys ? `${Math.round(bpAvgSys)}/${Math.round(bpAvgDia)}` : '—'}</b><em>n={bpSorted.length}</em></div>
        </div>
      </Card>

      <Card title="Blood Glucose Monitoring" right={<Chip>mg/dL</Chip>}>
        <BandLine data={series(B.glu, ['mgdl'])} keys={[{ key: 'mgdl', color: 'var(--c-quality)' }]} refBand={[70, 99]} height={155} label={`Glucose, ${B.glu.length} entries, latest ${gl?.mgdl} mg/dL; band 70–99 = normal fasting`} />
        <p className="src-note">Shaded band = normal fasting range 70–99 mg/dL (ADA reference).</p>
        <div className="score-grid" style={{ marginTop: 10 }}>
          <div><small>Latest</small><b>{gl ? `${gl.mgdl}` : '—'}</b><em>{gl ? `${fmtShort(gl.d)} · ${CTX[gl.ctx]}` : '—'}</em></div>
          <div><small>{gluFasting.length ? 'Fasting mean' : 'Mean'}</small><b>{gluAvg != null ? Math.round(gluAvg) : '—'}</b><em>mg/dL</em></div>
          <div><small>Range</small><b>{gluMin != null ? `${gluMin}–${gluMax}` : '—'}</b><em>n={gluSorted.length}</em></div>
        </div>
      </Card>
    </div>

    {/* Section 3: Clinical MCU Lab Panel (5) + Complete Biometric Logs (7) */}
    <div className="bio-split-57">
      <div>
        <Card title={`Clinical MCU Lab Panel${mcu?.clinic ? ` (${mcu.clinic})` : ''}`} right={mcu && <Chip tone={/good|baik|normal/i.test(mcu.result) ? 'green' : 'yellow'}>{mcu.result || 'MCU'}</Chip>}>
          {mcu ? <>
            <p className="muted" style={{ marginTop: 0 }}>{fmtShort(mcu.d)} · {mcu.clinic}{mcu.doctor ? ` · ${mcu.doctor}` : ''}</p>
            <dl className="kv">{[['Chest X-ray', mcu.thorax], ['Resting ECG', mcu.ecg], ['Main finding', mcu.finding], ['Doctor’s advice', mcu.advice]].filter(([, v]) => v).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
          </> : <p className="muted">No medical check-up summary imported yet.</p>}
          {B.lab.length > 0 && <div className="mcu-lab-grid" style={{ marginTop: 10 }}>
            {[...B.lab].reverse().slice(0, 8).map((l, i) => <div key={i} className={`mcu-lab-item ${l.flag === 'high' ? 'flag-hi' : l.flag === 'low' ? 'flag-lo' : ''}`}>
              <small>{l.name}</small>
              <b>{l.value}{l.unit ? ` ${l.unit}` : ''}{l.flag === 'high' ? ' ▲' : l.flag === 'low' ? ' ▼' : ''}</b>
              <em>{l.ref ? `ref ${l.ref}` : l.d}</em>
            </div>)}
          </div>}
        </Card>

        {sl.length > 0 && <Card title="Sleep &amp; HRV Log (Imported)" right={<Chip>{sl.length} nights</Chip>}>
          <div className="score-grid">
            <div><small>Avg sleep</small><b>{hm(slAvg('sleep'))}</b><em>deep {hm(slAvg('deep'))} · REM {hm(slAvg('rem'))}</em></div>
            <div><small>Sleep HR</small><b>{slAvg('hr') != null ? `${Math.round(slAvg('hr'))} bpm` : '—'}</b><em>HRV {slAvg('hrv') != null ? `${Math.round(slAvg('hrv'))} ms` : '—'}</em></div>
          </div>
          <p className="src-note">{fmtShort(sl[0].d)} – {fmtShort(sl.at(-1).d)} · {['Great', 'Good', 'Fair', 'Low'].map((q) => `${q} ${sl.filter((e) => e.q === q).length}`).join(' · ')}.</p>
        </Card>}
      </div>

      <Card title="Complete Biometric Measurement Logs" right={<span className="muted">{total} total</span>}>
        <SegmentedTabs items={logTabs} value={logTab} onChange={setLogTab} label="Log category" />
        {!activeLogs.length ? <p className="muted" style={{ marginTop: 10 }}>No entries in this category yet. Use “+ Log New Measurement” or import your Health Dictionary (.xlsx).</p> : (
          <div className="scroll" style={{ maxHeight: 420, marginTop: 10 }} tabIndex={0}>
            <table className="lapt">
              <thead>
                <tr>
                  <th>Date</th>
                  {logTab === 'weight' && <><th>Weight</th><th>BF %</th><th>LBM</th></>}
                  {logTab === 'bp' && <><th>Sys/Dia</th><th>Pulse</th><th>Category</th></>}
                  {logTab === 'glu' && <><th>mg/dL</th><th>Context</th><th>Category</th></>}
                  {logTab === 'lab' && <><th>Test</th><th>Value</th><th>Ref</th></>}
                  <th style={{ width: 44 }}></th>
                </tr>
              </thead>
              <tbody>
                {activeLogs.map(({ e, i }) => {
                  const bpC = logTab === 'bp' ? classifyBP(e.sys, e.dia) : null
                  const glC = logTab === 'glu' ? classifyGlucose(e.mgdl, e.ctx) : null
                  return <tr key={logTab + i}>
                    <td className="mono">{e.d}</td>
                    {logTab === 'weight' && <><td><b>{e.kg} kg</b></td><td>{e.bf != null ? `${e.bf}%` : '—'}</td><td>{e.lbm != null ? `${e.lbm} kg` : '—'}</td></>}
                    {logTab === 'bp' && <><td><b>{e.sys}/{e.dia}</b></td><td>{e.pulse ?? '—'}</td><td>{bpC && <Chip tone={bpC.tone}>{bpC.label.split(' (')[0]}</Chip>}</td></>}
                    {logTab === 'glu' && <><td><b>{e.mgdl}</b></td><td>{CTX[e.ctx]}</td><td>{glC && <Chip tone={glC.tone}>{glC.label.split(' (')[0]}</Chip>}</td></>}
                    {logTab === 'lab' && <><td><b>{e.name}</b></td><td>{e.value}{e.unit ? ` ${e.unit}` : ''}{e.flag === 'high' ? ' ▲' : e.flag === 'low' ? ' ▼' : ''}</td><td className="muted">{e.ref || '—'}</td></>}
                    <td><button className="iconbtn" onClick={() => del(logTab, i)} aria-label={`Delete entry ${e.d}`}><Icon n="x" size={16} /></button></td>
                  </tr>
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  </div>
}
