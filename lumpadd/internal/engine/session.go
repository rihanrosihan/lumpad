package engine

import "math"

// Result is everything computed for one session: the metrics map (same keys as the JS `metrics` JSON) and the per-km rows.
type Result struct {
	Metrics map[string]any
	Km      []KM
	Series  *Series
}

func zone(S *Series, cls []uint8, lo, hi float64) int {
	s := 0
	for i := 0; i < S.N; i++ {
		if cls[i] != 0 && S.HR[i] >= lo && S.HR[i] < hi {
			s++
		}
	}
	return s
}

// SessionMetrics is the port of sessionMetrics() in server/intel/metrics.js.
func SessionMetrics(S *Series, b Baseline) Result {
	cls := Classify(S)
	grade := GradeSeries(S)
	all := Window(S, cls, 0, S.N)
	km := PerKm(S, cls, grade)
	blocks := SteadyBlocks(S, cls, grade)
	hp := HrAtPace(blocks)
	dist := S.Dist[S.N-1]
	e := S.Session
	var first []float64
	for _, k := range km[:min(5, len(km))] {
		if !math.IsNaN(k.GCT) {
			first = append(first, k.GCT)
		}
	}
	var open []float64
	for i, h := range S.HR[:min(S.N, 3600)] {
		if cls[i] == 2 {
			open = append(open, h)
		}
	}
	lthr := b.LTHR
	netEF := nan
	if all.Moving != 0 {
		netEF = (dist / float64(S.N)) * 60 / mean(S.HR)
	}
	zh, zp := Zones6(S, cls, b)
	toSlice := func(a [7]int) []any {
		o := make([]any, 7)
		for i, v := range a {
			o[i] = v
		}
		return o
	}
	m := map[string]any{
		"sport": e.Sport, "distance_m": r1(dist, 0), "elapsed_s": all.Elapsed, "moving_s": all.Moving, "stop_s": all.Stop, "run_s": all.Run, "walk_s": all.Walk,
		"run_share": r1(all.RunShare, 3), "run_pace": r1(all.RunPace, 0), "run_hr": r1(all.RunHr, 1), "run_power": r1(all.RunPower, 1), "run_cad": r1(all.RunCad, 1), "run_gct": r1(all.RunGct, 1), "run_step": r1(all.RunStep, 3), "run_vr": r1(all.RunVr, 2),
		"economy_jm": r1(all.Economy, 1), "beats_km": r1(all.BeatsKm, 0), "ef": r1(all.EF, 3), "net_ef": r1(netEF, 3),
		"drift_pahr": Drift(S, cls), "run_phase_drift": RunPhaseDrift(S, cls), "bio_fade": BioFade(S, cls), "fade_onset": FadeOnset(km), "mech_abs_km": MechAbs(km, b),
		"hr_at_800": hp.HR800, "hr_at_800_min": hp.HR800Min, "pace_at_hr150": hp.PaceAtHR150, "pace_at_hr150_min": hp.PaceAtHR150Min,
		"open_hr_first_hour": r1(mean(open), 1), "gain_m": r1(e.Ascent, 0), "temp_device_c": r1(e.TempC, 0), "avg_hr": r1(mean(S.HR), 1), "max_hr": r1(e.MaxHR, 0),
		"z_hr":         map[string]any{"below_lthr_min": r1(float64(zone(S, cls, 0, lthr*0.9))/60, 0), "tempo_min": r1(float64(zone(S, cls, lthr*0.9, lthr*1.0))/60, 0), "above_lthr_min": r1(float64(zone(S, cls, lthr, 999))/60, 0)},
		"first_km_gct": r1(mean(first), 0),
		"z6":           map[string]any{"hr_s": toSlice(zh), "pace_s": toSlice(zp)}, "pacing": Pacing(km), "lthr_pct": r1((all.RunHr/lthr)*100, 0),
	}
	return Result{Metrics: m, Km: km, Series: S}
}
