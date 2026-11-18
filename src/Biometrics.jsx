import { useState } from 'react'
import { useStore } from './store.js'
import { EMPTY_BIO, validate, classifyBP, classifyGlucose, byDate, latest, windowMean, weightChange } from './lib/bio.js'
import { today, fmtShort } from './lib/calendar.js'
import { Card, Chip, Screen, Icon } from './ui.jsx'
import { BandLine } from './charts2.jsx'

const TYPES = [['weight', 'Weight & composition'], ['bp', 'Blood pressure'], ['glu', 'Glucose'], ['lab', 'Lab panel']]
const CTX = { fasting: 'fasting', post: 'post-meal', random: 'random' }
const BLANK = { weight: { kg: '', bf: '', lbm: '' }, bp: { sys: '', dia: '', pulse: '' }, glu: { mgdl: '', ctx: 'fasting' }, lab: { name: '', value: '', unit: '', ref: '' } }
const Field = ({ label, children }) => <label className="fld"><span>{label}</span>{children}</label>

// Weight / composition, blood pressure, glucose and lab values. Logs live in the synced store (server KV) — not in the repository.
export default function Biometrics({ settings, setSettings }) {
  const T = today(), [bio, setBio] = useStore('lumpad.bio', EMPTY_BIO), B = { ...EMPTY_BIO, ...bio }
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
  const total = B.weight.length + B.bp.length + B.glu.length + B.lab.length

  return <Screen title="Biometrics" sub="Weight, blood pressure, glucose and lab panel">
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

        <Card title="History" right={<span className="muted">{total} entries</span>}>
          <div className="seg3 wrap" role="group" aria-label="History type">{TYPES.map(([k, l]) => <button key={k} aria-pressed={type === k} onClick={() => pick(k)}>{l} ({B[k].length})</button>)}</div>
          {!B[type].length && <p className="muted">No entries yet. Add one with the form.</p>}
          <ul className="logs">{[...B[type]].map((e, i) => ({ e, i })).reverse().map(({ e, i }) => <li key={type + i}>
            <span><b>{type === 'weight' ? `${e.kg} kg${e.bf ? ` · BF ${e.bf}%` : ''}${e.lbm ? ` · LBM ${e.lbm}` : ''}` : type === 'bp' ? `${e.sys}/${e.dia}${e.pulse ? ` · ${e.pulse} bpm` : ''}` : type === 'glu' ? `${e.mgdl} mg/dL · ${CTX[e.ctx]}` : `${e.name}: ${e.value}${e.unit ? ' ' + e.unit : ''}`}</b><small>{e.d}{type === 'lab' && e.ref ? ` · ref ${e.ref}` : ''}</small></span>
            <button className="iconbtn" onClick={() => del(type, i)} aria-label={`Delete entry ${e.d}`}><Icon n="x" size={18} /></button></li>)}</ul>
        </Card>
      </div>

      <div className="bside">
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
