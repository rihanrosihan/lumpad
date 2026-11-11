import { raceTime, fmtTime } from './lib/vdot.js'
import { PLAN, BY_DATE, today, diffDays, addDays, fmtLong, fmtShort, KIND } from './lib/calendar.js'
import { Card, Chip } from './ui.jsx'

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

export default function Race({ vdot, results, settings, go }) {
  const T = today(), race = settings.raceDate, left = diffDays(race, T)
  const lastTT = Object.entries(results).filter(([, r]) => r?.vdot != null).map(([id, r]) => ({ id: +id, v: r.vdot, date: PLAN.find((d) => d.tags.includes('CP' + id))?.date })).filter((x) => x.date).sort((a, b) => a.date.localeCompare(b.date)).at(-1)
  const anchor = lastTT ? { v: lastTT.v, date: lastTT.date, src: `CP${lastTT.id}` } : { v: 33.0, date: '2027-03-23', src: 'garis CP3 (belum ada TT)' }
  const best = anchor.v + RATE * months(race, anchor.date), req = 39.9
  const gap = raceTime(best * RATIO, FM) - 14400
  const races = PLAN.filter((d) => d.kind === 'race').map((d) => d.date)
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays('2027-10-18', i)).map((d) => BY_DATE[d]).filter(Boolean)
  return <>
    <Card className="sess k-race">
      <div className="sess-top"><Chip kind="race">A-race</Chip>{settings.raceConfirmed ? <Chip tone="green">tanggal resmi</Chip> : <Chip tone="yellow">tanggal belum resmi</Chip>}</div>
      <h2 className="sess-title">JRF Full Marathon</h2>
      <p className="muted">{fmtLong(race)}</p>
      <div className="bigkm"><b>{left > 0 ? left : 0}</b><span>hari lagi</span></div>
      <dl className="pace"><div><dt>Target</dt><dd>sub-4:00 · 5:41 /km</dd></div><div><dt>Fallback (kill gate)</dt><dd>4:15 · 4:30 · finish-first</dd></div></dl>
      {race !== '2027-10-24' && <p className="banner" role="note">Tanggal race diubah dari rencana (24 Okt). Kalender dan checkpoint tetap mengikuti tanggal 24 Okt — susun ulang plan kalau tanggalnya benar-benar bergeser.</p>}
      <p className="src">Ubah tanggal di Profil › Race.</p>
    </Card>

    <Card title="Proyeksi waktu marathon" right={<Chip>HYPOTHESIS n=2</Chip>}>
      <dl className="kv">
        <div><dt>Jalur dibutuhkan</dt><dd>VDOT {req} → {fm(req)}</dd></div>
        <div><dt>Jalur laju terbaik (0,74/bln)</dt><dd>VDOT {best.toFixed(1)} → {fm(best)}</dd></div>
        <div><dt>Kalau race hari ini</dt><dd>VDOT {vdot.v.toFixed(1)} → {fm(vdot.v)}</dd></div>
      </dl>
      <p className={gap > 0 ? 'banner' : 'muted'}>{gap > 0 ? `Di jalur laju terbaik, finis ±${Math.round(gap / 60)} menit di atas 4:00 — target menuntut laju ±1,4× yang pernah teramati. Aplikasi tidak menjamin sub-4.` : 'Di jalur laju terbaik, sub-4:00 tercapai.'}</p>
      <p className="src-note">[calc] Titik awal: {anchor.src} ({anchor.v.toFixed(1)}). Waktu = waktu untuk VDOT × 0,95 (rasio realisasi, sesuai plan). Rasio FM teramati 0,59 (Jakim 2026, confounded) [HYPOTHESIS n=1] tidak dipakai di sini.</p>
    </Card>

    <Card title="Minggu race (W42)">
      {weekDays.map((d) => <button key={d.date} className="rowbtn" onClick={() => go('calendar', d.date)}><span className={`kdot k-${d.kind}`} /><span><b>{d.label || KIND[d.kind].label}</b><small>{fmtLong(d.date)}</small></span><b>{d.km ? d.km + ' km' : ''}</b></button>)}
      <button className="btn sm full" onClick={() => go('calendar', { view: 'cp', id: 18 })}>Gate CP18 (Kam 21 Okt)</button>
    </Card>

    <Card title="Race lain di 2027">
      {races.filter((d) => d !== '2027-10-24').map((d) => { const x = BY_DATE[d]; return <button key={d} className="rowbtn" onClick={() => go('calendar', d)}><span className="kdot k-race" /><span><b>{x.label}</b><small>{fmtLong(d)} · {diffDays(d, T) > 0 ? diffDays(d, T) + ' hari lagi' : 'lewat'}</small></span></button> })}
      <p className="muted">Jakim 13 Jun dan MJM 20 Jun = C-race (run-walk, &lt;6:00, finish-first), bukan tes VDOT. MJM hanya dilari kalau gate G-MJM (Rab 16 Jun: jog 20&apos; nyeri 0/10, Sleep HR ≤67, HRV tidak Reduced) lolos.</p>
    </Card>

    <Card title="Aturan hari-H"><ul className="rules">{RULES.map((r) => <li key={r}>{r}</li>)}</ul></Card>
  </>
}
