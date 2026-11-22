// Pure view-model for the Garmin side-data of an activity (activity_enrichment). Units are already SI in the database; Garmin quirks handled here:
// RPE is stored x10, "feel" is a 0/25/50/75/100 scale, strength weights/volumes are grams.
const FEEL = { 0: 'Very weak', 25: 'Weak', 50: 'Normal', 75: 'Strong', 100: 'Very strong' }
const num = (x) => (x == null || !Number.isFinite(+x) ? null : +x)
const parse = (s) => { try { return s ? JSON.parse(s) : null } catch { return null } }

export function garminFacts(g) {
  if (!g) return null
  const zones = (parse(g.hr_zone_s) || []).map((s, i) => ({ z: i, s: num(s) || 0 })), tot = zones.reduce((a, z) => a + z.s, 0)
  const sets = (parse(g.exercise_sets_json) || []).map((e) => ({ name: String(e.subCategory || e.category || '').toLowerCase().replace(/_/g, ' '), sets: num(e.sets), reps: num(e.reps), max_kg: e.maxWeight != null ? Math.round(e.maxWeight / 100) / 10 : null, volume_kg: e.volume != null ? Math.round(e.volume / 1000) : null }))
  const facts = [['Aerobic training effect', g.aerobic_te, g.te_label ? g.te_label.toLowerCase().replace(/_/g, ' ') : null], ['Anaerobic training effect', g.anaerobic_te, null], ['Garmin training load', g.training_load_garmin, 'Garmin scale'], ['VO2max (Garmin)', g.vo2max, null],
    ['Body Battery change', g.body_battery_diff, null], ['Sweat loss', g.sweat_ml, 'ml, estimated'], ['Normalised power', g.norm_power, 'W'], ['Stress start → end', g.stress_start != null && g.stress_end != null ? `${Math.round(g.stress_start)} → ${Math.round(g.stress_end)}` : null, null],
    ['Perceived effort', g.rpe != null ? `${Math.round(g.rpe / 10)}/10` : null, null], ['How it felt', g.feel != null ? FEEL[g.feel] || g.feel : null, null], ['Ground contact', g.gct_ms, 'ms'], ['Vertical oscillation', g.vo_cm, 'cm'], ['Stride length', g.stride_m, 'm'], ['Vertical ratio', g.vratio, '%'],
    ['Temperature', g.temp_min_c != null && g.temp_max_c != null ? `${Math.round(g.temp_min_c)}–${Math.round(g.temp_max_c)} °C` : null, null]]
    .filter(([, v]) => v != null && v !== 0 && v !== '').map(([k, v, note]) => ({ k, v: typeof v === 'number' ? (Math.abs(v) < 10 ? Math.round(v * 10) / 10 : Math.round(v)) : v, note }))
  return { primary: g.primary_source === 'garmin', facts, zones: tot > 0 ? zones.map((z) => ({ ...z, pct: Math.round((z.s / tot) * 100) })) : [], sets, name: g.name || null }
}
