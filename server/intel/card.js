// Episode card: deterministic template (no LLM), ≤ ~200 words, every number carries its evidence meaning. Plus the numeric fingerprint.
const f = (x, d = 0) => (x == null || Number.isNaN(x) ? '—' : (+x).toFixed(d))
export const mmss = (s) => (s == null || !isFinite(s) ? '—' : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`)
const hm = (s) => `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(Math.round(s % 60)).padStart(2, '0')}`
const dow = (d) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(d + 'T12:00:00Z').getUTCDay()]

export function buildCard({ date, startHour, m, weather, health, log, shoe, plan, similar, race }) {
  const L = []
  const t = startHour != null ? ` ${String(Math.floor(startHour)).padStart(2, '0')}:${String(Math.round((startHour % 1) * 60)).padStart(2, '0')}` : ''
  L.push(`[EPISODE ${race ? 'race' : 'run'} ${date} ${dow(date)}${t} WIB${plan?.phase ? ` · ${plan.phase} ${plan.week || ''}` : ''}${plan?.label ? ` · planned ${plan.label}${plan.km ? ' ' + plan.km + ' km' : ''}` : ''}]`)
  const cond = weather && !weather.indoor ? `${f(weather.temp_c, 1)} °C RH ${f(weather.rh)} % WBGT≈${f(weather.wbgt, 1)} [calc]` : weather?.indoor ? 'indoor/treadmill' : `device ${f(m.temp_device_c)} °C`
  L.push(`${f(m.distance_m / 1000, 2)} km in ${hm(m.elapsed_s)} · ${cond} · +${f(m.gain_m)} m${shoe ? ` · ${shoe.name} (${f(shoe.km)} km)` : ''}`)
  L.push(`Run share ${f(m.run_share * 100)} % (run ${mmss(m.run_s)}, walk ${mmss(m.walk_s)}, stop ${mmss(m.stop_s)}) · run pace ${mmss(m.run_pace)}/km @ HR ${f(m.run_hr)} · EF ${f(m.ef, 3)} · economy ${f(m.economy_jm, 1)} J/m [ALGORITHMIC power]`)
  const d = m.drift_pahr?.value != null ? `Pa:HR drift ${f(m.drift_pahr.value, 1)} %` : m.run_phase_drift?.value != null ? `run-phase drift ${f(m.run_phase_drift.value, 1)} %` : `drift n/a (${m.drift_pahr?.why || m.run_phase_drift?.why || 'short'})`
  L.push(d)
  if (m.bio_fade) L.push(`Late-run fade (last vs first quarter of running): GCT ${m.bio_fade.gct_ms >= 0 ? '+' : ''}${f(m.bio_fade.gct_ms)} ms · stride ${f(m.bio_fade.stride_m, 3)} m · vertical ratio ${f(m.bio_fade.vratio_pct, 2)} % · cadence ${f(m.bio_fade.cadence, 1)} spm · power ${f(m.bio_fade.power_w)} W`)
  if (m.fade_onset?.km) L.push(`Fade onset km ${m.fade_onset.km} (${m.fade_onset.trigger})${m.mech_abs_km ? ` · absolute 03.9 mechanical trigger km ${m.mech_abs_km}` : ''}`)
  if (m.hr_at_800 != null) L.push(`HR@8:00 ${f(m.hr_at_800, 1)} (baseline 143.1 ± 5.0; z ${f((m.hr_at_800 - 143.1) / 5.0, 1)}) [${m.hr_at_800_min} steady min]`)
  if (m.open_hr_first_hour != null && m.distance_m > 15000) L.push(`Opening HR first hour ${f(m.open_hr_first_hour)}`)
  const rd = []; if (health?.hrv_avg != null) rd.push(`HRV ${f(health.hrv_avg)}${health.hrv_baseline != null ? ` (baseline ${f(health.hrv_baseline)})` : ''}`)
  if (health?.sleep_hr_avg != null) rd.push(`Sleep HR ${f(health.sleep_hr_avg)}`); if (health?.resting_hr != null) rd.push(`RHR ${f(health.resting_hr)}`)
  if (log?.pain) { const w = Object.entries(JSON.parse(typeof log.pain === 'string' ? log.pain : JSON.stringify(log.pain))).filter(([, v]) => v > 0); rd.push(w.length ? 'pain ' + w.map(([k, v]) => `${k} ${v}/10`).join(', ') : 'pain 0/10') }
  if (rd.length) L.push('Morning: ' + rd.join(' · '))
  const flags = []
  if (health?.sleep_hr_avg > 67) flags.push('Sleep HR>67 gate'); if (log?.pain && Math.max(0, ...Object.values(JSON.parse(typeof log.pain === 'string' ? log.pain : JSON.stringify(log.pain)))) >= 2) flags.push('pain≥2 durability event')
  if (m.hr_at_800 != null && m.hr_at_800 > 153.9) flags.push('HR@8:00 above Jan–Sep baseline max')
  if (weather && !weather.indoor && weather.wbgt >= 28) flags.push('WBGT≥28 [calc]')
  L.push(`Flags: ${flags.length ? flags.join('; ') : 'none'}` + (similar?.length ? ` · Similar: ${similar.map((s) => `${s.date} ${f(s.distance_m / 1000, 1)} km (EF ${f(s.ef, 3)})`).join(', ')}` : ''))
  return L.join('\n')
}

// numeric fingerprint for "runs like this one" (z-scored over all sessions at query time; missing → 0 = the mean)
export const FEATURES = ['log_dist', 'log_dur', 'run_pace', 'run_hr', 'ef', 'run_share', 'drift', 'gct_fade', 'stride_fade', 'vr_fade', 'temp', 'gain_km', 'tl_min', 'hrv_dev']
export function features(m, { tl, temp, hrvDev } = {}) {
  const d = m.distance_m || 0, dur = m.elapsed_s || 0
  return { log_dist: Math.log(d + 1), log_dur: Math.log(dur + 1), run_pace: m.run_pace, run_hr: m.run_hr, ef: m.ef, run_share: m.run_share,
    drift: m.drift_pahr?.value ?? m.run_phase_drift?.value ?? null, gct_fade: m.bio_fade?.gct_ms ?? null, stride_fade: m.bio_fade?.stride_m ?? null, vr_fade: m.bio_fade?.vratio_pct ?? null,
    temp: temp ?? m.temp_device_c ?? null, gain_km: d > 500 ? (m.gain_m || 0) / (d / 1000) : null, tl_min: tl != null && dur > 0 ? tl / (dur / 60) : null, hrv_dev: hrvDev ?? null }
}
export function zMatrix(rows) { // rows: [{features}] → {z: Float64Array[], mean, sd}
  const mean = {}, sd = {}
  for (const k of FEATURES) { const v = rows.map((r) => r[k]).filter((x) => x != null && isFinite(x)); const m = v.reduce((s, x) => s + x, 0) / (v.length || 1); mean[k] = m; sd[k] = Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, v.length - 1)) || 1 }
  return { mean, sd, z: (r) => FEATURES.map((k) => (r[k] != null && isFinite(r[k]) ? (r[k] - mean[k]) / sd[k] : 0)) }
}
export const cosine = (a, b) => { let d = 0, x = 0, y = 0; for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; x += a[i] ** 2; y += b[i] ** 2 } return x && y ? d / Math.sqrt(x * y) : 0 }
