import { useState } from 'react'
import { useStore } from './store.js'
import { EMPTY_BIO, validate, classifyBP, classifyGlucose, byDate, latest, windowMean, weightChange } from './lib/bio.js'
import { today, fmtShort } from './lib/calendar.js'
import { Card, Chip, Screen, Icon } from './ui.jsx'
import { BandLine } from './charts2.jsx'

const TYPES = [['weight', 'Berat & komposisi'], ['bp', 'Tekanan darah'], ['glu', 'Glukosa'], ['lab', 'Panel lab']]
const CTX = { fasting: 'puasa', post: 'setelah makan', random: 'acak' }
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

  return <Screen title="Biometrics" sub="Berat, tekanan darah, glukosa, dan panel lab">
    <div className="card bio-intro"><b>Catatan kesehatan pribadi</b><p className="muted">Disimpan di server-mu (database KV), bukan di repositori. Klasifikasi memakai rentang acuan umum dan hanya informasi, bukan diagnosis — hasil tidak normal selalu dikonfirmasi ke dokter.</p></div>

    <div className="bgrid">
      <div className="bmain">
        <div className="bio-kpis">
          <div className="kpi"><small>Berat</small><b>{w ? `${w.kg} kg` : '—'}</b><em>{w ? `${fmtShort(w.d)}${w.bf ? ` · BF ${w.bf}%` : ''}${dW ? ` · ${dW.kg > 0 ? '+' : ''}${dW.kg} kg vs ${fmtShort(dW.since)}` : ''}` : 'belum ada catatan'}</em></div>
          <div className="kpi"><small>Tekanan darah</small><b>{bp ? `${bp.sys}/${bp.dia}` : '—'}</b><em>{bp ? <>{fmtShort(bp.d)} · <Chip tone={cBP.tone}>{cBP.label.split(' (')[0]}</Chip></> : 'belum ada catatan'}</em>{bp30.n > 1 && <em>rata-rata 30 hr {bp30.mean}/{bpd30.mean} (n={bp30.n})</em>}</div>
          <div className="kpi"><small>Glukosa</small><b>{gl ? `${gl.mgdl}` : '—'}<span className="u"> mg/dL</span></b><em>{gl ? <>{fmtShort(gl.d)} · {CTX[gl.ctx]} · <Chip tone={cGl.tone}>{cGl.label.split(' (')[0]}</Chip></> : 'belum ada catatan'}</em></div>
          <div className="kpi"><small>Panel lab</small><b>{B.lab.length || '—'}</b><em>{labsLast ? `terakhir ${fmtShort(labsLast.d)}` : 'belum ada catatan'}</em></div>
        </div>

        <div className="seg3 wrap" role="group" aria-label="Grafik">{[['weight', 'Berat'], ['bp', 'BP'], ['glu', 'Glukosa']].map(([k, l]) => <button key={k} aria-pressed={view === k} onClick={() => setView(k)}>{l}</button>)}</div>
        {view === 'weight' && <Card title="Tren berat dan lemak tubuh">
          <BandLine data={series(B.weight, ['kg'])} keys={[{ key: 'kg', color: 'var(--c-long)' }]} height={150} label={`Berat badan ${B.weight.length} catatan, terakhir ${w?.kg} kg`} />
          {B.weight.some((e) => e.bf != null) && <><p className="mini">Lemak tubuh (%)</p><BandLine data={series(B.weight.filter((e) => e.bf != null), ['bf'])} keys={[{ key: 'bf', color: 'var(--c-quality)' }]} height={110} label="Lemak tubuh persen" /></>}
          {w && <p className="muted">Aturan praktis yang sering dikutip: ±1 kg massa tubuh ≈ 2–3 detik/km pada jarak maraton — bukan prediksi. <button className="link" onClick={() => setSettings({ ...settings, bodyMassKg: w.kg })}>Pakai {w.kg} kg di Profil (carb-loading)</button></p>}
        </Card>}
        {view === 'bp' && <Card title="Tren tekanan darah" right={<Chip>mmHg</Chip>}>
          <BandLine data={series(B.bp, ['sys', 'dia'])} keys={[{ key: 'sys', color: 'var(--red)' }, { key: 'dia', color: 'var(--c-long)' }]} height={150} label={`Tekanan darah ${B.bp.length} catatan, terakhir ${bp?.sys}/${bp?.dia}`} />
          <div className="legend"><span><i className="ll" style={{ borderColor: 'var(--red)' }} />Sistolik</span><span><i className="ll" style={{ borderColor: 'var(--c-long)' }} />Diastolik</span></div>
        </Card>}
        {view === 'glu' && <Card title="Tren glukosa" right={<Chip>mg/dL</Chip>}>
          <BandLine data={series(B.glu, ['mgdl'])} keys={[{ key: 'mgdl', color: 'var(--c-quality)' }]} refBand={[70, 99]} height={150} label={`Glukosa ${B.glu.length} catatan, terakhir ${gl?.mgdl} mg/dL; pita 70–99 = rentang puasa normal`} />
          <p className="muted">Pita = rentang puasa normal 70–99 mg/dL (acuan ADA). Pengukuran setelah makan dan acak punya ambang berbeda.</p>
        </Card>}

        <Card title="Riwayat" right={<span className="muted">{total} catatan</span>}>
          <div className="seg3 wrap" role="group" aria-label="Jenis riwayat">{TYPES.map(([k, l]) => <button key={k} aria-pressed={type === k} onClick={() => pick(k)}>{l} ({B[k].length})</button>)}</div>
          {!B[type].length && <p className="muted">Belum ada catatan. Tambahkan lewat formulir.</p>}
          <ul className="logs">{[...B[type]].map((e, i) => ({ e, i })).reverse().map(({ e, i }) => <li key={type + i}>
            <span><b>{type === 'weight' ? `${e.kg} kg${e.bf ? ` · BF ${e.bf}%` : ''}${e.lbm ? ` · LBM ${e.lbm}` : ''}` : type === 'bp' ? `${e.sys}/${e.dia}${e.pulse ? ` · ${e.pulse} bpm` : ''}` : type === 'glu' ? `${e.mgdl} mg/dL · ${CTX[e.ctx]}` : `${e.name}: ${e.value}${e.unit ? ' ' + e.unit : ''}`}</b><small>{e.d}{type === 'lab' && e.ref ? ` · acuan ${e.ref}` : ''}</small></span>
            <button className="iconbtn" onClick={() => del(type, i)} aria-label={`Hapus catatan ${e.d}`}><Icon n="x" size={18} /></button></li>)}</ul>
        </Card>
      </div>

      <div className="bside">
        <Card title="Catat pengukuran">
          <div className="seg3 wrap" role="group" aria-label="Jenis pengukuran">{TYPES.map(([k, l]) => <button key={k} aria-pressed={type === k} onClick={() => pick(k)}>{l}</button>)}</div>
          <div className="form">
            <Field label="Tanggal"><input type="date" value={form.d} max={T} onChange={set('d')} /></Field>
            {type === 'weight' && <><Field label="Berat (kg)"><input inputMode="decimal" value={form.kg} onChange={set('kg')} /></Field><Field label="Lemak tubuh % (opsional)"><input inputMode="decimal" value={form.bf} onChange={set('bf')} /></Field><Field label="Massa tanpa lemak kg (opsional)"><input inputMode="decimal" value={form.lbm} onChange={set('lbm')} /></Field></>}
            {type === 'bp' && <><Field label="Sistolik"><input inputMode="numeric" value={form.sys} onChange={set('sys')} /></Field><Field label="Diastolik"><input inputMode="numeric" value={form.dia} onChange={set('dia')} /></Field><Field label="Nadi (opsional)"><input inputMode="numeric" value={form.pulse} onChange={set('pulse')} /></Field></>}
            {type === 'glu' && <><Field label="Glukosa (mg/dL)"><input inputMode="numeric" value={form.mgdl} onChange={set('mgdl')} /></Field><Field label="Kondisi"><select value={form.ctx} onChange={set('ctx')}><option value="fasting">Puasa</option><option value="post">Setelah makan</option><option value="random">Acak</option></select></Field></>}
            {type === 'lab' && <><Field label="Pemeriksaan"><input value={form.name} onChange={set('name')} placeholder="mis. HbA1c" /></Field><Field label="Nilai"><input value={form.value} onChange={set('value')} /></Field><Field label="Satuan"><input value={form.unit} onChange={set('unit')} /></Field><Field label="Acuan (opsional)"><input value={form.ref} onChange={set('ref')} placeholder="mis. <5.7" /></Field></>}
          </div>
          {err && <p className="err" role="alert">{err}</p>}
          <button className="btn primary full" onClick={add}>Simpan</button>
        </Card>
      </div>
    </div>
  </Screen>
}
