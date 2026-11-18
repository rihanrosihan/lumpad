import { raceTime, fmtTime } from './lib/vdot.js'
import { PLAN, BY_DATE, today, diffDays, addDays, fmtLong, fmtShort, KIND } from './lib/calendar.js'
import { Card, Chip, Evidence } from './ui.jsx'
import { useApi } from './api.js'
import { WEEKS } from './lib/calendar.js'
import { BarChart } from './charts.jsx'
import { mean } from './lib/stats.js'
import { useState } from 'react'
import { useStore } from './store.js'
import { Icon } from './ui.jsx'

const RATE = 0.74 // best observed VDOT/month (n=2) — hypothesis, shown as such
const FM = 42195, RATIO = 0.95 // FM time = time for VDOT (ratio × fitness), as in the project plan; checked: 38.2 → 4:08:41 (doc 4:08:32)
const fm = (v) => fmtTime(raceTime(v * RATIO, FM))
const months = (a, b) => Math.max(0, diffDays(a, b) / 30.44)
const RULES = [
  'Buffer makan ≥ 90 menit sebelum start; 0,7 km GI-flush sebelum setiap race.',
  'CHO 30–60 g/jam mulai menit 45 (ramp 40 → 50 → 60 g/jam, dikunci di CP16).',
  '5 km pertama ditahan dengan HR cap — bukan pace.',
  'Pace race 5:41/km baru dipakai setelah CP14 dan CP16 bersih; sebelumnya pace dari slot benchmark terbaru.',
  'Nyeri ≥ 2/10 saat race = durability event: stride pendek, run-walk, finish-first saat itu juga.',
  'Lower terakhir Sel 12 Okt (12 hari sebelum FM). Race week: Sel 2×1 km @MP · Kam gate CP18 · Jum physio ringan · Sab Half = bib jog ≤5 km atau DNS.',
]

// JRF course facts (organiser). COPs are the 2026 edition: same route in 2027, cut-off times may change.
const JRF = { place: 'Gelora Bung Karno Sports Complex, Jakarta', gun: '04:00', cutoffMin: 300, half: '2027-10-23',
  cops: [['COP 1', 18, '06:10'], ['COP 2', 28, '07:20'], ['COP 3', 31.8, '07:45'], ['COP 4', 36.8, '08:20'], ['Finish', 42.195, '09:00']] }
const tod = (s) => +s.slice(0, 2) * 60 + +s.slice(3, 5) // minutes since midnight
const clock = (m) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}.${String(Math.round(m % 60)).padStart(2, '0')}`
const pace = (secPerKm) => `${Math.floor(secPerKm / 60)}:${String(Math.round(secPerKm % 60)).padStart(2, '0')}`
function Cutoffs() {
  const runs = [['sub-4:00', 341], ['fallback 4:30', 4.5 * 3600 / 42.195]] // s/km, even pace
  const rows = JRF.cops.map(([name, km, close]) => {
    const allowed = tod(close) - tod(JRF.gun), need = (allowed * 60) / km
    return { name, km, close, need, at: runs.map(([, p]) => tod(JRF.gun) + (p * km) / 60), margin: runs.map(([, p]) => allowed - (p * km) / 60) }
  })
  const tight = rows.reduce((a, r) => (r.need < a.need ? r : a))
  return <Card title="Cut-off (COP)" right={<Chip tone="yellow">basis COP 2026</Chip>}>
    <div className="scroll" tabIndex={0} role="region" aria-label="Tabel (geser untuk melihat semua kolom)"><table className="zm">
      <thead><tr><th>Titik</th><th>KM</th><th>Tutup</th><th>Pace maks</th><th>Tiba @sub-4</th><th>Tiba @4:30</th></tr></thead>
      <tbody>{rows.map((r) => <tr key={r.name}><td>{r.name}</td><td>{r.km}</td><td>{r.close.replace(':', '.')}</td><td>{pace(r.need)}/km</td>
        {r.at.map((t, i) => <td key={i}>{clock(t)} <small className="muted">(+{Math.round(r.margin[i])}′)</small></td>)}</tr>)}</tbody>
    </table></div>
    <p className="muted">Pace rata-rata paling lambat yang masih lolos semua titik: <b>{pace(tight.need)}/km</b> (paling ketat di {tight.name}). Batas finis {JRF.cutoffMin / 60} jam setelah gun ({JRF.gun.replace(':', '.')} → 09.00 WIB); finis setelahnya = DNF tanpa medali/jersey.</p>
    <p className="banner" role="note">COP dihitung dari jam (time of day), bukan dari waktu chip. Kalau kamu menyeberangi garis start beberapa menit setelah gun, selisih (+menit) di tabel berkurang sebanyak itu. Gerbang runner tutup tepat {JRF.gun.replace(':', '.')} WIB — telat = DNS.</p>
    <Evidence>[calc] Pace rata maks = (jam tutup − {JRF.gun.replace(':', '.')}) ÷ km. Waktu tiba = pace rata-rata konstan (sub-4 5:41/km; 4:30 ≈ {pace(runs[1][1])}/km). COP dari edisi 2026; rute 2027 sama, jam COP bisa berubah — perbarui saat panitia merilis.</Evidence>
  </Card>
}

// Confirmed registrations, keyed by race date. Lives in the synced store (server KV), not in the repo: holds order IDs etc.
function Registration({ date, r, setBib, go }) {
  const T = today()
  return <Card title={r.event} right={<Chip tone="green">terdaftar ✓</Chip>}>
    <p className="muted">{fmtLong(date)} · {diffDays(date, T) > 0 ? diffDays(date, T) + ' hari lagi' : 'lewat'}{r.eventDates ? ` · event ${r.eventDates}` : ''}</p>
    <dl className="kv">
      <div><dt>Jarak</dt><dd>{r.distance}{r.category ? ` · ${r.category}` : ''}</dd></div>
      {r.start && <div><dt>Rute</dt><dd>{r.start} → {r.finish}</dd></div>}
      <div><dt>Nama di BIB</dt><dd>{r.nameOnBib || '—'}</dd></div>
      <div><dt>Jersey</dt><dd>{r.jersey || '—'}</dd></div>
      <div><dt>Order ID</dt><dd>{r.orderId || '—'}</dd></div>
    </dl>
    <label className="fld"><span>Nomor BIB</span><input inputMode="numeric" placeholder="belum keluar" value={r.bib || ''} onChange={(e) => setBib(e.target.value.slice(0, 12))} /></label>
    {r.plan && <p className="muted">{r.plan}</p>}
    <button className="btn sm full" onClick={() => go('calendar', date)}>Lihat di kalender</button>
  </Card>
}

const C_RULES = ['Run-walk, target < 6:00, finish-first — bukan tes VDOT.', 'Pace dan HR cap dari easy, bukan dari VDOT race.', 'Nyeri ≥ 2/10 = durability event: stop atau jalan, jangan dipaksa.', 'Setelah race: 7 hari easy, quality pertama hanya kalau Sleep HR ≤ 67 dan HRV normal.']
function CRace({ date, label, regs, go }) {
  const T = today(), x = BY_DATE[date], reg = regs?.[date], lead = Array.from({ length: 7 }, (_, i) => addDays(date, i - 6)).map((d) => BY_DATE[d]).filter(Boolean)
  const gate = date === '2027-06-20' ? "G-MJM (Rab 16 Jun): jog 20′, nyeri 0/10, Sleep HR ≤ 67, HRV tidak Reduced. MJM hanya dilari kalau gate ini lolos." : null
  return <>
    <Card className="sess k-race">
      <div className="sess-top"><Chip kind="race">C-race</Chip>{reg ? <Chip tone="green">terdaftar ✓</Chip> : <Chip tone="yellow">belum daftar</Chip>}</div>
      <h2 className="sess-title">{label}</h2>
      <p className="muted">{fmtLong(date)}</p>
      <div className="bigkm"><b>{Math.max(0, diffDays(date, T))}</b><span>hari lagi</span></div>
      <ul className="rules">{C_RULES.map((r) => <li key={r}>{r}</li>)}</ul>
      {gate && <p className="banner" role="note">{gate}</p>}
      <button className="btn sm full" onClick={() => go('calendar', date)}>Buka Day Plan hari-H</button>
    </Card>
    <Card title="Seminggu menuju race">
      {lead.map((d) => <button key={d.date} className="rowbtn" onClick={() => go('calendar', d.date)}><span className={`kdot k-${d.kind}`} /><span><b>{d.label || KIND[d.kind].label}</b><small>{fmtLong(d.date)}{d.km ? ` · ${d.km} km` : ''}</small></span><Icon n="chev" size={18} /></button>)}
    </Card>
  </>
}

export default function Race({ vdot, results, settings, go }) {
  const [selDate, setSelDate] = useState(null)
  const [regs, setRegs] = useStore('lumpad.registrations', {})
  const T = today(), race = settings.raceDate, left = diffDays(race, T)
  const lastTT = Object.entries(results).filter(([, r]) => r?.vdot != null).map(([id, r]) => ({ id: +id, v: r.vdot, date: PLAN.find((d) => d.tags.includes('CP' + id))?.date })).filter((x) => x.date).sort((a, b) => a.date.localeCompare(b.date)).at(-1)
  const anchor = lastTT ? { v: lastTT.v, date: lastTT.date, src: `CP${lastTT.id}` } : { v: 33.0, date: '2027-03-23', src: 'garis CP3 (belum ada TT)' }
  const best = anchor.v + RATE * months(race, anchor.date), req = 39.9
  const gap = raceTime(best * RATIO, FM) - 14400
  const races = PLAN.filter((d) => d.kind === 'race').map((d) => d.date)
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays('2027-10-18', i)).map((d) => BY_DATE[d]).filter(Boolean)
  const W = useApi(`/api/activities/merged?from=${addDays(T, -60)}&to=${T}`), wx = (W.data || []).filter((a) => a.sport_class === 'run' && a.temp_c != null)
  const peak = Math.max(...WEEKS.map((w) => w.km)), taper = WEEKS.filter((w) => ['W38', 'W39', 'W40', 'W41', 'W42'].includes(w.id)).map((w) => ({ date: w.id, value: Math.round((w.km / peak) * 100), tick: w.id }))
  const kg = +settings.bodyMassKg || 75.3
  const hub = PLAN.filter((d) => d.kind === 'race' && /FM|Full/.test(d.label || '')).map((d) => ({ date: d.date, label: d.label.replace(/ · .*/, ''), a: d.date === '2027-10-24' })).sort((a, b) => a.date.localeCompare(b.date))
  const nearest = (hub.find((r) => r.date >= T) || hub.at(-1)).date, cur = selDate || nearest, isA = cur === '2027-10-24', curRace = hub.find((r) => r.date === cur)
  return <>
    <div className="racebar" role="group" aria-label="Pilih race (terdekat dulu)">{hub.map((r) => <button key={r.date} aria-pressed={cur === r.date} onClick={() => setSelDate(r.date)}><b>{r.label}</b><small>{fmtShort(r.date)} · D-{Math.max(0, diffDays(r.date, T))}{r.a ? ' · A-race' : ' · C-race'}</small></button>)}</div>
    {!isA && <CRace date={cur} label={curRace.label} regs={regs} go={go} />}
    {isA && <>
    <Card className="sess k-race">
      <div className="sess-top"><Chip kind="race">A-race</Chip>{settings.raceConfirmed ? <Chip tone="green">tanggal resmi</Chip> : <Chip tone="yellow">tanggal belum resmi</Chip>}</div>
      <h2 className="sess-title">JRF Full Marathon</h2>
      <p className="muted">{fmtLong(race)} · start {JRF.gun.replace(':', '.')} WIB · {JRF.place}</p>
      <div className="bigkm"><b>{left > 0 ? left : 0}</b><span>hari lagi</span></div>
      <dl className="pace"><div><dt>Target</dt><dd>sub-4:00 · 5:41 /km</dd></div><div><dt>Fallback (kill gate)</dt><dd>4:15 · 4:30 · finish-first</dd></div></dl>
      <p className="muted">Half marathon: {fmtLong(JRF.half)} (sehari sebelumnya) — di plan cuma bib jog ≤5 km atau DNS.</p>
      {race !== '2027-10-24' && <p className="banner" role="note">Tanggal race diubah dari rencana (24 Okt). Kalender dan checkpoint tetap mengikuti tanggal 24 Okt — susun ulang plan kalau tanggalnya benar-benar bergeser.</p>}
      <p className="src">Ubah tanggal di Profil › Race.</p>
    </Card>

    <Cutoffs />

    <Card title="Proyeksi waktu marathon" right={<Chip>HYPOTHESIS n=2</Chip>}>
      <dl className="kv">
        <div><dt>Jalur dibutuhkan</dt><dd>VDOT {req} → {fm(req)}</dd></div>
        <div><dt>Jalur laju terbaik (0,74/bln)</dt><dd>VDOT {best.toFixed(1)} → {fm(best)}</dd></div>
        <div><dt>Kalau race hari ini</dt><dd>VDOT {vdot.v.toFixed(1)} → {fm(vdot.v)}</dd></div>
      </dl>
      <p className={gap > 0 ? 'banner' : 'muted'}>{gap > 0 ? `Di jalur laju terbaik, finis ±${Math.round(gap / 60)} menit di atas 4:00 — target menuntut laju ±1,4× yang pernah teramati. Aplikasi tidak menjamin sub-4.` : 'Di jalur laju terbaik, sub-4:00 tercapai.'}</p>
      <Evidence>[calc] Titik awal: {anchor.src} ({anchor.v.toFixed(1)}). Waktu = waktu untuk VDOT × 0,95 (rasio realisasi, sesuai plan). Rasio FM teramati 0,59 (Jakim 2026, confounded) [HYPOTHESIS n=1] tidak dipakai di sini.</Evidence>
    </Card>

    <Card title="Taper (dari plan)" right={<span className="muted">% minggu puncak ({peak} km)</span>}>
      <BarChart data={taper} label={'Volume taper: ' + taper.map((t) => `${t.date} ${t.value}%`).join(', ')} />
      <p className="muted">{taper.map((t) => `${t.date} ${t.value}%`).join(' · ')}. Strides race-pace tetap ada (Sel 2×1 km @MP di W42).</p>
    </Card>
    <Card title="Carb-loading 36–48 jam">
      <div className="score-grid"><div><small>Berat badan</small><b>{kg}</b><em>kg (Profil)</em></div><div><small>Target / hari</small><b>{Math.round(kg * 10)}–{Math.round(kg * 12)}</b><em>g karbo</em></div><div><small>Kapan</small><b>Jum–Sab</b><em>22–23 Okt</em></div></div>
      <Evidence>ACSM / AND / DC 2016 (Thomas, Erdman & Burke; PMID 26891166): 10–12 g/kg/24 jam selama 36–48 jam sebelum event &gt; 90 menit. Snack &lt; 90 menit pra-start = low-fiber (aturan project).</Evidence>
    </Card>
    <Card title="Panas & kelembapan">
      <p>Lari pagimu 60 hari terakhir: <b>{wx.length ? `${Math.round(mean(wx.map((a) => a.temp_c)))}°C · RH ${Math.round(mean(wx.map((a) => a.humidity ?? NaN).filter((x) => !Number.isNaN(x))) || 0)}%` : 'cuaca belum ditarik'}</b>{wx.length ? ` (${wx.length} lari dengan data cuaca)` : ''}</p>
      <Evidence>Ely 2007 (PMID 17473775): waktu marathon makin lambat saat WBGT naik dari 5 ke 25 °C, lebih besar untuk pelari yang lebih lambat (pelari top: +1,7% → +4,5%). Kondisi Jakarta kemungkinan di atas rentang studi — tidak ada angka koreksi yang diekstrapolasi. Heat tax-mu sendiri belum diukur (open item 8): catat suhu/RH di setiap CP.</Evidence>
    </Card>
    <Card title="Minggu race (W42)">
      {weekDays.map((d) => <button key={d.date} className="rowbtn" onClick={() => go('calendar', d.date)}><span className={`kdot k-${d.kind}`} /><span><b>{d.label || KIND[d.kind].label}</b><small>{fmtLong(d.date)}</small></span><b>{d.km ? d.km + ' km' : ''}</b></button>)}
      <button className="btn sm full" onClick={() => go('calendar', { view: 'cp', id: 18 })}>Gate CP18 (Kam 21 Okt)</button>
    </Card>

    </>}

    {Object.entries(regs || {}).filter(([d]) => d !== race).sort(([a], [b]) => a.localeCompare(b)).map(([d, r]) => <Registration key={d} date={d} r={r} go={go} setBib={(bib) => setRegs((x) => ({ ...x, [d]: { ...x[d], bib } }))} />)}

    <Card title="Race lain di 2027">
      {races.filter((d) => d !== '2027-10-24').map((d) => { const x = BY_DATE[d], reg = regs?.[d]; return <button key={d} className="rowbtn" onClick={() => go('calendar', d)}><span className="kdot k-race" /><span><b>{x.label}</b><small>{fmtLong(d)} · {diffDays(d, T) > 0 ? diffDays(d, T) + ' hari lagi' : 'lewat'}</small></span>{reg ? <Chip tone="green">terdaftar</Chip> : (x.km >= 21 ? <Chip tone="yellow">belum daftar</Chip> : null)}</button> })}
      <p className="muted">Jakim 13 Jun dan MJM 20 Jun = C-race (run-walk, &lt;6:00, finish-first), bukan tes VDOT. MJM hanya dilari kalau gate G-MJM (Rab 16 Jun: jog 20&apos; nyeri 0/10, Sleep HR ≤67, HRV tidak Reduced) lolos.</p>
    </Card>

    {isA && <Card title="Aturan hari-H"><ul className="rules">{RULES.map((r) => <li key={r}>{r}</li>)}</ul></Card>}
  </>
}
