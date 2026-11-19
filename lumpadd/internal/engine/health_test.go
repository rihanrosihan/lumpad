package engine

import (
	"encoding/json"
	"os"
	"testing"
)

// JS values that may be a number, null or ” → float64 (NaN when not a number)
func jnum(v any) float64 {
	if x, ok := v.(float64); ok {
		return x
	}
	return nan
}

type healthCase struct {
	Date   string
	Need   float64
	Health []map[string]any
	Acts   []map[string]any
	Series []struct {
		Date string
		Load float64
	}
	F         map[string]any
	Phase     string
	Hard      bool
	SleepHR   any
	MuscleMax any
	HRV       any `json:"hrv"`
	RHR       any `json:"rhr"`
	Sleep     any `json:"sleep"`
	Prog      any `json:"prog"`
	Readiness any `json:"readiness"`
}

func TestHealthAndReadinessMatchJS(t *testing.T) {
	b, err := os.ReadFile("testdata/vectors.json")
	if err != nil {
		t.Fatal(err)
	}
	var v struct{ Health []healthCase }
	if err := json.Unmarshal(b, &v); err != nil {
		t.Fatal(err)
	}
	if len(v.Health) == 0 {
		t.Fatal("no health vectors; run node tools/gen_engine_vectors.mjs")
	}
	for i, c := range v.Health {
		h := make([]HealthRow, len(c.Health))
		for j, r := range c.Health {
			h[j] = HealthRow{Date: r["date"].(string), HRV: jnum(r["hrv_avg"]), RHR: jnum(r["resting_hr"]), SleepTotal: jnum(r["sleep_total_min"]), SleepAwake: jnum(r["sleep_awake_min"]),
				SleepDeep: jnum(r["sleep_deep_min"]), SleepREM: jnum(r["sleep_rem_min"]), SleepLight: jnum(r["sleep_light_min"]), SleepScore: jnum(r["sleep_score"]), SleepHR: jnum(r["sleep_hr_avg"])}
		}
		acts := make([]Activity, len(c.Acts))
		for j, a := range c.Acts {
			acts[j] = Activity{Date: a["date"].(string), Run: a["sport_class"] == "run", DistanceM: jnum(a["distance_m"])}
		}
		series := make([]DayLoad, len(c.Series))
		for j, s := range c.Series {
			series[j] = DayLoad{s.Date, s.Load}
		}
		hrv, rhr, sl, prog := HRVStateAt(h, c.Date), RHRStateAt(h, c.Date), SleepStateAt(h, c.Date, c.Need), DistanceProgression(acts, c.Date)
		for name, pair := range map[string][2]any{"hrv": {hrv, c.HRV}, "rhr": {rhr, c.RHR}, "sleep": {sl, c.Sleep}, "prog": {prog, c.Prog}} {
			if err := same(pair[0], pair[1]); err != nil {
				t.Errorf("case %d %s: %v", i, name, err)
			}
		}
		P := Pmc(series, 14)
		var last *PMCPoint
		if len(P) > 0 {
			last = &P[len(P)-1]
		}
		hrvF, _ := c.F["hrv"].(string)
		tib, _ := c.F["tibia"].(bool)
		rd := ComputeReadiness(ReadinessInput{F: Checkin{Pain: jnum(c.F["pain"]), Energy: jnum(c.F["energy"]), SleepHR: jnum(c.F["sleepHR"]), HRV: hrvF, Tibia: tib},
			HRV: hrv, RHR: rhr, Sleep: sl, PMC: last, Monotony: MonotonyStrain(series), Progression: &prog, MuscleMax: jnum(c.MuscleMax), Phase: c.Phase, Hard: c.Hard, SleepHR: jnum(c.SleepHR)})
		if err := same(rd, c.Readiness); err != nil {
			t.Errorf("case %d readiness: %v", i, err)
		}
	}
}

func TestToFixedLikeJS(t *testing.T) {
	for in, want := range map[float64]string{1.25: "1.3", 2.5: "2.5", 0: "0.0", 3.45: "3.5", 1.005: "1.0", 0.05: "0.1", 9.95: "9.9", 2.675: "2.7"} {
		if got := toFixed(in, 1); got != want {
			t.Errorf("toFixed(%v,1) = %s, want %s", in, got, want)
		}
	}
}
