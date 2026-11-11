import { useMemo } from 'react'
import { useStore, useSyncStatus } from './store.js'
import { TARGET, CHECKPOINTS, tone } from './lib/plan.js'
import { paces, fmtPace, fmtTime } from './lib/vdot.js'
import { fmtLong, today, diffDays } from './lib/calendar.js'
import Data from './Data.jsx'
import CorosCard from './CorosCard.jsx'
import { Card, Screen, Chip } from './ui.jsx'
import { useSyncStatus2, wib, ago } from './sync.js'
import { useApi } from './api.js'

const ROLES = [['', 'Belum ditentukan'], ['easy', 'Easy / recovery'], ['daily', 'Daily trainer'], ['plated', 'Plated — quality / long'], ['short', 'Interval pendek']]
const LOCKED = ['Sen Upper · Sel quality + Lower · Rab easy · Kam speed ringan + Lower ringan · Jum easy · Sab LR + full body · Min social/race', 'Lower terakhir Sel 12 Okt · tibialis posisi 1 di setiap Lower · lari ≥6 jam sebelum Lower', 'Sleep HR > 67 = tanpa lari keras · nyeri ≥2/10 = durability event', 'Race C: Jakim FM 13 Jun, MJM FM 20 Jun (hanya jika G-MJM 16 Jun lolos)']
const km = (m) => (m == null ? '—' : Math.round(m / 100) / 10)

export default function Profile({ vdot, results, settings, setSettings }) {
  const [theme, setTheme] = useStore('lumpad.theme', 'auto')
  const sync = useSyncStatus(), ss = useSyncStatus2(), G = useApi('/api/gear'), F = useApi(`/api/readiness?from=${today()}&to=${today()}`)
  const fit = F.data?.fitness, gear = G.data || [], active = gear.filter((g) => !g.retired), retired = gear.filter((g) => g.retired)
  const p = paces(vdot.v), pt = paces(TARGET.vdotNeeded), tts = CHECKPOINTS.filter((c) => c.kind === 'tt' && results[c.id]?.vdot != null)
  const set = (patch) => setSettings({ ...settings, ...patch })
  const toRace = diffDays(settings.raceDate, today())

  return <Screen title="Profil" sub="Sepatu, race, VDOT, koneksi dan pengaturan">
    <h2 className="sech">Sepatu</h2>
    <Card title="Rotasi sepatu" right={<span className="muted">{active.length} aktif</span>}>
      {G.state === 'loading' && <div className="skel" />}
      {G.state === 'ok' && !gear.length && <p className="muted">Belum ditarik — data sepatu datang dari Strava lewat sync.</p>}
      {active.map((g) => <div className="shoe" key={g.id}>
        <div><b>{g.name}</b><small>Terakhir dipakai {g.last_used ? g.last_used.slice(5) : '—'} · tercatat di Lumpad {km(g.tracked_m)} km</small>
          <label className="fld" style={{ marginTop: 6 }}><span className="muted">Peran</span><select value={settings.shoeRoles?.[g.id] || ''} onChange={(e) => set({ shoeRoles: { ...settings.shoeRoles, [g.id]: e.target.value } })}>{ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label></div>
        <div className="km">{km(g.lifetime_m)} km<small style={{ display: 'block', fontWeight: 400 }}>seumur hidup</small></div></div>)}
      {retired.length > 0 && <details className="more"><summary>Pensiun ({retired.length})</summary>{retired.map((g) => <div className="shoe" key={g.id}><div><b>{g.name}</b></div><div className="km">{km(g.lifetime_m)} km</div></div>)}</details>}
      <p className="src-note">Sumber: Strava (jarak seumur hidup per sepatu). Tidak ada rekomendasi yang mengandalkan pembelian baru.</p>
    </Card>

    <h2 className="sech">Race</h2>
    <Card title="Tanggal race A">
      <label className="fld"><span>JRF Full Marathon</span><input type="date" value={settings.raceDate} onChange={(e) => e.target.value && set({ raceDate: e.target.value })} /></label>
      <label className="sw"><input type="checkbox" checked={settings.raceConfirmed} onChange={(e) => set({ raceConfirmed: e.target.checked })} /><span>Tanggal sudah resmi dari panitia</span></label>
      <p className="muted">{fmtLong(settings.raceDate)} · {toRace} hari lagi. {settings.raceDate !== '2027-10-24' && 'Plan, kalender dan checkpoint tetap disusun untuk 24 Okt — menggeser tanggal tidak menggeser plan.'}</p>
    </Card>

    <h2 className="sech">VDOT</h2>
    <Card title="Fitness (VDOT)" right={<Chip>{vdot.src.split(' ')[0]}</Chip>}>
      <dl className="kv">
        <div><dt>Sekarang</dt><dd>{vdot.v.toFixed(1)}</dd></div><div><dt>Baseline</dt><dd>{TARGET.baseline} (10K resmi 1:00:55)</dd></div>
        <div><dt>Race sub-4:00</dt><dd>{TARGET.vdotRace} · MP {TARGET.mp} /km</dd></div><div><dt>Fitness dibutuhkan</dt><dd>{TARGET.vdotNeeded} (rasio 0,95)</dd></div>
      </dl>
      <div className="scroll"><table><thead><tr><th>VDOT</th><th>Easy</th><th>Sub-T</th><th>T</th><th>I</th><th>M</th></tr></thead><tbody>
        {[[vdot.v, p], [TARGET.vdotNeeded, pt]].map(([v, x]) => <tr key={v}><td>{v.toFixed(1)}</td><td>{fmtPace(x.E[1])}–{fmtPace(x.E[0])}</td><td>{fmtPace(x.subT)}</td><td>{fmtPace(x.T)}</td><td>{fmtPace(x.I)}</td><td>{fmtPace(x.M)}</td></tr>)}</tbody></table></div>
      <p className="src-note">[ALGORITHMIC] Daniels–Gilbert. Pace dihitung dari VDOT terbaru, bukan diketik.</p>
      {tts.length > 0 && <><h3>Hasil time trial</h3>{tts.map((c) => { const r = results[c.id], t = tone(r.vdot, c.line); return <div key={c.id} className="shoe"><div><b>CP{c.id} · {c.name}</b><small>{r.time}</small></div><div className="km"><Chip tone={t}>VDOT {r.vdot.toFixed(1)}</Chip></div></div> })}</>}
      {fit && <><h3>Penilaian COROS <Chip>ALGORITHMIC</Chip></h3><dl className="kv">
        <div><dt>VO2max · Running level</dt><dd>{fit.vo2max} · {fit.running_level}</dd></div><div><dt>Threshold pace</dt><dd>{fmtPace(fit.threshold_pace_s_km)} /km</dd></div>
        <div><dt>Prediksi 5K · 10K</dt><dd>{fmtTime(fit.pred_5k_s)} · {fmtTime(fit.pred_10k_s)}</dd></div><div><dt>Prediksi HM · FM</dt><dd>{fmtTime(fit.pred_hm_s)} · {fmtTime(fit.pred_m_s)}</dd></div></dl>
        <p className="src-note">Prediksi COROS = estimasi algoritma; tidak mengalahkan hasil TT-mu. Per {fit.date}.</p></>}
    </Card>

    <h2 className="sech">Koneksi</h2>
    <CorosCard />
    <Card title="Strava" right={<Chip tone={ss?.activities?.n ? 'green' : 'yellow'}>{ss?.activities?.n ? 'tersinkron' : 'belum'}</Chip>}>
      <p className="muted">Aktivitas, cuaca dan sepatu Strava ikut masuk lewat sync. Koneksi Strava langsung (tanpa Claude) belum dibuat — perlu aplikasi Strava API milikmu.</p>
      <dl className="kv"><div><dt>Aktivitas tersimpan</dt><dd>{ss?.activities?.n ?? '—'}{ss?.activities?.n ? ` (${ss.activities.first} → ${ss.activities.last})` : ''}</dd></div></dl>
    </Card>
    <Card title="Sync harian" right={ss?.lastRun && <Chip tone={ss.lastRun.ok ? 'green' : 'yellow'}>{ss.lastRun.ok ? 'OK' : 'ada yang ditolak'}</Chip>}>
      {ss === undefined ? <p className="muted">Memuat…</p> : !ss ? <p className="muted">Status sync tidak tersedia.</p> : <>
        <dl className="kv"><div><dt>Sync terakhir</dt><dd>{ss.lastRun ? `${wib(ss.lastRun.received_at)} WIB · ${ago(ss.lastRun.received_at)}` : 'belum ada'}</dd></div><div><dt>Data tidur terbaru</dt><dd>{ss.latestHealth || 'belum ditarik'}</dd></div><div><dt>Hari kesehatan tersimpan</dt><dd>{ss.healthDays}</dd></div></dl>
        {ss.recent.length > 0 && <details className="more"><summary>Riwayat sync</summary><table><tbody>{ss.recent.map((r) => { const c = JSON.parse(r.counts || '{}'); return <tr key={r.id}><td>{r.received_at.slice(5, 16).replace('T', ' ')}</td><td>{r.trigger}</td><td>{c.health}h · {c.activities}a · {c.laps}l</td><td>{r.ok ? '✓' : c.rejected + ' ditolak'}</td></tr> })}</tbody></table></details>}</>}
    </Card>
    <details className="card fold"><summary>Alat cadangan: Strava API, impor FIT, literatur</summary><Data /></details>

    <h2 className="sech">Atlet & pengaturan</h2>
    <Card title="Atlet"><div className="ath"><span className="avatar">R</span><div><b>Rihan</b><p className="muted">31 th · 178 cm · Bekasi · UESCA-certified</p><p className="muted">COROS Apex 4 + Pod 2 · HR optical wrist</p></div></div>
      <div className="banner">Konflik data: berat badan Strava 86,0 kg vs COROS 75,3 kg (Omron 18 Sep: 75,3 kg). Dipakai: COROS/Omron sampai ditimbang ulang.</div></Card>
    <Card title="Aturan terkunci"><ul className="rules">{LOCKED.map((x) => <li key={x}>{x}</li>)}</ul></Card>
    <Card title="Tampilan"><div className="seg wide">{[['auto', 'Otomatis'], ['light', 'Terang'], ['dark', 'Gelap']].map(([k, l]) => <button key={k} aria-pressed={theme === k} className={theme === k ? 'on' : ''} onClick={() => setTheme(k)}>{l}</button>)}</div></Card>
    <Card title="Sistem"><dl className="kv">
      <div><dt>Sinkron</dt><dd>{{ ok: 'Tersimpan di server', saving: 'Menyimpan…', offline: 'Offline (hanya di browser ini)' }[sync]}</dd></div>
      <div><dt>Backup</dt><dd>Harian 03:15 · 30 hari · di server</dd></div><div><dt>Plan</dt><dd>v4.5 (7 Nov 2026) · 365 hari · {CHECKPOINTS.length} checkpoint</dd></div></dl></Card>
  </Screen>
}
