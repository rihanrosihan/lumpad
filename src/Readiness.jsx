import { useEffect, useRef, useState } from 'react'
import { useStore } from './store.js'
import { evaluate, weeklyGate, EMPTY_DAY, hasInput, HARD } from './lib/gate.js'
import { paces, fmtPace } from './lib/vdot.js'
import { BY_DATE, today, addDays, fmtLong, KIND } from './lib/calendar.js'
import { PILLAR } from './lib/readiness.js'
import { formZone, progressionBand } from './lib/load.js'
import { quadrantLabel } from './lib/hrv.js'
import { mean, r1 } from './lib/stats.js'
import { Card, Chip, Screen, Icon } from './ui.jsx'
import { useHealthDay, hrvLow, ago } from './sync.js'
import { hm } from './api.js'
import { useModel } from './model.js'
import { RadialGauge, Speedometer, BandLine, PMCChart, Quadrant, Waterfall, BodyMap, Stacked100, Bullet, GroupedBars, TwinBars } from './charts2.jsx'

const Field = ({ label, hint, err, children }) => <label className="fld"><span>{label}</span>{children}{err ? <small className="err" role="alert">{err}</small> : hint && <small>{hint}</small>}</label>
const Src = ({ children }) => <p className="src-note">{children}</p>
const sign = (n) => (n == null ? '—' : (n > 0 ? '+' : '') + n)
const TIER_TONE = { prime: 'green', optimal: 'teal', compromised: 'yellow', depleted: 'red' }
const Pill5 = ({ label, value, onChange, lo, hi }) => <div className="fld" style={{ gridColumn: 'span 2' }}><span>{label} <small className="muted">(1 = {lo} · 5 = {hi})</small></span>
  <div className="pill5" role="group" aria-label={label}>{[1, 2, 3, 4, 5].map((n) => <button key={n} aria-pressed={value === n} onClick={() => onChange(value === n ? '' : n)}>{n}</button>)}</div></div>

const SITES = [['vmo_l', 'VMO kiri (paha)'], ['achilles', 'Achilles'], ['plantar', 'Telapak kaki'], ['tibia', 'Tibia'], ['other', 'Lain']]

export default function Readiness({ vdot, settings }) {
  const T = today(), [date, setDate] = useState(T)
  const [f, setF] = useStore('lumpad.daily.' + date, EMPTY_DAY), [ov, setOv] = useStore('lumpad.muscle.' + date, {})
  const [hist, setHist] = useState({}), [range, setRange] = useState(42), [acwrMode, setAcwrMode] = useState('ewma')
  const hd = useHealthDay(date), row = hd.row, M = useModel(date, settings, vdot, f, ov)
  const [painOpen, setPainOpen] = useState(false)
  useEffect(() => { fetch('/api/kv/prefix?prefix=lumpad.daily.').then((r) => r.json()).then(setHist).catch(() => {}) }, [])
  const topRef = useRef(), [stuck, setStuck] = useState(false)
  useEffect(() => { const o = new IntersectionObserver(([e]) => setStuck(!e.isIntersecting)); o.observe(topRef.current); return () => o.disconnect() }, [])

  const sess = BY_DATE[date] || null, g = evaluate(f, sess), has = hasInput(f), p = paces(vdot.v), rd = M.readiness, tier = rd.tier
  const easy = `${fmtPace(p.E[1])}–${fmtPace(p.E[0])} /km`
  const set = (patch) => setF({ ...f, ...patch }), num = (k) => (e) => set({ [k]: e.target.value === '' ? '' : +e.target.value })
  const shrErr = f.sleepHR !== '' && (f.sleepHR < 30 || f.sleepHR > 130) ? 'Biasanya 40–80 bpm — cek lagi' : ''
  // minimal check-in: COROS values are applied silently the first time a day with data is opened; one tap on "Rasa badan" completes a normal day
  useEffect(() => { if (row && f.sleepHR === '' && f.hrv === '' && (row.sleep_hr_avg != null || row.hrv_status)) setF({ ...f, ...(row.sleep_hr_avg != null ? { sleepHR: Math.round(row.sleep_hr_avg) } : {}), ...(row.hrv_status ? { hrv: hrvLow(row.hrv_status) ? 'reduced' : 'normal' } : {}) }) }, [row?.date, row?.pulled_at]) // eslint-disable-line
  const feel = (v) => set({ energy: v, ...(v !== '' && f.pain === '' ? { pain: 0, tibia: false } : {}) })
  const setSite = (k, n) => { const ps = { ...(f.painSites || {}), [k]: n }; const worst = Math.max(0, ...Object.values(ps)); set({ painSites: ps, pain: worst, tibia: (ps.tibia || 0) > 0 }) }
  const days7 = Array.from({ length: 7 }, (_, i) => addDays(date, i - 6)), rec = (d) => (d === date ? f : hist['lumpad.daily.' + d] || null), wg = weeklyGate(days7.map(rec).filter(Boolean))
  const label = rd.score != null ? `${tier.label} · ${rd.score}` : has ? { green: 'Jalankan', yellow: 'Turunkan', red: 'Ganti easy / istirahat' }[g.level] : 'Menunggu data pagi'
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

  return <Screen title="Readiness" sub="Model transparan berbasis bukti · aturan tervalidasimu menang">
    {stuck && <div className={`gatemini g-${tier ? { prime: 'green', optimal: 'green', compromised: 'yellow', depleted: 'red' }[tier.id] : has ? g.level : 'none'}`}><span className="gdot" aria-hidden="true" /><span>{label}</span><small>{sess ? `${sess.label || KIND[sess.kind].label}${sess.km ? ' · ' + sess.km + ' km' : ''}` : ''}</small></div>}
    <div className="datebar">
      <button onClick={() => setDate(addDays(date, -1))} aria-label="Hari sebelumnya"><Icon n="left" /></button>
      <div><b>{fmtLong(date)}</b>{date === T && <small>hari ini</small>}</div>
      <button onClick={() => setDate(addDays(date, 1))} aria-label="Hari berikutnya" className="flip"><Icon n="left" /></button>
    </div>

    {/* ---- Layer 2.1: verdict & prescription ---- */}
    <div ref={topRef} className="card" role="status" aria-live="polite">
      <div className="hero">
        <RadialGauge value={rd.score} tone={tier ? TIER_TONE[tier.id] : 'none'} label="Skor readiness" sub={rd.score == null ? 'data kurang' : '/ 100'} />
        <div className="hx">
          {tier ? <span className={'tierc tier-' + tier.id}>{tier.label}</span> : <span className="tierc">Belum ada skor</span>}
          <h2>{tier ? tier.advice : 'Butuh ≥ 60 poin data — isi check-in atau tunggu sync.'}</h2>
          <p className="muted">Data: {rd.coverage}/100 poin{rd.capped ? ` · skor dibatasi (asli ${rd.raw})` : ''}</p>
          {M.recov?.recovery_hours != null && <p className="muted">Pulih penuh (COROS): ±{M.recov.recovery_hours} jam · per {M.recov.date.slice(5)}</p>}
        </div>
      </div>
      {(rd.caps.length > 0 || (has && g.reasons.length > 0)) && <ul className="gatebig-ul">{[...rd.caps.map((c) => ({ level: 'red', msg: c.why })), ...(has ? g.reasons.filter((r) => !rd.caps.some((c) => c.why.startsWith(r.msg.slice(0, 8)))) : [])].map((r, i) => <li key={i} className={r.level}>{r.msg}</li>)}</ul>}
      {sess && <div className={'mod ' + (needsMod ? (tier?.id === 'depleted' || g.level === 'red' ? 'red' : 'yellow') : 'green')}>
        <b>Hari ini: {sess.label || KIND[sess.kind].label}{sess.km ? ` · ${sess.km} km` : ''}</b>
        {needsMod ? <><p>Saran: {tier?.id === 'depleted' || g.level === 'red' ? `istirahat atau easy di ${easy}` : `turunkan ke easy (${easy}) atau potong ke ±${cutKm} km`}.</p>
          <div className="row2"><button className="btn sm" aria-pressed={f.adjust === 'easy'} onClick={() => set({ adjust: f.adjust === 'easy' ? '' : 'easy' })}>{f.adjust === 'easy' ? '✓ ' : ''}Ganti easy</button><button className="btn sm" aria-pressed={f.adjust === 'cut'} onClick={() => set({ adjust: f.adjust === 'cut' ? '' : 'cut' })}>{f.adjust === 'cut' ? '✓ ' : ''}Potong 25%</button></div></>
          : <p>{rd.score != null || has ? 'Tidak ada alasan menurunkan sesi.' : 'Isi check-in untuk verdict.'}</p>}
      </div>}
      {(needsMod && g.level !== 'green' && has) && <input className="ovr" aria-label="Alasan override" placeholder="Tetap lanjut? Tulis alasannya (disimpan)" value={f.override} onChange={(e) => set({ override: e.target.value })} />}
      <h3>Kontribusi pilar</h3>
      <div className="pbar" role="img" aria-label={Object.entries(rd.pillars).map(([k, v]) => `${PILLAR[k]} ${Math.round(v.earned)} dari ${v.weight}`).join(', ')}>
        {Object.entries(rd.pillars).map(([k, v]) => <i key={k} className={'pb-' + k} style={{ width: v.earned + '%' }} />)}</div>
      {Object.entries(rd.pillars).map(([k, v]) => <details key={k} className="more"><summary>{PILLAR[k]} · {Math.round(v.earned)}/{v.weight}{v.haveWeight < v.weight ? ` (data ${Math.round(v.haveWeight)})` : ''}</summary>
        {v.comps.map((c) => <div key={c.id} className="prow"><span>{c.label}</span><b>{c.pts == null ? '—' : `${r1(c.pts)}/${r1(c.max)}`}</b><small>{c.value == null ? 'belum ada data' : c.value}</small></div>)}</details>)}
      <Src>Bobot: muskuloskeletal & subjektif 30 · otonom 30 · tidur 20 · beban 20 (fase taper/peak ±5). Alasan & rumus: docs/readiness-model.md. Saw 2016 (PMID 26423706): ukuran subjektif lebih sensitif dari objektif.</Src>
    </div>

    {/* ---- Morning check-in: 1 tap on a normal day (Feel). Sleep HR / HRV come from COROS automatically; pain defaults to 0 ---- */}
    <Card title="Check-in pagi" className="coros" right={<span className="saved" aria-live="polite">{has ? 'tersimpan' : ''}</span>}>
      {hd.state === 'none' && <p className="muted">Data COROS belum ditarik untuk tanggal ini — isi Sleep HR manual di “Detail”.</p>}
      {row && <p className="muted">COROS terbaca otomatis · Sleep HR {row.sleep_hr_avg ?? '—'} · HRV {row.hrv_avg ?? '—'} ms {row.hrv_status ? `(${row.hrv_status})` : ''}</p>}
      <Pill5 label="Rasa badan hari ini" value={f.energy} onChange={feel} lo="habis" hi="segar" />
      <div className="seg" role="group" aria-label="Nyeri" style={{ marginTop: 10 }}>
        <button aria-pressed={!painOpen && !(f.pain >= 1)} className={!painOpen && !(f.pain >= 1) ? 'on' : ''} onClick={() => { setPainOpen(false); set({ pain: f.energy !== '' || f.pain !== '' ? 0 : '', tibia: false, painSites: {} }) }}>Tidak ada nyeri</button>
        <button aria-pressed={painOpen || f.pain >= 1} className={painOpen || f.pain >= 1 ? 'on' : ''} onClick={() => setPainOpen(true)}>Ada nyeri</button>
      </div>
      {(painOpen || f.pain >= 1) && <div className="painsites">{SITES.map(([k, l]) => <div key={k} className="fld"><span>{l}</span>
        <div className="pain" role="group" aria-label={`Nyeri ${l}`}>{[0, 1, 2, 3, 4, 5, 6].map((n) => <button key={n} aria-pressed={(f.painSites?.[k] || 0) === n} className={n >= 2 ? 'hi' : ''} onClick={() => setSite(k, n)}>{n === 6 ? '6+' : n}</button>)}</div></div>)}
        <small className="muted">≥ 2/10 = durability event (aturan): sesi diturunkan otomatis.</small></div>}
      <details className="more"><summary>Detail (opsional)</summary><div className="form">
        <Field label="Sleep HR (bpm)" hint="> 67 = tanpa lari keras" err={shrErr}><input inputMode="numeric" type="number" value={f.sleepHR} aria-invalid={!!shrErr} onChange={num('sleepHR')} /></Field>
        <Field label="HRV tidur"><div className="seg" role="group" aria-label="HRV">{[['normal', 'Normal'], ['reduced', 'Reduced']].map(([v, l]) => <button key={v} aria-pressed={f.hrv === v} className={f.hrv === v ? 'on ' + v : ''} onClick={() => set({ hrv: f.hrv === v ? '' : v })}>{l}</button>)}</div></Field>
        <Pill5 label="Pegal otot" value={f.doms} onChange={(v) => set({ doms: v })} lo="sangat pegal" hi="tidak pegal" />
        <Pill5 label="Hidrasi / makan" value={f.hydration} onChange={(v) => set({ hydration: v })} lo="kurang" hi="baik" />
        <Field label="TE kemarin"><input inputMode="decimal" type="number" step="0.1" value={f.te} onChange={num('te')} /></Field>
        <Field label="Buffer makan (menit)" hint="≥ 90 sebelum lari"><input inputMode="numeric" type="number" value={f.mealBufferMin} onChange={num('mealBufferMin')} /></Field>
        <Field label="Durasi rencana (menit)"><input inputMode="numeric" type="number" value={f.plannedMin} onChange={num('plannedMin')} /></Field>
        <label className="sw"><input type="checkbox" checked={f.fasted} onChange={(e) => set({ fasted: e.target.checked })} /><span>Lari fasted</span></label>
      </div></details>
    </Card>

    {/* ---- Layer 2.2: load ---- */}
    <h2 className="sech">Beban latihan & risiko cedera</h2>
    {M.state === 'ok' && !M.series.some((d) => d.load) ? <div className="card empty"><b>Belum ada Training Load</b>Hubungkan COROS dan tarik riwayat — panel beban terisi otomatis.</div> : <>
      <div className="score-grid">
        <div><small>Fitness (CTL)</small><b>{cur?.ctl ?? '—'}</b><em>{M.ramp != null ? `${sign(M.ramp)} / 7 hr` : ''}</em></div>
        <div><small>Fatigue (ATL)</small><b>{cur?.atl ?? '—'}</b><em>{prevAtl ? `${sign(Math.round(((cur.atl - prevAtl) / prevAtl) * 100))}% vs mgg lalu` : ''}</em></div>
        <div><small>Form (TSB)</small><b>{sign(cur?.tsb)}</b><em>{fz ? `${cur.tsbPct}% · ${fz.label}` : ''}</em></div>
        <div><small>ACWR ({acwrMode === 'ewma' ? 'EWMA' : '7:28'})</small><b>{acwrShown ?? '—'}</b><em>{acwrShown == null ? 'butuh 35 hr' : acwrShown > 1.5 ? 'tinggi' : acwrShown > 1.3 ? 'waspada' : acwrShown < 0.8 ? 'rendah' : 'sweet spot'}</em></div>
        <div><small>Ramp CTL</small><b>{sign(M.ramp)}</b><em>per 7 hari</em></div>
        <div><small>Monotony · Strain</small><b>{M.mono?.monotony ?? '—'}</b><em>{M.mono?.strain != null ? `strain ${M.mono.strain}` : ''}</em></div>
      </div>
      <Card title="PMC: fitness · fatigue · form" right={<div className="seg" role="group" aria-label="Rentang">{[[42, '6M'], [90, '3B']].map(([d, l]) => <button key={d} aria-pressed={range === d} className={range === d ? 'on' : ''} onClick={() => setRange(d)}>{l}</button>)}</div>}>
        <PMCChart data={pmcData} proj={M.proj} label={`Fitness ${cur?.ctl}, fatigue ${cur?.atl}, form ${cur?.tsb}; proyeksi 14 hari dari rencana`} />
        <div className="legend"><span><i className="ll" style={{ borderColor: 'var(--c-long)' }} />Fitness (CTL)</span><span><i className="ll" style={{ borderColor: 'var(--c-tt)' }} />Fatigue (ATL)</span><span><i className="ll" style={{ borderColor: 'var(--text)' }} />Form % (bawah)</span><span><i className="ll" style={{ borderTopStyle: 'dashed', borderColor: 'var(--muted)' }} />Proyeksi rencana</span></div>
        <Src>[calc] CTL τ42 / ATL τ7 dari COROS Training Load harian; TSB = CTL kemarin − ATL kemarin. Zona form relatif terhadap fitness (konvensi, bukan bukti) karena Training Load COROS bukan skala TSS. Proyeksi = km rencana × TL/km-mu per jenis sesi.</Src>
      </Card>
      <Card title="ACWR" right={<div className="seg" role="group" aria-label="Metode ACWR">{[['ewma', 'EWMA'], ['roll', '7:28']].map(([k, l]) => <button key={k} aria-pressed={acwrMode === k} className={acwrMode === k ? 'on' : ''} onClick={() => setAcwrMode(k)}>{l}</button>)}</div>}>
        <Speedometer value={acwrShown} />
        <BandLine data={M.pmc.slice(-30)} keys={[{ key: 'acwr', color: 'var(--text)' }]} refBand={[0.8, 1.3]} label="ACWR 30 hari dengan pita 0,8–1,3" height={110} />
        <Src>[LITERATURE] EWMA lebih sensitif (Griffin 2020, PMID 31691167; Maupin 2020, PMID 32158285); 0,8–1,3 cenderung risiko terendah. Kritik metodologis: Impellizzeri 2020 (PMID 32502973). Informasi, bukan gate.</Src>
      </Card>
      <Card title="Progresi jarak & beban internal vs eksternal">
        <p><b>{M.prog.cur} km</b> 7 hari terakhir vs {M.prog.prev} km sebelumnya · <Chip tone={pb === 'safe' ? 'green' : pb === 'caution' ? 'yellow' : pb === 'alert' ? 'red' : undefined}>{M.prog.pct == null ? 'belum ada pembanding' : sign(M.prog.pct) + '%'}</Chip></p>
        <Bullet value={M.prog.pct} unit="%" bands={[{ from: -50, to: 10, cls: 'b-safe' }, { from: 10, to: 30, cls: 'b-caution' }, { from: 30, to: 80, cls: 'b-alert' }]} label={`Progresi jarak mingguan ${M.prog.pct}%`} />
        <GroupedBars groups={weeksIE.map((w) => ({ label: w.label, int: Math.round((w.tl / mTl) * 100), ext: Math.round((w.km / mKm) * 100) }))} series={[{ key: 'int', color: 'var(--c-tt)' }, { key: 'ext', color: 'var(--c-long)' }]} label="Beban internal (Training Load) dan eksternal (km), persen dari rata-rata 6 minggu" fmt={(v) => v} />
        <div className="legend"><span><i className="kdot" style={{ background: 'var(--c-tt)' }} />Internal (TL)</span><span><i className="kdot" style={{ background: 'var(--c-long)' }} />Eksternal (km)</span><span className="muted">% dari rata-rata 6 minggu</span></div>
        <Src>Nielsen 2014 (PMID 25155475): &gt;30% per minggu dikaitkan dengan cedera karena jarak — termasuk MTSS (eksploratif, pelari pemula). Ramp CTL ditampilkan tanpa pita (pita +5–7 CTL/mgg adalah konvensi TSS).</Src>
      </Card></>}

    {/* ---- Layer 2.3: autonomic ---- */}
    <h2 className="sech">Sistem saraf otonom</h2>
    <div className="score-grid">
      <div><small>HRV semalam</small><b>{hv.today ?? '—'}</b><em>{hv.enough ? `7 hr ${hv.roll7} ms` : 'butuh 14 hr'}</em></div>
      <div><small>Koridor 60 hr</small><b>{hv.enough ? `${hv.lo}–${hv.hi}` : '—'}</b><em>± 0,5 SD (ln)</em></div>
      <div><small>CV 7 hari</small><b>{hv.cv7 != null ? hv.cv7 + '%' : '—'}</b><em>{hv.flagCv ? 'tidak stabil' : hv.enough ? 'stabil' : ''}</em></div>
      <div><small>Resting HR</small><b>{rh.value ?? '—'}</b><em>{rh.enough ? `${sign(rh.dev)} vs 30 hr` : ''}</em></div>
      <div><small>Status 7 hari</small><b>{hv.enough ? (hv.flagTrend ? 'turun' : 'normal') : '—'}</b><em>{hv.flagDay ? 'hari ini tertekan' : ''}</em></div>
      <div><small>RHR spike</small><b>{rh.enough ? (rh.spike ? 'ya' : 'tidak') : '—'}</b><em>≥ +5 bpm</em></div>
    </div>
    <Card title="Koridor HRV 60 hari">
      <BandLine data={M.hrvSeries} keys={[{ key: 'roll7', color: 'var(--c-long)' }]} band={['lo', 'hi']} dots={{ key: 'hrv', cls: (d) => (d.lo != null && d.hrv < d.lo ? 'low' : '') }} label={`HRV harian dan rata-rata 7 hari dengan koridor ±0,5 SD; terakhir ${hv.today} ms`} />
      <div className="legend"><span><i className="kdot" style={{ background: 'var(--c-long)' }} />HRV harian</span><span><i className="ll" style={{ borderColor: 'var(--c-long)' }} />Rata-rata 7 hari</span><span><i className="kdot" style={{ background: 'var(--green)', opacity: 0.4 }} />Koridor normal</span><span><i className="kdot" style={{ background: 'var(--yellow)' }} />Di bawah koridor</span></div>
      <Src>Plews 2013 (PMID 23852425): pakai rata-rata bergulir dan baseline individual. Titik kuning = penurunan akut (biasa setelah sesi berat); garis 7 hari keluar koridor = sinyal sistemik. Spesifikasi memakai ±0,75 SD; Lumpad memakai ±0,5 SD (smallest worthwhile change).</Src>
    </Card>
    <Card title="Resting HR vs baseline 30 hari"><BandLine data={M.rhrSeries} keys={[{ key: 'rhr', color: 'var(--c-quality)' }, { key: 'base', color: 'var(--muted)', cls: 'dash' }]} label={`Resting HR ${rh.value}, baseline ${rh.base}`} height={110} /></Card>
    <Card title="Kuadran otonom (7 hari)" right={M.quadrant.length ? <Chip tone={quadrantLabel(M.quadrant.at(-1).x, M.quadrant.at(-1).y)[0] === 'purple' ? undefined : quadrantLabel(M.quadrant.at(-1).x, M.quadrant.at(-1).y)[0]}>{quadrantLabel(M.quadrant.at(-1).x, M.quadrant.at(-1).y)[1].split(' · ')[0]}</Chip> : null}>
      {M.quadrant.length ? <><Quadrant points={M.quadrant} /><p className="muted">Hari ini: {quadrantLabel(M.quadrant.at(-1).x, M.quadrant.at(-1).y)[1]}. Deskriptif, bukan diagnosis.</p></> : <p className="muted">Butuh ≥ 14 hari HRV dan 7 hari RHR.</p>}
    </Card>

    {/* ---- Layer 2.4: sleep & musculoskeletal ---- */}
    <h2 className="sech">Tidur & otot</h2>
    <div className="score-grid">
      <div><small>Tidur (asleep)</small><b>{sl.enough ? hm(sl.asleep_min) : '—'}</b><em>{sl.enough ? `${sign(Math.round(sl.vs_need_min))} mnt vs kebutuhan` : ''}</em></div>
      <div><small>Kebutuhan</small><b>{hm(settings.sleepNeedMin || 480)}</b><em>ubah di Profil</em></div>
      <div><small>Efisiensi</small><b>{sl.enough ? sl.eff + '%' : '—'}</b><em>asleep / di kasur</em></div>
      <div><small>Utang 14 hari</small><b>{hm(sl.debt_min)}</b><em>{sl.nights} malam</em></div>
      <div><small>Skor COROS</small><b>{sl.score ?? '—'}</b><em>[COROS]</em></div>
      <div><small>Sleep HR</small><b>{sl.hr_avg ?? '—'}</b><em>&gt; 67 = gate</em></div>
    </div>
    {sl.enough && <Card title="Tahap tidur"><Stacked100 parts={[{ k: 'Deep', v: sl.deep, c: 'var(--c-long)' }, { k: 'REM', v: sl.rem, c: 'var(--c-tt)' }, { k: 'Light', v: sl.light, c: 'color-mix(in srgb, var(--c-long) 40%, var(--surface2))' }, { k: 'Terjaga', v: sl.awake, c: 'var(--c-quality)' }]} label={`Deep ${sl.deep}%, REM ${sl.rem}%, light ${sl.light}%, terjaga ${sl.awake}%`} />
      <Src>Hypnogram dan kurva HR semalam tidak ditampilkan: COROS MCP hanya memberi total per tahap, bukan urutan waktunya.</Src></Card>}
    <Card title="Utang tidur 14 hari"><Waterfall series={sl.series} label={`Selisih tidur vs kebutuhan 14 hari; utang ${Math.round(sl.debt_min / 6) / 10} jam`} />
      <Src>Walsh 2021 (PMID 33144349): kebutuhan tidur individual; &lt; 7 jam kronis menaikkan risiko infeksi. Kebutuhan tidak ditambah otomatis berdasarkan beban — tidak ada rumus berbasis bukti.</Src></Card>
    <Card title="Peta beban otot" right={Object.keys(ov).length ? <button className="link" onClick={() => setOv({})}>Reset manual</button> : null}>
      <BodyMap load={M.muscle} overrides={ov} onTap={tapRegion} />
      <Src>[heuristic] Otomatis dari sesi yang benar-benar dilakukan (gym lower/plyo dari tag rencana, lari dari jenis sesi), meluruh dengan waktu paruh 12–36 jam. Ketuk area untuk mengubah manual (* = manual).</Src></Card>
    <Card title="Kesiapan sistemik vs struktural"><TwinBars a={{ label: 'Sistemik (HRV, RHR, tidur)', v: sys }} b={{ label: 'Struktural (otot, nyeri, tibia)', v: str }} />
      {sys != null && str != null && sys - str >= 25 && <p className="banner">Jantung siap, otot/struktur belum — hindari interval cepat dan hills hari ini.</p>}</Card>

    <Card title="Gate mingguan · ◇ tempo Kamis" tone={wg.blocked ? 'red' : 'green'}>
      <p><b>{wg.blocked ? 'Kamis tetap strides / hills' : 'Tidak ada alasan menahan ◇ tempo'}</b></p>
      <p className="muted">{wg.bad} malam Sleep HR &gt; 67 / HRV Reduced dalam 7 hari{wg.pain ? ' · ada nyeri/tibia positif' : ''}.</p>
    </Card>
  </Screen>
}
