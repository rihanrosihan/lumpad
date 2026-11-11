import { useEffect, useState } from 'react'
import { useStore } from './store.js'
import { evaluate, weeklyGate, EMPTY_DAY, hasInput } from './lib/gate.js'
import { BY_DATE, today, addDays, fmtLong, fmtShort, KIND, dow } from './lib/calendar.js'
import { Card, Chip, Screen, Icon, StrengthChips } from './ui.jsx'
import { useHealthDay, hrvLow, ago } from './sync.js'

const LV = { green: 'Jalankan', yellow: 'Turunkan', red: 'Ganti easy / istirahat' }
function Field({ label, children, hint }) { return <label className="fld"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label> }

export default function Readiness() {
  const T = today(), [date, setDate] = useState(T)
  const [f, setF] = useStore('lumpad.daily.' + date, EMPTY_DAY)
  const [hist, setHist] = useState({})
  useEffect(() => { fetch('/api/kv/prefix?prefix=lumpad.daily.').then((r) => r.json()).then(setHist).catch(() => {}) }, [])
  const hd = useHealthDay(date)
  const sess = BY_DATE[date] || null
  const mismatch = hd?.sleep_hr_avg != null && f.sleepHR !== '' && Math.abs(f.sleepHR - hd.sleep_hr_avg) > 3
  const g = evaluate(f, sess)
  const num = (k) => (e) => setF({ ...f, [k]: e.target.value === '' ? '' : +e.target.value })
  const days7 = Array.from({ length: 7 }, (_, i) => addDays(date, i - 6))
  const rec = (d) => (d === date ? f : hist['lumpad.daily.' + d] || null)
  const wg = weeklyGate(days7.map(rec).filter(Boolean))
  const max = 80, min = 40

  return <Screen title="Readiness" sub="Gate pagi: boleh lari atau tidak">
    <div className="datebar">
      <button onClick={() => setDate(addDays(date, -1))} aria-label="Hari sebelumnya"><Icon n="left" /></button>
      <div><b>{fmtLong(date)}</b>{date === T && <small>hari ini</small>}</div>
      <button onClick={() => setDate(addDays(date, 1))} aria-label="Hari berikutnya" className="flip"><Icon n="left" /></button>
    </div>

    <div className={`gatebig g-${hasInput(f) ? g.level : 'none'}`}>
      <small>Status hari ini</small>
      <h2>{hasInput(f) ? LV[g.level] : 'Menunggu data pagi'}</h2>
      {g.reasons.length > 0 ? <ul>{g.reasons.map((r, i) => <li key={i} className={r.level}>{r.msg}</li>)}</ul> : <p>{hasInput(f) ? 'Tidak ada sinyal merah.' : 'Isi form di bawah.'}</p>}
      {g.level !== 'green' && hasInput(f) && <input className="ovr" placeholder="Override? Tulis alasannya (disimpan)" value={f.override} onChange={(e) => setF({ ...f, override: e.target.value })} />}
    </div>

    <Card title="Dari COROS" right={hd && <span className="muted">ditarik {ago(hd.pulled_at)}</span>}>
      {hd === undefined ? <p className="muted">Memuat…</p> : !hd ? <p className="muted">Belum ditarik untuk tanggal ini (sync harian 08:00 WIB). Isi manual di bawah, atau minta sync sekarang.</p> : <>
        <dl className="kv">
          <div><dt>Sleep HR (rata-rata)</dt><dd>{hd.sleep_hr_avg ?? '—'} bpm{hd.sleep_hr_min != null ? <small className="muted"> · min {hd.sleep_hr_min} · maks {hd.sleep_hr_max}</small> : ''}</dd></div>
          <div><dt>HRV tidur</dt><dd>{hd.hrv_avg ?? '—'} ms · {hd.hrv_status || '—'}{hd.hrv_range_lo != null ? <small className="muted"> · normal {hd.hrv_range_lo}–{hd.hrv_range_hi}</small> : ''}</dd></div>
          <div><dt>Resting HR</dt><dd>{hd.resting_hr ?? '—'} bpm</dd></div>
        </dl>
        {mismatch && <div className="banner">Beda dengan isianmu: Sleep HR yang kamu ketik {f.sleepHR}, COROS {hd.sleep_hr_avg}. Yang menang: data mentah COROS, kecuali kamu menimpanya.</div>}
        <button onClick={() => setF({ ...f, ...(hd.sleep_hr_avg != null ? { sleepHR: Math.round(hd.sleep_hr_avg) } : {}), ...(hd.hrv_status ? { hrv: hrvLow(hd.hrv_status) ? 'reduced' : 'normal' } : {}) })}>Pakai data COROS</button>
      </>}
    </Card>

    <Card title="Sesi terjadwal">
      {sess ? <div className="plain-sess"><Chip kind={sess.kind}>{KIND[sess.kind].label}</Chip> <b>{sess.label}</b> <span className="muted">{sess.km ? sess.km + ' km' : ''}</span><div className="chips"><StrengthChips day={sess} /></div></div> : <p className="muted">Tidak ada sesi di plan untuk tanggal ini.</p>}
    </Card>

    <Card title="Check-in pagi">
      <div className="form">
        <Field label="Sleep HR (bpm)" hint="> 67 = tanpa lari keras"><input inputMode="numeric" type="number" value={f.sleepHR} onChange={num('sleepHR')} /></Field>
        <Field label="HRV"><div className="seg">{['normal', 'reduced'].map((v) => <button key={v} className={f.hrv === v ? 'on ' + v : ''} onClick={() => setF({ ...f, hrv: f.hrv === v ? '' : v })}>{v === 'normal' ? 'Normal' : 'Reduced'}</button>)}</div></Field>
        <Field label={`Nyeri saat lari: ${f.pain === '' ? '—' : f.pain + '/10'}`} hint="≥ 2 = durability event"><input type="range" min="0" max="10" value={f.pain === '' ? 0 : f.pain} onChange={num('pain')} /></Field>
        <Field label="TE kemarin"><input inputMode="decimal" type="number" step="0.1" value={f.te} onChange={num('te')} /></Field>
        <Field label="Buffer makan (menit)" hint="≥ 90 sebelum lari"><input inputMode="numeric" type="number" value={f.mealBufferMin} onChange={num('mealBufferMin')} /></Field>
        <Field label="Durasi rencana (menit)"><input inputMode="numeric" type="number" value={f.plannedMin} onChange={num('plannedMin')} /></Field>
        <label className="sw"><input type="checkbox" checked={f.tibia} onChange={(e) => setF({ ...f, tibia: e.target.checked })} /><span>Tibia nyeri tekan</span></label>
        <label className="sw"><input type="checkbox" checked={f.fasted} onChange={(e) => setF({ ...f, fasted: e.target.checked })} /><span>Lari fasted</span></label>
      </div>
    </Card>

    <Card title="7 hari terakhir" right={<span className="muted">Sleep HR</span>}>
      <div className="spark">
        <i className="thr" style={{ bottom: ((67 - min) / (max - min)) * 100 + '%' }}><em>67</em></i>
        {days7.map((d) => { const r = rec(d), v = r?.sleepHR; return <div key={d} className={d === date ? 'sel' : ''}>
          <span className={'b ' + (v === '' || v == null ? 'empty' : v > 67 ? 'bad' : 'ok')} style={{ height: v === '' || v == null ? 4 : Math.max(6, ((Math.min(v, max) - min) / (max - min)) * 100) + '%' }} />
          <small>{v === '' || v == null ? '–' : v}</small><small className="dn">{['M', 'S', 'S', 'R', 'K', 'J', 'S'][dow(d)]}</small></div> })}
      </div>
    </Card>

    <Card title="Gate mingguan · ◇ tempo Kamis" tone={wg.blocked ? 'red' : 'green'}>
      <p><b>{wg.blocked ? 'Kamis tetap strides / hills' : 'Tidak ada alasan menahan ◇ tempo'}</b></p>
      <p className="muted">{wg.bad} malam Sleep HR &gt; 67 / HRV Reduced dalam 7 hari{wg.pain ? ' · ada nyeri/tibia positif' : ''}. Syarat lain (LR 100%, volume plateau 3 minggu, LR tanpa MP ≥8 km) dicek manual dulu.</p>
    </Card>
  </Screen>
}
