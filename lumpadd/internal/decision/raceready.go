package decision

import (
	"fmt"
	"math"
)

// Phase 5 (P1-5): Consolidated Race-Readiness P10–P90 Finish Range per race.
// Combines VDOT-equivalent marathon time, durability (run share after km 20), WBGT heat penalty, and realization ratio.
// Never promises a single finish time; always names the primary limiter and data basis.

type RaceInput struct {
	RaceName           string  `json:"race_name"`
	VDOT               float64 `json:"vdot"`
	RunShareAfter20K   float64 `json:"run_share_after_20k"` // 0..1 (e.g. 0.28 in Jakim/Borobudur 2026)
	ForecastWBGT       float64 `json:"forecast_wbgt"`       // °C
	RealizationRatio   float64 `json:"realization_ratio"`   // e.g. 0.59 observed at Jakim 2026, 0.95 target
	LongRunsOver20K    int     `json:"long_runs_over_20k"`  // data support count
	FMCount            int     `json:"fm_count"`
}

type RaceRange struct {
	RaceName   string `json:"race_name"`
	P10Sec     int    `json:"p10_sec"`
	P50Sec     int    `json:"p50_sec"`
	P90Sec     int    `json:"p90_sec"`
	P10HMS     string `json:"p10_hms"`
	P50HMS     string `json:"p50_hms"`
	P90HMS     string `json:"p90_hms"`
	Limiter    string `json:"limiter"`
	Confidence string `json:"confidence"` // low | moderate | high
	DataBasis  string `json:"data_basis"`
}

func fmtHMS(sec int) string {
	if sec < 0 {
		sec = 0
	}
	h := sec / 3600
	m := (sec % 3600) / 60
	s := sec % 60
	return fmt.Sprintf("%d:%02d:%02d", h, m, s)
}

// vdotMarathonSec approximates Daniels marathon time in seconds from VDOT (calibrated: VDOT 31.7 ≈ 4:46, VDOT 39.9 ≈ 3:48).
func vdotMarathonSec(vdot float64) float64 {
	if vdot <= 15 {
		vdot = 30
	}
	// Smooth power-law fit across VDOT 25..60
	return 486000.0 * math.Pow(vdot, -0.96)
}

// RaceReadinessRange computes an honest P10–P90 finish window with stated limiter and confidence.
func RaceReadinessRange(in RaceInput) RaceRange {
	baseSec := vdotMarathonSec(in.VDOT)

	// Realization ratio factor (1.0 = full VDOT conversion; <1.0 slows finish time)
	real := in.RealizationRatio
	if real <= 0 || real > 1.05 {
		real = 0.85
	}
	// Blend durability into effective realization when late-race run share is low
	durPen := 1.0
	if in.RunShareAfter20K > 0 && in.RunShareAfter20K < 0.85 {
		durPen = 1.0 + (0.85-in.RunShareAfter20K)*0.55
	}
	// Heat penalty above WBGT 22°C (~1.5% per °C above 22°C)
	heatPen := 1.0
	if in.ForecastWBGT > 22.0 {
		heatPen = 1.0 + (in.ForecastWBGT-22.0)*0.015
	}

	effSec := (baseSec / math.Max(real, 0.50)) * durPen * heatPen
	// Cap extreme double-counting when both low realization and low run-share come from the same race
	if real < 0.70 && durPen > 1.2 {
		effSec = (baseSec / real) * heatPen
	}

	// Uncertainty half-width widens when data is sparse
	spread := 0.08 // ±8% moderate
	conf := "moderate"
	if in.LongRunsOver20K < 3 || in.FMCount < 2 {
		spread = 0.14
		conf = "low"
	} else if in.LongRunsOver20K >= 8 && in.FMCount >= 3 {
		spread = 0.05
		conf = "high"
	}

	p10 := int(math.Round(effSec * (1 - spread)))
	p50 := int(math.Round(effSec))
	p90 := int(math.Round(effSec * (1 + spread*1.25)))

	limiter := "aerobic_fitness"
	if in.RunShareAfter20K > 0 && in.RunShareAfter20K < 0.65 {
		limiter = "durability (late-race run share)"
	} else if in.ForecastWBGT >= 26.0 {
		limiter = "heat_wbgt"
	}

	basis := fmt.Sprintf("VDOT %.1f · run-share >20K %.0f%% · WBGT %.1f°C · realization %.2f (n=%d LR, %d FM)",
		in.VDOT, in.RunShareAfter20K*100, in.ForecastWBGT, real, in.LongRunsOver20K, in.FMCount)

	return RaceRange{
		RaceName:   in.RaceName,
		P10Sec:     p10,
		P50Sec:     p50,
		P90Sec:     p90,
		P10HMS:     fmtHMS(p10),
		P50HMS:     fmtHMS(p50),
		P90HMS:     fmtHMS(p90),
		Limiter:    limiter,
		Confidence: conf,
		DataBasis:  basis,
	}
}
