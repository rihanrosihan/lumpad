import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from './store.js'
import { evaluate, weeklyGate, EMPTY_DAY, hasInput } from './lib/gate.js'
import { paces, fmtPace } from './lib/vdot.js'
import { BY_DATE, today, addDays, fmtLong, KIND, dow } from './lib/calendar.js'
import { acwrZone, fitnessSeries, latestOn, sleepSummary, hrvSummary, restingSummary, dailyLoads, volumeRamp, longRunRule, weekStart, weeklyKm, round } from './lib/metrics.js'
import { Card, Chip, Screen, Icon } from './ui.jsx'
import { useHealthDay, hrvLow, ago } from './sync.js'
import { useApi, hm } from './api.js'
import { LineChart, Legend, BarChart, ZoneBar, StageBar, RangeBar } from './charts.jsx'

const LV = { green: 'Jalankan', yellow: 'Turunkan', red: 'Ganti easy / istirahat' }
const Field = ({ label, hint, err, children }) => <label className="fld"><span>{label}</span>{children}{err ? <small className="err" role="alert">{err}</small> : hint && <small>{hint}</small>}</label>
const Src = ({ children }) => <p className="src-note">{children}</p>
const sign = (n) => (n == null ? '—' : (n > 0 ? '+' : '') + n)
const planKm = (mon) => Math.round(Array.from({ length: 7 }, (_, i) => BY_DATE[addDays(mon, i)]?.km || 0).reduce((a, b) => a + b, 0) * 10) / 10

export default function Readiness({ vdot }) {
  const T = today(), [date, setDate] = useState(T)
  const [f, setF] = useStore('lumpad.daily.' + date, EMPTY_DAY)
  const [hist, setHist] = useState({})
  const hd = useHealthDay(date), row = hd.row
  useEffect(() => { fetch('/api/kv/prefix?prefix=lumpad.daily.').then((r) => r.json()).then(setHist).catch(() => {}) }, [])
  const from = addDays(date, -70)
  const R = useApi(`/api/readiness?from=${from}&to=${date}`), A = useApi(`/api/activities/merged?from=${from}&to=${date}`)
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
  const level = has ? g.level : 'none', label = has ? LV[g.level] : 'Menunggu data pagi'

  // ---- metrics (all from synced data; empty states stay honest)
  const health = R.data?.health || [], acts = A.data || []
  const fs = useMemo(() => fitnessSeries(health), [health]), cur = latestOn(fs, date, 'fitness'), stale = cur && cur.date !== date
  const sleep = sleepSummary(health, date), hrv = hrvSummary(health, date), rhr = restingSummary(health, date)
  const today_ = health.find((r) => r.date === date), recov = latestOn(health, date, 'recovery_pct')
  const loads = dailyLoads(R.data?.loads || [], date, 28), loadWeek = loads.slice(-7).reduce((a, d) => a + d.load, 0), loadPrev = loads.slice(-14, -7).reduce((a, d) => a + d.load, 0)
  const zone = acwrZone(cur?.acwr)
  const vr = volumeRamp(acts, date), mon = weekStart(date), plannedLong = Array.from({ length: 7 }, (_, i) => BY_DATE[addDays(mon, i)]).find((d) => d?.kind === 'long')
  const lr = longRunRule(acts, plannedLong?.date || date, plannedLong?.km), wk = weeklyKm(acts)
  const weeks = Array.from({ length: 8 }, (_, i) => { const m = addDays(mon, -7 * (7 - i)); return { date: m, value: round(wk[m] || 0, 1), plan: planKm(m) || undefined, tick: m.slice(8) } })
  const noData = R.state === 'ok' && !health.length

  return <Screen title="Readiness" sub="Gate pagi + semua metrik pemulihan dan beban">
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

    <Card title="Check-in pagi" className="coros" right={<span className="saved" aria-live="polite">{has ? 'tersimpan otomatis' : ''}</span>}>
      {hd.state === 'loading' && <><div className="skel" /><div className="skel" style={{ width: '70%' }} /></>}
      {hd.state === 'error' && <p className="muted">Server tidak terjangkau — isi manual.</p>}
      {hd.state === 'none' && <p className="muted">Data COROS belum ditarik untuk tanggal ini. Isi manual — cukup 4 data.</p>}
      {row && <>
        <p className="muted">Dari COROS (ditarik {ago(row.pulled_at)}): Sleep HR {row.sleep_hr_avg ?? '—'} bpm · HRV {row.hrv_avg ?? '—'} ms {row.hrv_status ? `(${row.hrv_status})` : ''}</p>
        {mismatch && <div className="banner" role="alert">Beda dengan isianmu: kamu mengetik {f.sleepHR}, COROS {row.sleep_hr_avg}. Yang menang: data COROS, kecuali kamu menimpanya.</div>}
        <button className="btn primary" onClick={useCoros}>Pakai data COROS</button>
      </>}
      <div className="form" style={{ marginTop: 14 }}>
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

    <h2 className="sech">Pemulihan</h2>
    {noData && <div className="card empty"><b>Metrik belum ada</b>Hubungkan COROS di Profil lalu tarik data — metrik di bawah terisi otomatis.</div>}
    <div className="tiles">
      <div className="tile"><small>Recovery</small><b>{recov?.recovery_pct != null ? recov.recovery_pct + '%' : '—'}</b><em>{recov?.recovery_level || 'belum ditarik'}</em></div>
      <div className="tile"><small>Tidur</small><b>{sleep ? hm(sleep.total_min) : '—'}</b><em>{sleep?.score != null ? `skor ${sleep.score}` : 'belum ditarik'}</em></div>
      <div className="tile"><small>HRV</small><b>{hrv ? hrv.avg + ' ms' : '—'}</b>{hrv?.status ? <Chip tone={hrvLow(hrv.status) ? 'red' : 'green'}>{hrv.status}</Chip> : <em>belum ditarik</em>}</div>
      <div className="tile"><small>Resting HR</small><b>{rhr ? rhr.value : '—'}</b><em>{rhr?.delta != null ? `${sign(rhr.delta)} vs rata-rata 14 hari` : 'belum ditarik'}</em></div>
    </div>

    {sleep && <Card title="Tidur" right={<span className="muted">{sleep.score != null ? `skor ${sleep.score}` : ''}</span>}>
      <div className="mgrid"><div><small>Durasi</small><b>{hm(sleep.total_min)}</b></div><div><small>Terbangun</small><b>{sleep.awake_count ?? '—'}×</b></div><div><small>Sleep HR</small><b>{sleep.hr_avg ?? '—'}</b></div></div>
      <StageBar deep={sleep.deep_pct} rem={sleep.rem_pct} light={sleep.light_pct} awake={sleep.awake_min != null && sleep.total_min ? Math.round((sleep.awake_min / (sleep.total_min + sleep.awake_min)) * 100) : null} />
      <p className="muted">Rata-rata 7 hari: {hm(sleep.avg7_total)}{sleep.avg7_score != null ? ` · skor ${sleep.avg7_score}` : ''}</p><Src>Sumber: COROS (tanggal = hari bangun).</Src>
    </Card>}
    {hrv && <Card title="HRV tidur" right={hrv.status && <Chip tone={hrvLow(hrv.status) ? 'red' : 'green'}>{hrv.status}</Chip>}>
      <div className="mgrid"><div><small>Semalam</small><b>{hrv.avg} ms</b></div><div><small>Rata-rata 7 hari</small><b>{hrv.avg7} ms</b></div><div><small>Baseline</small><b>{hrv.baseline ?? '—'}</b></div></div>
      <RangeBar lo={hrv.lo} hi={hrv.hi} value={hrv.avg} baseline={hrv.baseline} />
      <p className="muted">Rentang normal {hrv.lo}–{hrv.hi} ms{hrv.vs_baseline_pct != null ? ` · rata-rata 7 hari ${sign(hrv.vs_baseline_pct)}% dari baseline` : ''}</p>
      <Src>Sumber: COROS (assessment resmi). Pola “HRV crash tiap 6–8 minggu” masih [HYPOTHESIS] — tidak dipakai sebagai fakta.</Src>
    </Card>}

    <h2 className="sech">Beban latihan</h2>
    <Card title="Acute · Chronic · ACWR" right={zone && <Chip tone={zone.id === 'sweet' ? 'green' : zone.id === 'under' ? undefined : zone.id === 'caution' ? 'yellow' : 'red'}>{zone.label}</Chip>}>
      {cur ? <>
        <div className="mgrid"><div><small>Acute (7 hr)</small><b>{cur.fatigue}</b></div><div><small>Chronic</small><b>{cur.fitness}</b></div><div><small>ACWR</small><b>{cur.acwr ?? '—'}</b></div></div>
        <ZoneBar value={cur.acwr} />
        {cur.comment && <p className="muted">Status COROS: <b>{cur.comment}</b>{stale ? ` · data per ${cur.date.slice(5)}` : ''}</p>}
        <Src>Sumber: COROS (beban jangka pendek / panjang dan rasionya). Zona 0,8–1,3 “sweet spot”, &gt;1,5 tinggi = prior literatur [LITERATURE: Gabbett 2016, <a href="https://pubmed.ncbi.nlm.nih.gov/26758673/">PMID 26758673</a>] — informasi, bukan gate. ACWR punya kritik metodologis: <a href="https://pubmed.ncbi.nlm.nih.gov/32502973/">Impellizzeri 2020, PMID 32502973</a>.</Src>
      </> : <p className="muted">Belum ditarik.</p>}
    </Card>
    <Card title="Training load harian" right={<span className="muted">28 hari</span>}>
      <BarChart data={loads.map((d, i) => ({ date: d.date, value: d.load, tick: i % 7 === 0 || i === 27 ? d.date.slice(8) : '' }))} label={`Training load harian 28 hari, minggu ini ${loadWeek}`} />
      <div className="mgrid two"><div><small>Total 7 hari</small><b>{loadWeek}</b></div><div><small>7 hari sebelumnya</small><b>{loadPrev}</b></div></div>
      <Src>Sumber: COROS Training Load per aktivitas, dijumlah per hari. Hari tanpa aktivitas = 0.</Src>
    </Card>

    <Card title="Fitness · Fatigue · Form · Ramp">
      {fs.length > 1 ? <>
        <div className="mgrid"><div><small>Fitness</small><b>{cur?.fitness ?? '—'}</b></div><div><small>Fatigue</small><b>{cur?.fatigue ?? '—'}</b></div><div><small>Form</small><b>{sign(cur?.form)}</b></div></div>
        <LineChart data={fs.slice(-42)} lines={[{ key: 'fitness', color: 'var(--c-long)' }, { key: 'fatigue', color: 'var(--c-quality)', cls: 'dash' }]} label={`Fitness ${cur?.fitness} dan fatigue ${cur?.fatigue}, 42 hari`} />
        <Legend items={[{ label: 'Fitness (chronic)', color: 'var(--c-long)' }, { label: 'Fatigue (acute)', color: 'var(--c-quality)', dashed: true }]} />
        <div className="mgrid two"><div><small>Ramp fitness 7 hari</small><b>{sign(cur?.ramp)}</b></div><div><small>Form = fitness − fatigue</small><b>{sign(cur?.form)}</b></div></div>
        <Src>[calc] Model CTL/ATL/TSB dengan beban jangka panjang/pendek COROS sebagai fitness/fatigue — bukan skala TSS TrainingPeaks, jadi bandingkan dengan dirimu sendiri, bukan angka orang lain. Form positif = lebih segar dari baseline; tidak ada ambang “bagus/jelek” yang dikarang.</Src>
      </> : <p className="muted">Butuh beberapa hari data beban — belum ditarik.</p>}
    </Card>

    <Card title="Ramp volume (km lari / minggu)" right={<span className="muted">garis putus = rencana</span>}>
      {acts.length ? <>
        <BarChart data={weeks} label={`Km lari per minggu, 8 minggu: ${weeks.map((w) => w.value).join(', ')}`} />
        <div className="mgrid"><div><small>Minggu ini</small><b>{vr.this_week_km} km</b></div><div><small>vs rata-rata 4 mgg</small><b>{sign(vr.vs_avg4_pct)}%</b></div><div><small>vs minggu lalu</small><b>{sign(vr.week_over_week_pct)}%</b></div></div>
        {plannedLong && <p className={lr.ok === false ? 'banner' : 'muted'} role={lr.ok === false ? 'alert' : undefined}>Long run {plannedLong.km} km ({plannedLong.date.slice(5)}): batas 110% dari run terpanjang 30 hari = {lr.max_allowed_km || '—'} km{lr.ok === false ? ' — rencana MELEBIHI batas, potong jarak (kecuali race/tes).' : lr.ok ? ' — aman.' : '.'}</p>}
        <Src>Sumber: aktivitas COROS/Strava. Rencana 2027 rata-rata ±1,7× volume 2026 — panel ini inti, bukan tambahan.</Src>
      </> : <p className="muted">Belum ada aktivitas tertarik.</p>}
    </Card>

    <Card title="Sleep HR 7 hari" right={<span className="muted">garis = 67</span>}>
      <div className="spark" role="img" aria-label={'Sleep HR 7 hari: ' + days7.map((d) => { const v = rec(d)?.sleepHR; return v === '' || v == null ? 'kosong' : v }).join(', ')}>
        <i className="thr" style={{ bottom: ((67 - min) / (max - min)) * 100 + '%' }}><em>67</em></i>
        {days7.map((d) => { const v = rec(d)?.sleepHR ?? health.find((h) => h.date === d)?.sleep_hr_avg, e = v === '' || v == null; return <div key={d} className={d === date ? 'sel' : ''}>
          <span className={'b ' + (e ? 'empty' : v > 67 ? 'bad' : 'ok')} style={{ height: e ? 4 : Math.max(6, ((Math.min(v, max) - min) / (max - min)) * 100) + '%' }} />
          <small>{e ? '–' : Math.round(v)}</small><small className="dn">{['M', 'S', 'S', 'R', 'K', 'J', 'S'][dow(d)]}</small></div> })}
      </div>
    </Card>
    <Card title="Gate mingguan · ◇ tempo Kamis" tone={wg.blocked ? 'red' : 'green'}>
      <p><b>{wg.blocked ? 'Kamis tetap strides / hills' : 'Tidak ada alasan menahan ◇ tempo'}</b></p>
      <p className="muted">{wg.bad} malam Sleep HR &gt; 67 / HRV Reduced dalam 7 hari{wg.pain ? ' · ada nyeri/tibia positif' : ''}. Syarat lain (LR 100%, volume plateau 3 minggu, LR tanpa MP ≥8 km) dicek manual.</p>
    </Card>
  </Screen>
}
