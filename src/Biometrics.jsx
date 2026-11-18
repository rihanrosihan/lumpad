import { useState } from 'react'
import { useStore } from './store.js'
import { EMPTY_BIO, validate, classifyBP, classifyGlucose, byDate, latest, windowMean, weightChange } from './lib/bio.js'
import { today, fmtShort } from './lib/calendar.js'
import { Card, Chip, Screen, Icon } from './ui.jsx'
import { BandLine } from './charts2.jsx'
import { parseHealth, mergeHealth } from './lib/healthimport.js'

const TYPES = [['weight', 'Weight & composition'], ['bp', 'Blood pressure'], ['glu', 'Glucose'], ['lab', 'Lab panel']]
const CTX = { fasting: 'fasting', post: 'post-meal', random: 'random' }
const BLANK = { weight: { kg: '', bf: '', lbm: '' }, bp: { sys: '', dia: '', pulse: '' }, glu: { mgdl: '', ctx: 'fasting' }, lab: { name: '', value: '', unit: '', ref: '' } }
const Field = ({ label, children }) => <label className="fld"><span>{label}</span>{children}</label>

// Weight / composition, blood pressure, glucose and lab values. Logs live in the synced store (server KV) — not in the repository.
export default function Biometrics({ settings, setSettings }) {
  const T = today(), [bio, setBio] = useStore('lumpad.bio', EMPTY_BIO), B = { ...EMPTY_BIO, ...bio }
  const [sleepLog, setSleepLog] = useStore('lumpad.sleeplog', []), [mcuLog, setMcuLog] = useStore('lumpad.mcu', []), [imp, setImp] = useState(null)
  const [type, setType] = useState('weight'), [form, setForm] = useState({ d: T, ...BLANK.weight }), [err, setErr] = useState(''), [view, setView] = useState('weight')
  const pick = (t) => { setType(t); setForm({ d: T, ...BLANK[t] }); setErr('') }
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })
  const add = () => {
    const r = validate(type, form); if (!r.ok) return setErr(r.error)
    setErr(''); setBio({ ...B, [type]: byDate([...B[type], r.entry]) }); setForm({ d: form.d, ...BLANK[type] })
  }
  const del = (t, i) => setBio({ ...B, [t]: B[t].filter((_, j) => j !== i) })
  const w = latest(B.weight), bp = latest(B.bp), gl = latest(B.glu), cBP = bp && classifyBP(bp.sys, bp.dia), cGl = gl && classifyGlucose(gl.mgdl, gl.ctx)
  const dW = weightChange(B.weight, 90), bp30 = windowMean(B.bp, 'sys', T, 30), bpd30 = windowMean(B.bp, 'dia', T, 30), labsLast = latest(B.lab)
  const series = (arr, ks) => byDate(arr).map((e) => ({ date: e.d, ...Object.fromEntries(ks.map((k) => [k, e[k]])) }))
  const onFile = async (e) => {
    const f = e.target.files?.[0]; e.target.value = ''; if (!f) return
    try { const { readXlsx } = await import('./lib/xlsx.js'), H = parseHealth(readXlsx(new Uint8Array(await f.arrayBuffer()))), M = mergeHealth(B, sleepLog, mcuLog, H); setImp({ name: f.name, found: { weight: H.weight.length, bp: H.bp.length, glu: H.glu.length, lab: H.lab.length, sleep: H.sleep.length, mcu: H.mcu ? 1 : 0 }, M, notes: H.notes }) }
    catch (x) { setImp({ error: String(x.message || x) }) }
  }
  const apply = () => { setBio(imp.M.bio); setSleepLog(imp.M.sleep); setMcuLog(imp.M.mcu); setImp({ done: imp.M.added, name: imp.name }) }
  const bcs = byDate(B.weight.filter((e) => e.bc)), bc0 = bcs[0], bc1 = bcs.at(-1), mcu = byDate(mcuLog || []).at(-1)
  const sl = byDate(sleepLog || []), slAvg = (k) => { const v = sl.map((e) => e[k]).filter((x) => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null }, hm = (m) => (m == null ? '—' : `${Math.floor(m / 60)}h ${String(Math.round(m % 60)).padStart(2, '0')}m`)
  const total = B.weight.length + B.bp.length + B.glu.length + B.lab.length

  return <Screen title="Body Composition, Blood Pressure & Glucose" sub="Weight, blood pressure, glucose, medical check-up and sleep & HRV — logged and imported from the Health Dictionary">
    <div className="card bio-intro"><b>Personal health log</b><p className="muted">Stored on your server (KV database), not in the repository. Classifications use general reference ranges and are information only, not diagnosis — abnormal results should always be confirmed with a doctor.</p></div>

    <div className="bgrid">
      <div className="bmain">
        <div className="bio-kpis">
          <div className="kpi"><small>Weight</small><b>{w ? `${w.kg} kg` : '—'}</b><em>{w ? `${fmtShort(w.d)}${w.bf ? ` · BF ${w.bf}%` : ''}${dW ? ` · ${dW.kg > 0 ? '+' : ''}${dW.kg} kg vs ${fmtShort(dW.since)}` : ''}` : 'no entries yet'}</em></div>
          <div className="kpi"><small>Blood pressure</small><b>{bp ? `${bp.sys}/${bp.dia}` : '—'}</b><em>{bp ? <>{fmtShort(bp.d)} · <Chip tone={cBP.tone}>{cBP.label.split(' (')[0]}</Chip></> : 'no entries yet'}</em>{bp30.n > 1 && <em>30-day mean {bp30.mean}/{bpd30.mean} (n={bp30.n})</em>}</div>
          <div className="kpi"><small>Glucose</small><b>{gl ? `${gl.mgdl}` : '—'}<span className="u"> mg/dL</span></b><em>{gl ? <>{fmtShort(gl.d)} · {CTX[gl.ctx]} · <Chip tone={cGl.tone}>{cGl.label.split(' (')[0]}</Chip></> : 'no entries yet'}</em></div>
          <div className="kpi"><small>Lab panel</small><b>{B.lab.length || '—'}</b><em>{labsLast ? `last ${fmtShort(labsLast.d)}` : 'no entries yet'}</em></div>
        </div>

        <div className="seg3 wrap" role="group" aria-label="Chart">{[['weight', 'Weight'], ['bp', 'BP'], ['glu', 'Glucose']].map(([k, l]) => <button key={k} aria-pressed={view === k} onClick={() => setView(k)}>{l}</button>)}</div>
        {view === 'weight' && <Card title="Weight and body-fat trend">
          <BandLine data={series(B.weight, ['kg'])} keys={[{ key: 'kg', color: 'var(--c-long)' }]} height={150} label={`Body weight, ${B.weight.length} entries, latest ${w?.kg} kg`} />
          {B.weight.some((e) => e.bf != null) && <><p className="mini">Body fat (%)</p><BandLine data={series(B.weight.filter((e) => e.bf != null), ['bf'])} keys={[{ key: 'bf', color: 'var(--c-quality)' }]} height={110} label="Body fat percent" /></>}
          {w && <p className="muted">A commonly quoted rule of thumb: ±1 kg of body mass ≈ 2–3 s/km at marathon distance — not a prediction. <button className="link" onClick={() => setSettings({ ...settings, bodyMassKg: w.kg })}>Use {w.kg} kg in Profile (carb-loading)</button></p>}
        </Card>}
        {view === 'bp' && <Card title="Blood-pressure trend" right={<Chip>mmHg</Chip>}>
          <BandLine data={series(B.bp, ['sys', 'dia'])} keys={[{ key: 'sys', color: 'var(--red)' }, { key: 'dia', color: 'var(--c-long)' }]} height={150} label={`Blood pressure, ${B.bp.length} entries, latest ${bp?.sys}/${bp?.dia}`} />
          <div className="legend"><span><i className="ll" style={{ borderColor: 'var(--red)' }} />Systolic</span><span><i className="ll" style={{ borderColor: 'var(--c-long)' }} />Diastolic</span></div>
        </Card>}
        {view === 'glu' && <Card title="Glucose trend" right={<Chip>mg/dL</Chip>}>
          <BandLine data={series(B.glu, ['mgdl'])} keys={[{ key: 'mgdl', color: 'var(--c-quality)' }]} refBand={[70, 99]} height={150} label={`Glucose, ${B.glu.length} entries, latest ${gl?.mgdl} mg/dL; band 70–99 = normal fasting range`} />
          <p className="muted">Band = normal fasting range 70–99 mg/dL (ADA reference). Post-meal and random readings have different thresholds.</p>
        </Card>}

        {bc1 && <Card title="Body composition" right={<Chip>{fmtShort(bc1.d)}</Chip>}>
          <div className="score-grid"><div><small>Body fat</small><b>{bc1.bf ?? '—'}</b><em>%{bc0 !== bc1 && bc0.bf != null && bc1.bf != null ? ` (${(bc1.bf - bc0.bf > 0 ? '+' : '') + (bc1.bf - bc0.bf).toFixed(1)} since ${fmtShort(bc0.d)})` : ''}</em></div><div><small>Muscle (whole body)</small><b>{bc1.bc.mus ?? '—'}</b><em>%</em></div><div><small>Visceral fat</small><b>{bc1.bc.visc ?? '—'}</b><em>rating</em></div>
            <div><small>Lean mass</small><b>{bc1.lbm ?? '—'}</b><em>kg</em></div><div><small>Subcutaneous fat</small><b>{bc1.bc.sub ?? '—'}</b><em>%</em></div><div><small>Muscle · legs</small><b>{bc1.bc.musLegs ?? '—'}</b><em>%</em></div></div>
          <p className="muted">{bcs.length} scale readings from {fmtShort(bc0.d)} to {fmtShort(bc1.d)}. Segment values (trunk / arms / legs) are in the history.</p>
        </Card>}
        {mcu && <Card title="Medical check-up" right={<Chip tone={/good/i.test(mcu.result) ? 'green' : 'yellow'}>{mcu.result || 'result'}</Chip>}>
          <p className="muted">{fmtShort(mcu.d)} · {mcu.clinic}{mcu.doctor ? ` · ${mcu.doctor}` : ''}</p>
          <dl className="kv">{[['Chest X-ray', mcu.thorax], ['Resting ECG', mcu.ecg], ['Main finding', mcu.finding], ['Doctor’s advice', mcu.advice]].filter(([, v]) => v).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
          <p className="muted">Lab values from this check-up are in the history (Lab panel); ▲ = above the reference range. A general log, not medical advice.</p>
        </Card>}
        {sl.length > 0 && <Card title="Sleep &amp; HRV log (imported)" right={<span className="muted">{sl.length} nights</span>}>
          <p className="muted">{fmtShort(sl[0].d)} – {fmtShort(sl.at(-1).d)} · average sleep {hm(slAvg('sleep'))} · deep {hm(slAvg('deep'))} · REM {hm(slAvg('rem'))} · sleep HR {slAvg('hr') != null ? Math.round(slAvg('hr')) : '—'} bpm · HRV {slAvg('hrv') != null ? Math.round(slAvg('hrv')) : '—'} ms</p>
          <p className="muted">Sleep quality: {['Great', 'Good', 'Fair', 'Low'].map((q) => `${q} ${sl.filter((e) => e.q === q).length}`).join(' · ')}. The live sleep and HRV come from COROS; this log keeps the earlier nights and the quality labels.</p>
        </Card>}
        <Card title="History" right={<span className="muted">{total} entries</span>}>
          <div className="seg3 wrap" role="group" aria-label="History type">{TYPES.map(([k, l]) => <button key={k} aria-pressed={type === k} onClick={() => pick(k)}>{l} ({B[k].length})</button>)}</div>
          {!B[type].length && <p className="muted">No entries yet. Add one with the form.</p>}
          <ul className="logs">{[...B[type]].map((e, i) => ({ e, i })).reverse().map(({ e, i }) => <li key={type + i}>
            <span><b>{type === 'weight' ? `${e.kg} kg${e.bf ? ` · BF ${e.bf}%` : ''}${e.lbm ? ` · LBM ${e.lbm}` : ''}` : type === 'bp' ? `${e.sys}/${e.dia}${e.pulse ? ` · ${e.pulse} bpm` : ''}` : type === 'glu' ? `${e.mgdl} mg/dL · ${CTX[e.ctx]}` : `${e.name}: ${e.value}${e.unit ? ' ' + e.unit : ''}${e.flag === 'high' ? ' ▲' : e.flag === 'low' ? ' ▼' : ''}`}</b><small>{e.d}{type === 'lab' && e.ref ? ` · ref ${e.ref}` : ''}</small></span>
            <button className="iconbtn" onClick={() => del(type, i)} aria-label={`Delete entry ${e.d}`}><Icon n="x" size={18} /></button></li>)}</ul>
        </Card>
      </div>

      <div className="bside">
        <Card title="Import from a spreadsheet">
          <p className="muted">Upload the Health Dictionary workbook (.xlsx): sleep &amp; HRV, body composition, blood pressure, glucose, medical check-up. It is read in your browser and saved to your server; names, addresses and record numbers are not imported. Importing twice never duplicates entries.</p>
          <label className="btn sm full" style={{ cursor: 'pointer', textAlign: 'center' }}>Choose .xlsx file<input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={onFile} style={{ position: 'absolute', opacity: 0, width: 1, height: 1 }} /></label>
          {imp?.error && <p className="err" role="alert">{imp.error}</p>}
          {imp?.M && <div role="status"><p><b>{imp.name}</b> contains {imp.found.weight} weight / composition, {imp.found.bp} BP, {imp.found.glu} glucose, {imp.found.lab} lab values, {imp.found.sleep} nights of sleep &amp; HRV{imp.found.mcu ? ' and a medical check-up' : ''}.</p>
            <p className="muted">New to your log: {imp.M.added.weight} weight, {imp.M.added.bp} BP, {imp.M.added.glu} glucose, {imp.M.added.lab} lab, {imp.M.added.sleep} sleep nights{imp.M.added.mcu ? ', 1 check-up' : ''}.</p>
            {imp.notes.map((n) => <p key={n} className="muted">{n}</p>)}
            {Object.values(imp.M.added).some((n) => n > 0) ? <button className="btn primary full" onClick={apply}>Import {Object.values(imp.M.added).reduce((a, b) => a + b, 0)} new entries</button> : <p><Chip tone="green">up to date</Chip> everything in this file is already in your log.</p>}</div>}
          {imp?.done && <p role="status"><Chip tone="green">imported</Chip> {Object.values(imp.done).reduce((a, b) => a + b, 0)} new entries saved ({imp.done.weight} weight, {imp.done.bp} BP, {imp.done.glu} glucose, {imp.done.lab} lab, {imp.done.sleep} sleep).</p>}
        </Card>
        <Card title="Log a measurement">
          <div className="seg3 wrap" role="group" aria-label="Measurement type">{TYPES.map(([k, l]) => <button key={k} aria-pressed={type === k} onClick={() => pick(k)}>{l}</button>)}</div>
          <div className="form">
            <Field label="Date"><input type="date" value={form.d} max={T} onChange={set('d')} /></Field>
            {type === 'weight' && <><Field label="Weight (kg)"><input inputMode="decimal" value={form.kg} onChange={set('kg')} /></Field><Field label="Body fat % (optional)"><input inputMode="decimal" value={form.bf} onChange={set('bf')} /></Field><Field label="Lean mass kg (optional)"><input inputMode="decimal" value={form.lbm} onChange={set('lbm')} /></Field></>}
            {type === 'bp' && <><Field label="Systolic"><input inputMode="numeric" value={form.sys} onChange={set('sys')} /></Field><Field label="Diastolic"><input inputMode="numeric" value={form.dia} onChange={set('dia')} /></Field><Field label="Pulse (optional)"><input inputMode="numeric" value={form.pulse} onChange={set('pulse')} /></Field></>}
            {type === 'glu' && <><Field label="Glucose (mg/dL)"><input inputMode="numeric" value={form.mgdl} onChange={set('mgdl')} /></Field><Field label="Condition"><select value={form.ctx} onChange={set('ctx')}><option value="fasting">Fasting</option><option value="post">Post-meal</option><option value="random">Random</option></select></Field></>}
            {type === 'lab' && <><Field label="Test"><input value={form.name} onChange={set('name')} placeholder="e.g. HbA1c" /></Field><Field label="Value"><input value={form.value} onChange={set('value')} /></Field><Field label="Unit"><input value={form.unit} onChange={set('unit')} /></Field><Field label="Reference (optional)"><input value={form.ref} onChange={set('ref')} placeholder="e.g. <5.7" /></Field></>}
          </div>
          {err && <p className="err" role="alert">{err}</p>}
          <button className="btn primary full" onClick={add}>Save</button>
        </Card>
      </div>
    </div>
  </Screen>
}
