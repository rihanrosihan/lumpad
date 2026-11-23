package graph

import "testing"

func TestVdotMatchesTheAppsBaseline(t *testing.T) {
	// the official H&S 10K (1:00:55 net = 3655 s) is the 31.7 baseline of the 2027 plan
	if v := vdotFromRace(10000, 3655); v < 31.6 || v > 31.9 {
		t.Errorf("vdot %.2f", v)
	}
	if v := vdotFromRace(5000, 1500); v < 38 || v > 40 {
		t.Errorf("25:00 5K should be ~39.0, got %.2f", v)
	}
}
