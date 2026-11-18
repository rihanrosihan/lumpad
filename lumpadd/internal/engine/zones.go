package engine

import "math"

// Six COROS zones (src/lib/zones.js): HR as a fraction of LTHR, pace as a multiple of threshold pace.
var zoneHR = [7][2]float64{{}, {0, 0.84}, {0.85, 0.89}, {0.90, 0.94}, {0.95, 0.99}, {1.0, 1.02}, {1.03, 1.06}}
var zonePace = [7][2]float64{{}, {1.3, 1.45}, {1.14, 1.29}, {1.06, 1.13}, {1.01, 1.05}, {0.97, 1.0}, {0.9, 0.96}}

func hrRange(z int, lthr float64) [2]float64 {
	lo := jsRound(lthr * zoneHR[z][0])
	if z == 1 {
		lo = jsRound(lthr * 0.65)
	}
	return [2]float64{lo, jsRound(lthr * zoneHR[z][1])}
}
func paceRange(z int, tpace float64) [2]float64 {
	return [2]float64{jsRound(tpace * zonePace[z][0]), jsRound(tpace * zonePace[z][1])}
}

// HrZoneOf returns 0 (below Z1) … 6, or -1 when hr is missing.
func HrZoneOf(hr, lthr float64) int {
	if hr == 0 || math.IsNaN(hr) {
		return -1
	}
	if hr < hrRange(1, lthr)[0] {
		return 0
	}
	for z := 1; z <= 5; z++ {
		if hr <= hrRange(z, lthr)[1] {
			return z
		}
	}
	return 6
}
func PaceZoneOf(pace, tpace float64) int {
	if pace == 0 || math.IsNaN(pace) {
		return -1
	}
	if pace > paceRange(1, tpace)[1] {
		return 0
	}
	for z := 1; z <= 5; z++ {
		if pace >= paceRange(z, tpace)[0] {
			return z
		}
	}
	return 6
}

// Zones6: seconds per zone over moving seconds; pace from a 30 s rolling speed.
func Zones6(S *Series, cls []uint8, b Baseline) (hr, pace [7]int) {
	const W = 30
	for i := 0; i < S.N; i++ {
		if cls[i] == 0 {
			continue
		}
		if h := HrZoneOf(S.HR[i], b.LTHR); h >= 0 {
			hr[h]++
		}
		j := max(0, i-W)
		sp := (S.Dist[i] - S.Dist[j]) / math.Max(1, float64(i-j))
		z := 0
		if sp > 0.3 {
			z = PaceZoneOf(1000/sp, b.TPace)
		}
		if z >= 0 {
			pace[z]++
		}
	}
	return
}

// Pacing discipline over mostly-running kilometres (first km dropped).
func Pacing(km []KM) map[string]any {
	var p []float64
	for _, k := range km {
		if k.Km > 1 && k.RunShare >= 0.85 && k.RunPace > 0 {
			p = append(p, k.RunPace)
		}
	}
	if len(p) < 4 {
		return nil
	}
	m := mean(p)
	cv := sd(p) / m
	h := len(p) >> 1
	a, b := mean(p[:h]), mean(p[h:])
	split := (b - a) / a
	dir := "even"
	if split <= -0.01 {
		dir = "negative"
	} else if split >= 0.01 {
		dir = "positive"
	}
	return map[string]any{"km": len(p), "cv_pct": r1(cv*100, 1), "score": jsRound(100 * math.Max(0, 1-cv/0.10)), "split_pct": r1(split*100, 1), "split": dir}
}
