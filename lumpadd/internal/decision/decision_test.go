package decision

import (
	"math/rand"
	"testing"
)

func TestComputeAdherence(t *testing.T) {
	a := ComputeAdherence(
		PlanDay{Date: "2026-11-19", Kind: "quality", PlannedKm: 12, TargetPaceSK: 360},
		ActualSession{ActivityID: "c:1", ActualKm: 12, AvgPaceSK: 360, TimeInZonePct: 90},
	)
	if a.Score < 95 {
		t.Fatalf("expected high adherence score, got %.1f", a.Score)
	}
	missed := ComputeAdherence(PlanDay{Date: "2026-11-19", PlannedKm: 10}, ActualSession{})
	if missed.Score != 0 {
		t.Fatalf("missed session must score 0, got %.1f", missed.Score)
	}
}

func TestReplanRulesAndPropertyInvariants(t *testing.T) {
	// Property test: 500 random weeks never violate +10% weekly progression, pain freeze, or 110% long-run cap
	rng := rand.New(rand.NewSource(42))
	for i := 0; i < 500; i++ {
		prev4 := 15.0 + rng.Float64()*65.0
		planned := prev4 * (0.6 + rng.Float64()*1.0)
		maxLR := 10.0 + rng.Float64()*24.0
		nextLR := maxLR * (0.7 + rng.Float64()*0.8)
		pain := rng.Intn(4) == 0
		in := ReplanInput{
			AsOf:              "2026-11-19",
			Prev4WeekAvgKm:    prev4,
			PlannedWeekKm:     planned,
			Max30dLongRunKm:   maxLR,
			NextWeekLongRunKm: nextLR,
			MissedLongRun:     rng.Intn(2) == 0,
			PainEventLast7d:   pain,
		}
		safeW, safeL := ApplyCaps(in)
		maxAllowedW := round1(prev4 * MaxWeeklyRamp)
		if pain {
			maxAllowedW = round1(prev4)
		}
		if safeW > maxAllowedW+0.1 {
			t.Fatalf("iter %d: safeWeekKm %.1f exceeded cap %.1f (pain=%v)", i, safeW, maxAllowedW, pain)
		}
		maxAllowedL := round1(maxLR * MaxLongRunRatio)
		if safeL > maxAllowedL+0.1 {
			t.Fatalf("iter %d: safeLongKm %.1f exceeded 110%% cap %.1f", i, safeL, maxAllowedL)
		}
	}

	// Gate 72h downgrade + intensity creep + low compliance + taper
	props := EvaluateReplan(ReplanInput{
		AsOf:               "2027-10-10",
		GateActive:         true,
		GateReason:         "Sleep HR 71 > 67",
		RecentQualityTIZ:   []float64{62, 58},
		EasyRunsAboveZ214d: 3,
		DaysToARace:        14,
		PeakWeekKm:         70,
		PlannedWeekKm:      55,
		Next72h: []PlannedSession{
			{Date: "2027-10-11", Kind: "quality", Label: "Tempo 10K", Km: 12},
			{Date: "2027-10-12", Kind: "easy", Label: "Easy 8K", Km: 8},
		},
	})
	seen := map[string]bool{}
	for _, p := range props {
		seen[p.RuleID] = true
	}
	for _, want := range []string{"gate_72h_downgrade", "quality_low_compliance_stepdown", "z2_intensity_creep", "taper_volume_window"} {
		if !seen[want] {
			t.Fatalf("missing expected proposal %q, got %+v", want, seen)
		}
	}
}

func TestEvaluateOutcomeAndRaceRange(t *testing.T) {
	p0 := 0.0
	p3 := 3.0
	v1, _ := EvaluateOutcome(nil, OutcomeInput{Executed: true, PainMax: &p0})
	if v1 != "helped" {
		t.Fatalf("expected helped, got %s", v1)
	}
	v2, _ := EvaluateOutcome(nil, OutcomeInput{Executed: true, PainMax: &p3})
	if v2 != "harmed" {
		t.Fatalf("expected harmed, got %s", v2)
	}
	rr := RaceReadinessRange(RaceInput{
		RaceName:         "Jakim FM 2027",
		VDOT:             31.7,
		RunShareAfter20K: 0.28,
		ForecastWBGT:     27.5,
		RealizationRatio: 0.59,
		LongRunsOver20K:  2,
		FMCount:          1,
	})
	if !(rr.P10Sec < rr.P50Sec && rr.P50Sec < rr.P90Sec) {
		t.Fatalf("expected P10 < P50 < P90, got %+v", rr)
	}
	if rr.Confidence != "low" || rr.Limiter != "durability (late-race run share)" {
		t.Fatalf("unexpected limiter/conf: %+v", rr)
	}
}
