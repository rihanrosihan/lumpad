import { useEffect, useRef, useState } from 'react'
import { useStore } from './store.js'
import { evaluate, weeklyGate, EMPTY_DAY, hasInput } from './lib/gate.js'
import { paces, fmtPace } from './lib/vdot.js'
import { BY_DATE, today, addDays, fmtLong, KIND, dow } from './lib/calendar.js'
import { Card, Chip, Screen, Icon, StrengthChips } from './ui.jsx'
import { useHealthDay, hrvLow, ago } from './sync.js'

const LV = { green: 'Jalankan', yellow: 'Turunkan', red: 'Ganti easy / istirahat' }
const Field = ({ label, hint, err, children }) => <label className="fld"><span>{label}</span>{children}{err ? <small className="err" role="alert">{err}</small> : hint && <small>{hint}</small>}</label>

export default function Readiness({ vdot }) {
  const T = today(), [date, setDate] = useState(T)
  const [f, setF] = useStore('lumpad.daily.' + date, EMPTY_DAY)
  const [hist, setHist] = useState({})
  const hd = useHealthDay(date), row = hd.row
  useEffect(() => { fetch('/api/kv/prefix?prefix=lumpad.daily.').then((r) => r.json()).then(setHist).catch(() => {}) }, [])
  // sticky mini status once the big verdict scrolls away (so it stays visible while typing)
  const topRef = useRef(), [stuck, setStuck] = useState(false)
  useEffect(() => { const o = new IntersectionObserver(([e]) => setStuck(!e.isIntersecting)); o.observe(topRef.current); return () => o.disconnect() }, [])

  const sess = BY_DATE[date] || null, g = evaluate(f, sess), has = hasInput(f), p = paces(vdot.v)
  const easy = `${fmtPace(p.E[1])}–${fmtPace(p.E[0])} /km`
  const set = (patch) => setF({ ...f, ...patch })
  const num = (k) => (e) => set({ [k]: e.target.value === '' ? '' : +e.target.value })
  const mismatch = row?.sleep_hr_avg != null && f.sleepHR !== '' && Math.abs(f.sleepHR - row.sleep_hr_avg) > 3
  const shrErr = f.sleepHR !== '' && (f.sleepHR < 30 || f.sleepHR > 130) ? 'Biasanya 40–80 bpm — cek lagi' : ''
  const useCoros = () => set({ ...(row.sleep_hr_avg != null ? { sleepHR: Math.round(row.sleep_hr_avg) } : {}), ...(row.hrv_status ? { hrv: hrvLow(row.hrv_status) ? 'reduced' : 'normal' } : {}) })
  const days7 = Array.from({ length: 7 }, (_, i) => addDays(date, i - 6))
  const rec = (d) => (d === date ? f : hist['lumpad.daily.' + d] || null)
  const wg = weeklyGate(days7.map(rec).filter(Boolean)), max = 80, min = 40
  const level = has ? g.level : 'none'
  const label = has ? LV[g.level] : 'Menunggu data pagi'

  return <Screen title="Readiness" sub="Boleh lari atau tidak — isi 4 data, ±15 detik">
    {stuck && <div className={`gatemini g-${level}`}><span className="gdot" aria-hidden="true" /><span>{label}</span><small>{sess ? `${sess.label || KIND[sess.kind].label}${sess.km ? ' · ' + sess.km + ' km' : ''}` : ''}</small></div>}
    <div className="datebar">
      <button onClick={() => setDate(addDays(date, -1))} aria-label="Hari sebelumnya"><Icon n="left" /></button>
      <div><b>{fmtLong(date)}</b>{date === T && <small>hari ini</small>}</div>
      <button onClick={() => setDate(addDays(date, 1))} aria-label="Hari berikutnya" className="flip"><Icon n="left" /></button>
    </div>

    <div ref={topRef} className={`gatebig g-${level}`} role="status" aria-live="polite">
      <small>Status {date === T ? 'hari ini' : 'tanggal ini'}</small>
      <h2>{label}</h2>
      {sess && <p className="plain-sess"><Chip kind={sess.kind}>{KIND[sess.kind].label}</Chip> <b>{sess.label}</b>{sess.km ? <span className="muted">{sess.km} km</span> : null}</p>}
      {has && g.reasons.length > 0 ? <ul>{g.reasons.map((r, i) => <li key={i} className={r.level}>{r.msg}</li>)}</ul> : <p>{has ? 'Tidak ada sinyal merah — jalankan sesi sesuai rencana.' : 'Pakai data COROS atau isi form di bawah.'}</p>}
      {has && g.level === 'red' && <p className="rec">Gantinya: easy di {easy}, atau istirahat.</p>}
      {has && g.level === 'yellow' && <p className="rec">Turunkan intensitas: easy di {easy}.</p>}
      {g.level !== 'green' && has && <input className="ovr" aria-label="Alasan override" placeholder="Tetap lanjut? Tulis alasannya (disimpan)" value={f.override} onChange={(e) => set({ override: e.target.value })} />}
    </div>

    <Card title="Data COROS" className="coros" right={row && <span className="muted">ditarik {ago(row.pulled_at)}</span>}>
      {hd.state === 'loading' && <><div className="skel" /><div className="skel" style={{ width: '70%' }} /></>}
      {hd.state === 'error' && <p className="muted">Server tidak terjangkau — isi manual di bawah.</p>}
      {hd.state === 'none' && <p className="muted">Belum ditarik untuk tanggal ini (sync harian ±07:50 WIB). Isi manual di bawah — cukup 4 data.</p>}
      {row && <>
        <dl className="kv">
          <div><dt>Sleep HR (rata-rata)</dt><dd>{row.sleep_hr_avg ?? '—'} bpm{row.sleep_hr_min != null && <small className="muted"> · min {row.sleep_hr_min} · maks {row.sleep_hr_max}</small>}</dd></div>
          <div><dt>HRV tidur</dt><dd>{row.hrv_avg ?? '—'} ms · {row.hrv_status || '—'}{row.hrv_range_lo != null && <small className="muted"> · normal {row.hrv_range_lo}–{row.hrv_range_hi}</small>}</dd></div>
          <div><dt>Resting HR</dt><dd>{row.resting_hr ?? '—'} bpm</dd></div>
        </dl>
        {mismatch && <div className="banner" role="alert">Beda dengan isianmu: kamu mengetik {f.sleepHR}, COROS {row.sleep_hr_avg}. Yang menang: data COROS, kecuali kamu menimpanya.</div>}
        <button className="btn primary" onClick={useCoros}>Pakai data COROS</button>
      </>}
    </Card>

    <Card title="Check-in pagi" right={<span className="saved" aria-live="polite">{has ? 'tersimpan otomatis' : ''}</span>}>
      <div className="form">
        <Field label="Sleep HR (bpm)" hint="> 67 = tanpa lari keras" err={shrErr}><input inputMode="numeric" enterKeyHint="next" type="number" value={f.sleepHR} aria-invalid={!!shrErr} onChange={num('sleepHR')} /></Field>
        <Field label="HRV tidur"><div className="seg" role="group" aria-label="HRV">{[['normal', 'Normal'], ['reduced', 'Reduced']].map(([v, l]) => <button key={v} aria-pressed={f.hrv === v} className={f.hrv === v ? 'on ' + v : ''} onClick={() => set({ hrv: f.hrv === v ? '' : v })}>{l}</button>)}</div></Field>
        <div className="fld" style={{ gridColumn: 'span 2' }}><span id="painl">Nyeri saat lari (0–10) — ≥ 2 = durability event</span>
          <div className="pain" role="group" aria-labelledby="painl">{[0, 1, 2, 3, 4, 5, 6].map((n) => <button key={n} aria-pressed={f.pain === n} className={n >= 2 ? 'hi' : ''} onClick={() => set({ pain: f.pain === n ? '' : n })}>{n === 6 ? '6+' : n}</button>)}</div></div>
        <label className="sw"><input type="checkbox" checked={f.tibia} onChange={(e) => set({ tibia: e.target.checked })} /><span>Tibia nyeri tekan</span></label>
      </div>
      <details className="more"><summary>Data tambahan (opsional)</summary>
        <div className="form">
          <Field label="TE kemarin"><input inputMode="decimal" type="number" step="0.1" value={f.te} onChange={num('te')} /></Field>
          <Field label="Buffer makan (menit)" hint="≥ 90 sebelum lari"><input inputMode="numeric" type="number" value={f.mealBufferMin} onChange={num('mealBufferMin')} /></Field>
          <Field label="Durasi rencana (menit)"><input inputMode="numeric" type="number" value={f.plannedMin} onChange={num('plannedMin')} /></Field>
          <label className="sw"><input type="checkbox" checked={f.fasted} onChange={(e) => set({ fasted: e.target.checked })} /><span>Lari fasted</span></label>
        </div>
      </details>
    </Card>

    {sess && <Card title="Sesi terjadwal"><div className="plain-sess"><Chip kind={sess.kind}>{KIND[sess.kind].label}</Chip> <b>{sess.label}</b> <span className="muted">{sess.km ? sess.km + ' km' : ''}</span><div className="chips"><StrengthChips day={sess} /></div></div></Card>}

    <Card title="7 hari terakhir" right={<span className="muted">Sleep HR · garis = 67</span>}>
      <div className="spark" role="img" aria-label={'Sleep HR 7 hari: ' + days7.map((d) => { const v = rec(d)?.sleepHR; return v === '' || v == null ? 'kosong' : v }).join(', ')}>
        <i className="thr" style={{ bottom: ((67 - min) / (max - min)) * 100 + '%' }}><em>67</em></i>
        {days7.map((d) => { const v = rec(d)?.sleepHR, e = v === '' || v == null; return <div key={d} className={d === date ? 'sel' : ''}>
          <span className={'b ' + (e ? 'empty' : v > 67 ? 'bad' : 'ok')} style={{ height: e ? 4 : Math.max(6, ((Math.min(v, max) - min) / (max - min)) * 100) + '%' }} />
          <small>{e ? '–' : v}</small><small className="dn">{['M', 'S', 'S', 'R', 'K', 'J', 'S'][dow(d)]}</small></div> })}
      </div>
    </Card>

    <Card title="Gate mingguan · ◇ tempo Kamis" tone={wg.blocked ? 'red' : 'green'}>
      <p><b>{wg.blocked ? 'Kamis tetap strides / hills' : 'Tidak ada alasan menahan ◇ tempo'}</b></p>
      <p className="muted">{wg.bad} malam Sleep HR &gt; 67 / HRV Reduced dalam 7 hari{wg.pain ? ' · ada nyeri/tibia positif' : ''}. Syarat lain (LR 100%, volume plateau 3 minggu, LR tanpa MP ≥8 km) dicek manual.</p>
    </Card>
  </Screen>
}
