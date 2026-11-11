import { useStore, useSyncStatus } from './store.js'
import { TARGET, CHECKPOINTS } from './lib/plan.js'
import Data from './Data.jsx'
import { Card, Screen, Chip } from './ui.jsx'
import { useSyncStatus2, wib, ago } from './sync.js'

const ROWS = [['Target', 'Sub-4:00 FM · JRF Min 24 Okt 2027'], ['MP race', '5:41 /km (VDOT 37.9)'], ['Fitness dibutuhkan', '39.9 (rasio 0,95)'], ['Baseline', 'VDOT 31.7 (10K resmi 1:00:55)'], ['Fallback', '4:15 = VDOT 35.2 · 4:30 = VDOT 32.8']]
const LOCKED = ['Sen Upper · Sel quality + Lower · Rab easy · Kam speed ringan + Lower ringan · Jum easy · Sab LR + full body · Min social/race', 'Lower terakhir Sel 12 Okt · tibialis posisi 1 di setiap Lower · lari ≥6 jam sebelum Lower', 'Sleep HR > 67 = tanpa lari keras · nyeri ≥2/10 = durability event', 'Race C: Jakim FM 13 Jun, MJM FM 20 Jun (hanya jika G-MJM 16 Jun lolos)']

export default function Profile({ resetResults }) {
  const [theme, setTheme] = useStore('lumpad.theme', 'auto')
  const sync = useSyncStatus()
  const ss = useSyncStatus2()
  return <Screen title="Profil" sub="Sync, atlet, target, tampilan">
    <Card title="Sync harian" right={ss?.lastRun && <Chip tone={ss.lastRun.ok ? 'green' : 'yellow'}>{ss.lastRun.ok ? 'OK' : 'ada yang ditolak'}</Chip>}>
      {ss === undefined ? <p className="muted">Memuat…</p> : !ss ? <p className="muted">Status sync tidak tersedia.</p> : <>
        <dl className="kv">
          <div><dt>Sync terakhir</dt><dd>{ss.lastRun ? `${wib(ss.lastRun.received_at)} WIB · ${ago(ss.lastRun.received_at)}` : 'belum ada'}</dd></div>
          <div><dt>Data tidur terbaru</dt><dd>{ss.latestHealth || 'belum ditarik'}</dd></div>
          <div><dt>Hari kesehatan tersimpan</dt><dd>{ss.healthDays}</dd></div>
          <div><dt>Aktivitas</dt><dd>{ss.activities.n ? `${ss.activities.n} (${ss.activities.first} → ${ss.activities.last})` : 'belum ada'}</dd></div>
        </dl>
        {ss.recent.length > 0 && <><h3>Riwayat</h3><table><tbody>{ss.recent.map((r) => { const c = JSON.parse(r.counts || '{}'); return <tr key={r.id}><td>{r.received_at.slice(5, 16).replace('T', ' ')}</td><td>{r.trigger}</td><td>{c.health}h · {c.activities}a · {c.laps}l</td><td>{r.ok ? '✓' : c.rejected + ' ditolak'}</td></tr> })}</tbody></table></>}
      </>}
      <p className="muted">Jadwal: setiap hari ±07:50 WIB lewat rutin Claude (COROS + Strava). Sync manual: bilang "sync Lumpad" di sesi Claude ini atau jalankan rutinnya dari aplikasi Claude.</p>
    </Card>
    <Card title="Atlet"><div className="ath"><span className="avatar">R</span><div><b>Rihan</b><p className="muted">31 th · 178 cm · Bekasi · UESCA-certified</p><p className="muted">COROS Apex 4 + Pod 2 · HR optical wrist</p></div></div>
      <div className="banner">Konflik data: berat badan Strava 86,0 kg vs COROS 75,3 kg (Omron 18 Sep: 75,3 kg). Dipakai: COROS/Omron sampai ditimbang ulang.</div></Card>
    <Card title="Target & garis"><dl className="kv">{ROWS.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
      <p className="muted">Laju dibutuhkan 1,02 VDOT/bln ≈ 1,4× laju terbaik teramati (0,74) <Chip>HYPOTHESIS n=2</Chip>. Aplikasi tidak menjamin sub-4.</p></Card>
    <Card title="Aturan terkunci"><ul className="rules">{LOCKED.map((x) => <li key={x}>{x}</li>)}</ul></Card>
    <details className="card fold"><summary>Alat cadangan: Strava API, impor FIT, literatur</summary><Data /></details>
    <Card title="Tampilan"><div className="seg wide">{[['auto', 'Otomatis'], ['light', 'Terang'], ['dark', 'Gelap']].map(([k, l]) => <button key={k} className={theme === k ? 'on' : ''} onClick={() => setTheme(k)}>{l}</button>)}</div></Card>
    <Card title="Sistem"><dl className="kv">
      <div><dt>Sinkron</dt><dd>{{ ok: 'Tersimpan di server', saving: 'Menyimpan…', offline: 'Offline (hanya di browser ini)' }[sync]}</dd></div>
      <div><dt>Backup</dt><dd>Harian 03:15 · 30 hari · di server</dd></div>
      <div><dt>Plan</dt><dd>v4.5 (7 Nov 2026) · 365 hari · {CHECKPOINTS.length} checkpoint</dd></div>
    </dl></Card>
  </Screen>
}
