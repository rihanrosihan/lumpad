package athlete

import "testing"

func v(x float64) *float64 { return &x }

func TestKillGate(t *testing.T) {
	if len(Checkpoints) != 20 || Goal.Baseline != 31.7 || Athlete.Z2Ceiling != 148 {
		t.Fatalf("embedded data: %d checkpoints, baseline %v, z2 %v", len(Checkpoints), Goal.Baseline, Athlete.Z2Ceiling)
	}
	cases := []struct {
		name string
		res  map[string]CheckpointResult
		want bool
	}{
		{"no results", map[string]CheckpointResult{}, false},
		{"one red (CP4 line 33.7)", map[string]CheckpointResult{"4": {Vdot: v(32.0)}}, false},
		{"two consecutive reds CP4 + CP6", map[string]CheckpointResult{"4": {Vdot: v(32.0)}, "6": {Vdot: v(32.5)}}, true},
		{"red, green, red", map[string]CheckpointResult{"4": {Vdot: v(32.0)}, "6": {Vdot: v(34.4)}, "8": {Vdot: v(33.0)}}, false},
		{"reds before CP4 do not count", map[string]CheckpointResult{"1": {Vdot: v(29)}, "2": {Vdot: v(29)}}, false},
		{"CP11 ratio below 0.85", map[string]CheckpointResult{"11": {Ratio: v(0.84)}}, true},
		{"CP11 ratio 0.85", map[string]CheckpointResult{"11": {Ratio: v(0.85)}}, false},
	}
	for _, c := range cases {
		if got, why := KillGate(c.res); got != c.want {
			t.Errorf("%s: fired=%v (%s), want %v", c.name, got, why, c.want)
		}
	}
}
