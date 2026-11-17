import { useMemo, useRef } from 'react'
import { useStore, useSyncStatus } from './store.js'
import { TARGET, CHECKPOINTS, tone } from './lib/plan.js'
import { paces, fmtPace, fmtTime, raceTime } from './lib/vdot.js'
import { fmtLong, today, diffDays, addDays, PLAN } from './lib/calendar.js'
import { tandaMarathon, trainingIndices, prs, shoeStats, SHOE_LIFE } from './lib/analysis.js'
import { mean, r1 } from './lib/stats.js'
import Data from './Data.jsx'
import CorosCard from './CorosCard.jsx'
import { Card, Screen, Chip, Evidence } from './ui.jsx'
import { GLOSSARY } from './lib/glossary.js'
import { useSyncStatus2, wib, ago } from './sync.js'
import { useApi } from './api.js'
import { BandLine, Donut, GroupedBars } from './charts2.jsx'

const ROLES = [['', 'Belum ditentukan'], ['easy', 'Easy / recovery'], ['daily', 'Daily trainer'], ['plated', 'Plated — quality / long / race'], ['short', 'Interval pendek']]
const RULES = [['Race & TT', 'plated'], ['Tempo / threshold', 'plated'], ['Long run', 'daily'], ['Interval pendek / strides', 'short'], ['Easy / recovery', 'easy']]
const LOCKED = ['Sen Upper · Sel quality + Lower · Rab easy · Kam speed ringan + Lower ringan · Jum easy · Sab LR + full body · Min social/race', 'Lower terakhir Sel 12 Okt · tibialis posisi 1 di setiap Lower · lari ≥6 jam sebelum Lower', 'Sleep HR > 67 = tanpa lari keras · nyeri ≥2/10 = durability event']
const SHOE_C = ['var(--c-long)', 'var(--c-quality)', 'var(--c-tt)', 'var(--green)', 'var(--c-social)', 'var(--c-rest)']
// collapsible groups with jump chips; open state is remembered (synced like other settings), only Koneksi opens by default
const GROUPS = [['vdot', 'VDOT & zona'], ['shoe', 'Sepatu'], ['race', 'Race & tubuh'], ['conn', 'Perangkat & koneksi'], ['athlete', 'Atlet & pengaturan']]
const Group = ({ id, title, open, setOpen, children }) => <details className="pgroup" id={'g-' + id} open={!!open} onToggle={(e) => { if (e.currentTarget.open !== !!open) setOpen(id, e.currentTarget.open) }}><summary>{title}</summary><div className="gbody">{children}</div></details>
const km = (m) => (m == null ? '—' : Math.round(m / 100) / 10)

export default function Profile({ vdot, results, settings, setSettings }) {
  const T = today(), [theme, setTheme] = useStore('lumpad.theme', 'auto')
  const sync = useSyncStatus(), ss = useSyncStatus2(), G = useApi('/api/gear'), R = useApi(`/api/readiness?from=${addDays(T, -30)}&to=${T}`)
  const A = useApi(`/api/activities/merged?from=${addDays(T, -365)}&to=${T}`), L = useApi(`/api/laps?from=${addDays(T, -365)}&to=${T}`), Dv = useApi('/api/kv?key=lumpad.devices')
  const set = (patch) => setSettings({ ...settings, ...patch })
  const fit = R.data?.fitness, acts = A.data || [], gear = G.data || [], active = gear.filter((g) => !g.retired), retired = gear.filter((g) => g.retired)
  const p = paces(vdot.v), pt = paces(TARGET.vdotNeeded)
  const allLaps = Object.values(L.data || {}).flat(), hrmax = Math.max(0, ...allLaps.map((l) => l.max_hr || 0), ...acts.map((a) => a.max_hr || 0)) || null
  const rhrBase = mean((R.data?.health || []).map((h) => h.resting_hr)), toRace = diffDays(settings.raceDate, T)
  // VDOT history: baseline + every TT
  const vhist = [{ date: '2026-10-01', v: TARGET.baseline }, ...CHECKPOINTS.filter((c) => results[c.id]?.vdot != null).map((c) => ({ date: c.date, v: Math.round(results[c.id].vdot * 10) / 10 }))]
  // race equivalency: VDOT theoretical vs endurance-adjusted (Tanda 2013, marathon only) vs COROS
  const ti = trainingIndices(acts, T, 8), tanda = tandaMarathon(ti.K, ti.P, settings.bodyFatPct === '' ? null : +settings.bodyFatPct)
  const eq = [['5K', 5000, 'pred_5k_s'], ['10K', 10000, 'pred_10k_s'], ['Half', 21097.5, 'pred_hm_s'], ['FM', 42195, 'pred_m_s']].map(([l, d, k]) => ({ label: l, vdot: Math.round(raceTime(vdot.v, d) / 60), endur: l === 'FM' && tanda ? Math.round(tanda) : null, coros: fit?.[k] ? Math.round(fit[k] / 60) : null }))
  // PRs: best 1 km lap + whole activities near standard distances
  const best1k = allLaps.filter((l) => l.distance_m >= 990 && l.duration_s).reduce((b, l) => (!b || l.duration_s < b.duration_s ? l : b), null)
  const pr = prs(acts, best1k ? { time: Math.round(best1k.duration_s * (1000 / best1k.distance_m)), date: acts.find((a) => a.id === best1k.activity_id)?.date } : null)
  const shoeRows = active.map((g, i) => { const role = settings.shoeRoles?.[g.id] || '', life = +(settings.shoeLife?.[g.id] || SHOE_LIFE[role] || SHOE_LIFE['']), used = g.lifetime_m / 1000, f = used / life, st = shoeStats(acts, g.id, T)
    return { ...g, role, life, used, f, st, c: SHOE_C[i % SHOE_C.length] } })
  const exp = (what, fmt) => `/api/export?what=${what}&format=${fmt}`

  const [openG, setOpenG] = useStore('lumpad.profile.open', { conn: true }), setOpen = (id, v) => setOpenG((o) => ({ ...o, [id]: v }))
  const jump = (id) => { setOpen(id, true); setTimeout(() => { const el = document.getElementById('g-' + id); el?.scrollIntoView({ behavior: 'smooth', block: 'start' }); el?.querySelector('summary')?.focus({ preventScroll: true }) }, 60) }
  return <Screen title="Profil" sub="Mesin atlet, garasi sepatu, koneksi">
    <nav className="chipjump" aria-label="Lompat ke bagian">{GROUPS.map(([id, t]) => <button key={id} onClick={() => jump(id)}>{t}</button>)}</nav>
    <Group id="vdot" title="VDOT & zona" open={openG.vdot} setOpen={setOpen}>
    {/* 1. VDOT & thresholds */}
    <Card title="VDOT & ambang" right={<Chip>{vdot.src.split(' ')[0]}</Chip>}>
      <div className="score-grid">
        <div><small>VDOT</small><b>{vdot.v.toFixed(1)}</b><em>target {TARGET.vdotNeeded}</em></div>
        <div><small>T-pace</small><b>{fmtPace(p.T)}</b><em>{fit?.threshold_pace_s_km ? `COROS ${fmtPace(fit.threshold_pace_s_km)}` : '/km'}</em></div>
        <div><small>LTHR</small><b>—</b><em>belum ada sumber</em></div>
        <div><small>HR maks</small><b>{hrmax ?? '—'}</b><em>tertinggi tercatat</em></div>
        <div><small>RHR baseline</small><b>{rhrBase ? r1(rhrBase) : '—'}</b><em>30 hari</em></div>
        <div><small>VO2max</small><b>{fit?.vo2max ?? '—'}</b><em>[COROS]</em></div>
      </div>
      <h3>Progres VDOT</h3>
      {vhist.length > 1 ? <BandLine data={vhist.map((h) => ({ date: h.date, v: h.v, need: null }))} keys={[{ key: 'v', color: 'var(--c-long)' }]} height={110} label={'Progres VDOT: ' + vhist.map((h) => `${h.date} ${h.v}`).join(', ')} /> : <p className="muted">Baseline {TARGET.baseline} — kurva terisi setelah TT pertama (CP1, 16 Jan).</p>}
    </Card>

    <Card title="Matriks zona latihan">
      <div className="scroll"><table className="zm"><thead><tr><th>Zona</th><th>Pace sekarang</th><th>Pace target</th><th>HR (% maks)</th></tr></thead><tbody>
        {[['E · Easy', `${fmtPace(p.E[1])}–${fmtPace(p.E[0])}`, `${fmtPace(pt.E[1])}–${fmtPace(pt.E[0])}`, [0.6, 0.79], 'var(--green)'], ['M · Marathon', fmtPace(p.M), fmtPace(pt.M), [0.8, 0.86], 'var(--c-long)'], ['T · Threshold', fmtPace(p.T), fmtPace(pt.T), [0.87, 0.92], 'var(--yellow)'], ['I · Interval', fmtPace(p.I), fmtPace(pt.I), [0.93, 1], 'var(--c-quality)'], ['R · Repetition', fmtPace(p.R), fmtPace(pt.R), null, 'var(--red)']]
          .map(([z, a, b, hr, c]) => <tr key={z}><td><i className="zc" style={{ background: c }} />{z}</td><td>{a}</td><td>{b}</td><td>{hr && hrmax ? `${Math.round(hr[0] * hrmax)}–${Math.round(hr[1] * hrmax)}` : hr ? `${hr[0] * 100}–${hr[1] * 100}%` : '—'}</td></tr>)}</tbody></table></div>
      <Evidence>Pace: Daniels–Gilbert [ALGORITHMIC]; target = VDOT {TARGET.vdotNeeded}. HR: rentang %HR maks gaya Daniels × HR maks tercatat (estimasi, bukan tes lab).</Evidence>
    </Card>

    <Card title="Prediksi race: kecepatan vs daya tahan">
      <GroupedBars groups={eq} series={[{ key: 'vdot', color: 'var(--c-long)' }, { key: 'endur', color: 'var(--c-quality)' }, { key: 'coros', color: 'var(--c-rest)' }]} fmt={(v) => (v >= 60 ? `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}` : v + "'")} label={'Prediksi menit: ' + eq.map((e) => `${e.label} VDOT ${e.vdot}, daya tahan ${e.endur ?? '-'}, COROS ${e.coros ?? '-'}`).join('; ')} />
      <div className="legend"><span><i className="kdot" style={{ background: 'var(--c-long)' }} />VDOT teoretis</span><span><i className="kdot" style={{ background: 'var(--c-quality)' }} />Disesuaikan daya tahan (FM)</span><span><i className="kdot" style={{ background: 'var(--c-rest)' }} />COROS</span></div>
      {tanda && <p className={tanda * 60 > raceTime(vdot.v, 42195) + 300 ? 'banner' : 'muted'}>FM: VDOT {fmtTime(raceTime(vdot.v, 42195))} vs volume-latihanmu {fmtTime(tanda * 60)} → {tanda * 60 > raceTime(vdot.v, 42195) + 300 ? 'pembatasnya daya tahan (volume), bukan kecepatan.' : 'kecepatan dan daya tahan seimbang.'}</p>}
      <Evidence>Tanda & Knechtle 2013 (PMID 24379719; r = 0,81; valid 165–266 menit): K = {ti.K ?? '—'} km/mgg, P = {ti.P ? fmtPace(ti.P) : '—'} /km (8 minggu, {ti.runs} lari){settings.bodyFatPct === '' ? '; tanpa lemak tubuh — isi di bawah untuk rumus lengkap' : `; lemak tubuh ${settings.bodyFatPct}%`}. Hanya marathon; tidak ada model sebanding untuk 5K–HM.</Evidence>
    </Card>

    <Card title="Rekor pribadi">
      <div className="prs">{[['1K', 1000], ['5K'], ['10K'], ['Half'], ['Marathon']].map(([k]) => <div key={k}><small>{k}</small><b>{pr[k] ? fmtTime(pr[k].time) : '—'}</b><small>{pr[k]?.date ? pr[k].date.slice(2) : 'belum ada'}</small></div>)}
        {['400m', 'Mile', '15K', '10 mil', '20K'].map((k) => <div key={k}><small>{k}</small><b>—</b><small>butuh data per detik</small></div>)}</div>
      <Evidence>Dari data yang benar-benar ada: 1K = lap 1 km tercepat; 5K–FM = aktivitas utuh dengan jarak ±2%. Jarak lain butuh stream detik (belum ditarik).</Evidence>
    </Card>

    {/* 2. Shoe garage */}
    </Group>
    <Group id="shoe" title="Sepatu" open={openG.shoe} setOpen={setOpen}>
    <Card title="Umur pakai" right={<span className="muted">{active.length} aktif</span>}>
      {G.state === 'ok' && !gear.length && <p className="muted">Belum ditarik — sepatu datang dari Strava.</p>}
      {shoeRows.map((g) => <div className="shoe" key={g.id}><div style={{ flex: 1, minWidth: 0 }}>
        <b>{g.name}</b><small>{ROLES.find((r) => r[0] === g.role)?.[1]} · {g.st.runs} lari tercatat{g.st.avgPace ? ` · rata-rata ${fmtPace(g.st.avgPace)}/km` : ''}</small>
        <div className="life" role="img" aria-label={`${Math.round(g.used)} dari ${g.life} km`}><i className={g.f > 0.9 ? 'hi' : g.f > 0.7 ? 'mid' : 'ok'} style={{ width: Math.min(100, g.f * 100) + '%' }} /></div>
        <div className="form" style={{ marginTop: 6 }}><label className="fld"><span className="muted">Peran</span><select value={g.role} onChange={(e) => set({ shoeRoles: { ...settings.shoeRoles, [g.id]: e.target.value } })}>{ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
          <label className="fld"><span className="muted">Target umur (km)</span><input inputMode="numeric" type="number" value={settings.shoeLife?.[g.id] ?? ''} placeholder={String(SHOE_LIFE[g.role] || SHOE_LIFE[''])} onChange={(e) => set({ shoeLife: { ...settings.shoeLife, [g.id]: e.target.value } })} /></label></div></div>
        <div className="km">{Math.round(g.used)}<small style={{ display: 'block', fontWeight: 400 }}>/ {g.life} km</small></div></div>)}
      {retired.length > 0 && <details className="more"><summary>Pensiun ({retired.length})</summary>{retired.map((g) => <div className="shoe" key={g.id}><div><b>{g.name}</b></div><div className="km">{km(g.lifetime_m)} km</div></div>)}</details>}
      <Evidence>Hijau &lt; 70% · kuning 70–90% · merah &gt; 90% dari target umur. Target umur = konvensi yang bisa diubah: tidak ada umur sepatu yang tervalidasi dalam km.</Evidence>
    </Card>
    <Card title="Rotasi 30 / 90 hari">
      <div className="row2">{[['30 hari', 'km30'], ['90 hari', 'km90']].map(([l, k]) => <div key={k}><h3>{l}</h3><Donut parts={shoeRows.filter((g) => g.st[k] > 0).map((g) => ({ k: g.name.split(' ').slice(1).join(' ') || g.name, v: g.st[k], c: g.c }))} label={`Km per sepatu ${l}`} /></div>)}</div>
      <Evidence>Malisoux 2015: memakai lebih dari satu sepatu secara paralel = faktor pelindung (HR 0,61) pada 264 pelari rekreasi.</Evidence>
    </Card>
    <Card title="Aturan sepatu default">
      {RULES.map(([t, r]) => { const s = active.filter((g) => settings.shoeRoles?.[g.id] === r); return <div key={t} className="prow"><span>{t}</span><b>{s.length ? s.map((x) => x.name).join(', ') : '—'}</b><small>peran: {ROLES.find((x) => x[0] === r)[1]}</small></div> })}
      <p className="muted">Home memilih sepatu dengan peran yang cocok dan paling lama tidak dipakai (mendorong rotasi).</p>
    </Card>

    {/* 3. Race & personal settings */}
    </Group>
    <Group id="race" title="Race & tubuh" open={openG.race} setOpen={setOpen}>
    <Card title="Tanggal race A">
      <label className="fld"><span>JRF Full Marathon</span><input type="date" value={settings.raceDate} onChange={(e) => e.target.value && set({ raceDate: e.target.value })} /></label>
      <label className="sw"><input type="checkbox" checked={settings.raceConfirmed} onChange={(e) => set({ raceConfirmed: e.target.checked })} /><span>Tanggal sudah resmi dari panitia</span></label>
      <p className="muted">{fmtLong(settings.raceDate)} · {toRace} hari lagi. {settings.raceDate !== '2027-10-24' && 'Plan dan checkpoint tetap disusun untuk 24 Okt.'}</p>
    </Card>
    <Card title="Tubuh & tidur">
      <div className="form">
        <label className="fld"><span>Kebutuhan tidur (jam)</span><input inputMode="decimal" type="number" step="0.25" value={(settings.sleepNeedMin || 480) / 60} onChange={(e) => e.target.value && set({ sleepNeedMin: Math.round(+e.target.value * 60) })} /><small>Walsh 2021: individual, bukan 7–9 jam untuk semua</small></label>
        <label className="fld"><span>Berat badan (kg)</span><input inputMode="decimal" type="number" step="0.1" value={settings.bodyMassKg} onChange={(e) => set({ bodyMassKg: e.target.value })} /><small>untuk carb-loading</small></label>
        <label className="fld"><span>Lemak tubuh (%) — opsional</span><input inputMode="decimal" type="number" step="0.5" value={settings.bodyFatPct} onChange={(e) => set({ bodyFatPct: e.target.value })} /><small>untuk prediksi Tanda</small></label>
      </div>
      <div className="banner">Konflik data berat: Strava 86,0 kg vs COROS/Omron 75,3 kg — default 75,3 kg sampai ditimbang ulang.</div>
    </Card>

    {/* 4. Hardware & pipelines */}
    </Group>
    <Group id="conn" title="Perangkat & koneksi" open={openG.conn} setOpen={setOpen}>
    <Card title="Perangkat">
      {(Dv.data?.value?.devices || ['COROS APEX 4 42mm', 'COROS POD 2']).map((d) => <div key={d} className="apipill"><i className="dot2 on" /><span>{d}</span><small className="muted">baterai: tidak tersedia</small></div>)}
      <Evidence>{Dv.data?.found ? `Dari COROS, ${ago(Dv.data.value.at)}.` : 'Dari sesi pertama; diperbarui setiap sync langsung.'} COROS MCP tidak memberi status baterai.</Evidence>
    </Card>
    <CorosCard />
    <Card title="Pipeline data">
      {[['COROS (langsung)', 'lihat kartu di atas', null], ['Strava', ss?.activities?.n ? `${ss.activities.n} aktivitas · terakhir ${ss.activities.last}` : 'belum', ss?.activities?.n ? 'on' : 'off'], ['Sync harian', ss?.lastRun ? `${wib(ss.lastRun.received_at)} WIB · ${ago(ss.lastRun.received_at)}` : 'belum ada', ss?.lastRun ? (ss.lastRun.ok ? 'on' : 'warn') : 'off'], ['Apple Health / Health Connect', 'tidak terhubung', 'off'], ['Garmin Connect', 'tidak dipakai', 'off']]
        .filter((x) => x[2]).map(([n, d, s]) => <div key={n} className="apipill"><i className={'dot2 ' + s} /><span>{n}</span><small className="muted">{d}</small></div>)}
      <h3>Ekspor data</h3>
      <div className="row2"><a className="btn sm" href={exp('activities', 'csv')}>Aktivitas CSV</a><a className="btn sm" href={exp('activities', 'json')}>Aktivitas JSON</a><a className="btn sm" href={exp('health', 'csv')}>Kesehatan CSV</a><a className="btn sm" href={exp('health', 'json')}>Kesehatan JSON</a></div>
    </Card>
    <details className="card fold"><summary>Alat cadangan: Strava API, impor FIT, literatur</summary><Data /></details>

    </Group>
    <Group id="athlete" title="Atlet & pengaturan" open={openG.athlete} setOpen={setOpen}>
    <Card title="Atlet"><div className="ath"><span className="avatar">R</span><div><b>Rihan</b><p className="muted">31 th · 178 cm · Bekasi · UESCA-certified</p></div></div></Card>
    <Card title="Aturan terkunci"><ul className="rules">{LOCKED.map((x) => <li key={x}>{x}</li>)}</ul></Card>
    <Card title="Tampilan"><div className="seg wide">{[['auto', 'Otomatis'], ['light', 'Terang'], ['dark', 'Gelap']].map(([k, l]) => <button key={k} aria-pressed={theme === k} className={theme === k ? 'on' : ''} onClick={() => setTheme(k)}>{l}</button>)}</div></Card>
    <Card title="Istilah & singkatan"><details className="more"><summary>{Object.keys(GLOSSARY).length} istilah</summary><dl className="gloss">{Object.values(GLOSSARY).map(([t, d]) => <div key={t}><dt>{t}</dt><dd>{d}</dd></div>)}</dl></details></Card>
    <Card title="Sistem"><dl className="kv"><div><dt>Sinkron</dt><dd>{{ ok: 'Tersimpan di server', saving: 'Menyimpan…', offline: 'Offline (hanya di browser ini)' }[sync]}</dd></div><div><dt>Backup</dt><dd>Harian 03:15 · 30 hari</dd></div><div><dt>Model readiness</dt><dd>docs/readiness-model.md</dd></div></dl></Card>
    </Group>
  </Screen>
}
