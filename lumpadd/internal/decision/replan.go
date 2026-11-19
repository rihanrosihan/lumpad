package decision

import (
	"fmt"
	"math"
)

// Phase 5 (P1-4): Deterministic adaptive training engine rules (Audit §12).
// Code proposes every plan change from explicit, unit-tested rules; the LLM only explains them; the athlete approves before any overlay applies.

const (
	Z2CeilingBPM    = 148.0
	MaxWeeklyRamp   = 1.10 // +10% vs previous 4-week average (locked rule)
	MaxLongRunRatio = 1.10 // <= 110% of longest run in previous 30 days (locked rule)
)

type PlannedSession struct {
	Date  string  `json:"date"`
	Kind  string  `json:"kind"` // easy | quality | long | race | rest | strength
	Label string  `json:"label"`
	Km    float64 `json:"km"`
	HRMax int     `json:"hr_max,omitempty"`
}

type ReplanInput struct {
	AsOf               string
	Prev4WeekAvgKm     float64
	PlannedWeekKm      float64
	Max30dLongRunKm    float64
	NextWeekLongRunKm  float64
	MissedLongRun      bool
	PainEventLast7d    bool // pain >= 2/10 in last 7 days freezes progression
	GateActive         bool // Sleep HR > 67, HRV Reduced, or Pain >= 2/10
	GateReason         string
	RecentQualityTIZ   []float64 // last 2 quality sessions time-in-zone %
	EasyRunsAboveZ214d int       // count of easy runs with avg HR > 148 bpm in last 14 days
	DaysToARace        int       // <= 21 triggers taper window (0 = no upcoming A-race)
	PeakWeekKm         float64
	Next72h            []PlannedSession
}

type SessionChange struct {
	Date string         `json:"date"`
	From PlannedSession `json:"from"`
	To   PlannedSession `json:"to"`
}

type Proposal struct {
	RuleID      string          `json:"rule_id"`
	ScopeFrom   string          `json:"scope_from"`
	ScopeTo     string          `json:"scope_to"`
	Changes     []SessionChange `json:"changes"`
	Reason      string          `json:"reason"`
	Expected    map[string]any  `json:"expected"`
	CapKm       *float64        `json:"cap_km,omitempty"`
	PaceDeltaSK int             `json:"pace_delta_s_km,omitempty"`
}

func round1(v float64) float64 { return math.Round(v*10) / 10 }

// EvaluateReplan runs all Section 12 deterministic rules and returns zero or more concrete proposals.
func EvaluateReplan(in ReplanInput) []Proposal {
	var out []Proposal

	// Rule 1: Active gate downgrades next 72h of hard sessions (quality/long/race) to easy/rehab
	if in.GateActive {
		var ch []SessionChange
		for _, s := range in.Next72h {
			if s.Kind == "quality" || s.Kind == "long" || s.Kind == "race" {
				to := s
				to.Kind = "easy"
				to.Label = "Easy / Rehab (gate downgrade)"
				to.Km = round1(math.Min(s.Km*0.75, 10.0))
				to.HRMax = int(Z2CeilingBPM)
				ch = append(ch, SessionChange{Date: s.Date, From: s, To: to})
			}
		}
		if len(ch) > 0 {
			why := in.GateReason
			if why == "" {
				why = "validated physiological/pain gate active"
			}
			out = append(out, Proposal{
				RuleID:    "gate_72h_downgrade",
				ScopeFrom: ch[0].Date,
				ScopeTo:   ch[len(ch)-1].Date,
				Changes:   ch,
				Reason:    "Active gate (" + why + "): downgrade hard sessions in next 72h to easy/rehab.",
				Expected:  map[string]any{"pain_max": 0, "hr_cap_bpm": Z2CeilingBPM},
			})
		}
	}

	// Rule 2: Weekly progression cap (+10% vs 4-week avg; frozen at +0% for 7d after pain >= 2/10)
	if in.Prev4WeekAvgKm > 0 {
		mult := MaxWeeklyRamp
		ruleID := "weekly_progression_cap"
		reason := fmt.Sprintf("Weekly planned volume (%.1f km) exceeds +10%% cap over 4-week average (%.1f km).", in.PlannedWeekKm, in.Prev4WeekAvgKm)
		if in.PainEventLast7d {
			mult = 1.0
			ruleID = "pain_progression_freeze"
			reason = fmt.Sprintf("Pain >= 2/10 in last 7 days freezes weekly progression at 4-week average (%.1f km).", in.Prev4WeekAvgKm)
		}
		capKm := round1(in.Prev4WeekAvgKm * mult)
		if in.PlannedWeekKm > capKm+0.05 {
			out = append(out, Proposal{
				RuleID:    ruleID,
				ScopeFrom: in.AsOf,
				ScopeTo:   in.AsOf,
				Reason:    reason,
				CapKm:     &capKm,
				Expected:  map[string]any{"weekly_km_max": capKm, "pain_max": 1},
			})
		}
	}

	// Rule 3: Long-run cap (<= 110% of longest run in previous 30 days) — also gates missed long-run replacement
	if in.Max30dLongRunKm > 0 && in.NextWeekLongRunKm > 0 {
		lrCap := round1(in.Max30dLongRunKm * MaxLongRunRatio)
		if in.NextWeekLongRunKm > lrCap+0.05 {
			why := fmt.Sprintf("Next long run (%.1f km) exceeds 110%% of 30-day longest run (%.1f km → cap %.1f km).", in.NextWeekLongRunKm, in.Max30dLongRunKm, lrCap)
			if in.MissedLongRun {
				why = "Missed long run cannot add extra volume: " + why
			}
			out = append(out, Proposal{
				RuleID:    "long_run_110_cap",
				ScopeFrom: in.AsOf,
				ScopeTo:   in.AsOf,
				Reason:    why,
				CapKm:     &lrCap,
				Expected:  map[string]any{"long_run_km_max": lrCap, "durability_pain_max": 1},
			})
		}
	}

	// Rule 4: Low compliance on quality (< 70% time-in-zone for 2 consecutive quality sessions)
	if len(in.RecentQualityTIZ) >= 2 {
		n := len(in.RecentQualityTIZ)
		if in.RecentQualityTIZ[n-1] < 70 && in.RecentQualityTIZ[n-2] < 70 {
			out = append(out, Proposal{
				RuleID:      "quality_low_compliance_stepdown",
				ScopeFrom:   in.AsOf,
				ScopeTo:     in.AsOf,
				PaceDeltaSK: 15, // slow target pace by 1 zone step (+15 s/km), no extra volume
				Reason:      fmt.Sprintf("Last 2 quality sessions had <70%% time in zone (%.0f%%, %.0f%%): lower target pace by one step (+15 s/km) without adding volume.", in.RecentQualityTIZ[n-2], in.RecentQualityTIZ[n-1]),
				Expected:    map[string]any{"next_quality_tiz_min_pct": 75},
			})
		}
	}

	// Rule 5: Intensity creep (3+ easy runs above Z2 ceiling 148 bpm in 14 days)
	if in.EasyRunsAboveZ214d >= 3 {
		var ch []SessionChange
		for _, s := range in.Next72h {
			if s.Kind == "easy" {
				to := s
				to.HRMax = int(Z2CeilingBPM)
				to.Label = s.Label + " (HR-capped ≤148)"
				ch = append(ch, SessionChange{Date: s.Date, From: s, To: to})
			}
		}
		out = append(out, Proposal{
			RuleID:    "z2_intensity_creep",
			ScopeFrom: in.AsOf,
			ScopeTo:   in.AsOf,
			Changes:   ch,
			Reason:    fmt.Sprintf("%d easy runs averaged above Z2 ceiling (148 bpm) in the last 14 days: enforce HR-capped easy runs.", in.EasyRunsAboveZ214d),
			Expected:  map[string]any{"easy_avg_hr_max": Z2CeilingBPM},
		})
	}

	// Rule 6: Taper (-40% to -60% over last 2-3 weeks before A-race, keeping 1 quality session/week)
	if in.DaysToARace > 0 && in.DaysToARace <= 21 && in.PeakWeekKm > 0 {
		taperMin := round1(in.PeakWeekKm * 0.40) // -60%
		taperMax := round1(in.PeakWeekKm * 0.60) // -40%
		if in.PlannedWeekKm > taperMax+0.05 {
			out = append(out, Proposal{
				RuleID:    "taper_volume_window",
				ScopeFrom: in.AsOf,
				ScopeTo:   in.AsOf,
				Reason:    fmt.Sprintf("Taper window (%d days to A-race): keep weekly volume in %.1f–%.1f km (-40%% to -60%% of %.1f km peak) with 1 sharp quality session.", in.DaysToARace, taperMin, taperMax, in.PeakWeekKm),
				CapKm:     &taperMax,
				Expected:  map[string]any{"weekly_km_min": taperMin, "weekly_km_max": taperMax, "quality_sessions": 1},
			})
		}
	}

	return out
}

// ApplyCaps returns the safe weekly km and safe long-run km after applying Section 12 caps (used by property tests).
func ApplyCaps(in ReplanInput) (safeWeekKm, safeLongKm float64) {
	safeWeekKm = in.PlannedWeekKm
	safeLongKm = in.NextWeekLongRunKm
	for _, p := range EvaluateReplan(in) {
		if p.CapKm == nil {
			continue
		}
		switch p.RuleID {
		case "weekly_progression_cap", "pain_progression_freeze", "taper_volume_window":
			if *p.CapKm < safeWeekKm {
				safeWeekKm = *p.CapKm
			}
		case "long_run_110_cap":
			if *p.CapKm < safeLongKm {
				safeLongKm = *p.CapKm
			}
		}
	}
	return safeWeekKm, safeLongKm
}
