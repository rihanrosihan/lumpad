import { useStore, useSyncStatus } from './store.js'
import { TARGET, CHECKPOINTS } from './lib/plan.js'
import Data from './Data.jsx'
import { Card, Screen, Chip } from './ui.jsx'

const ROWS = [['Target', 'Sub-4:00 FM · JRF Min 24 Okt 2027'], ['MP race', '5:41 /km (VDOT 37.9)'], ['Fitness dibutuhkan', '39.9 (rasio 0,95)'], ['Baseline', 'VDOT 31.7 (10K resmi 1:00:55)'], ['Fallback', '4:15 = VDOT 35.2 · 4:30 = VDOT 32.8']]
const LOCKED = ['Sen Upper · Sel quality + Lower · Rab easy · Kam speed ringan + Lower ringan · Jum easy · Sab LR + full body · Min social/race', 'Lower terakhir Sel 12 Okt · tibialis posisi 1 di setiap Lower · lari ≥6 jam sebelum Lower', 'Sleep HR > 67 = tanpa lari keras · nyeri ≥2/10 = durability event', 'Race C: Jakim FM 13 Jun, MJM FM 20 Jun (hanya jika G-MJM 16 Jun lolos)']

export default function Profile({ resetResults }) {
  const [theme, setTheme] = useStore('lumpad.theme', 'auto')
  const sync = useSyncStatus()
  return <Screen title="Profil" sub="Atlet, target, sumber data, tampilan">
    <Card title="Atlet"><div className="ath"><span className="avatar">R</span><div><b>Rihan</b><p className="muted">31 th · 178 cm · Bekasi · UESCA-certified</p><p className="muted">COROS Apex 4 + Pod 2 · HR optical wrist</p></div></div>
      <div className="banner">Konflik data: berat badan Strava 86,0 kg vs COROS 75,3 kg (Omron 18 Sep: 75,3 kg). Dipakai: COROS/Omron sampai ditimbang ulang.</div></Card>
    <Card title="Target & garis"><dl className="kv">{ROWS.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
      <p className="muted">Laju dibutuhkan 1,02 VDOT/bln ≈ 1,4× laju terbaik teramati (0,74) <Chip>HYPOTHESIS n=2</Chip>. Aplikasi tidak menjamin sub-4.</p></Card>
    <Card title="Aturan terkunci"><ul className="rules">{LOCKED.map((x) => <li key={x}>{x}</li>)}</ul></Card>
    <h2 className="sec">Sumber data</h2>
    <Data />
    <Card title="Tampilan"><div className="seg wide">{[['auto', 'Otomatis'], ['light', 'Terang'], ['dark', 'Gelap']].map(([k, l]) => <button key={k} className={theme === k ? 'on' : ''} onClick={() => setTheme(k)}>{l}</button>)}</div></Card>
    <Card title="Sistem"><dl className="kv">
      <div><dt>Sinkron</dt><dd>{{ ok: 'Tersimpan di server', saving: 'Menyimpan…', offline: 'Offline (hanya di browser ini)' }[sync]}</dd></div>
      <div><dt>Backup</dt><dd>Harian 03:15 · 30 hari · di server</dd></div>
      <div><dt>Plan</dt><dd>v4.5 (7 Nov 2026) · 365 hari · {CHECKPOINTS.length} checkpoint</dd></div>
    </dl></Card>
  </Screen>
}
