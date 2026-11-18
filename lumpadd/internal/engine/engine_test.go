package engine

import (
	"encoding/json"
	"math"
	"os"
	"path/filepath"
	"testing"
)

func TestJSCompatibleRounding(t *testing.T) {
	// Math.round rounds halves up (towards +Infinity); Go's math.Round rounds them away from zero. The golden data depends on the JS behaviour.
	cases := map[float64]float64{0.5: 1, 1.5: 2, 2.5: 3, -0.5: 0, -1.5: -1, 0.49999: 0}
	for in, want := range cases {
		if got := jsRound(in); got != want && !(got == 0 && want == 0) {
			t.Errorf("jsRound(%v)=%v want %v", in, got, want)
		}
	}
	if r1(math.NaN(), 1) != nil || r1(0.789, 2) != 0.79 || r1(36920.4, 0) != 36920.0 {
		t.Errorf("r1 wrong: %v %v %v", r1(math.NaN(), 1), r1(0.789, 2), r1(36920.4, 0))
	}
}

func TestMeanNullCountsNullAsZeroLikeTheJS(t *testing.T) {
	// JS: mean([160, null]) = 80 because isNaN(null) is false; fadeOnset's reference values depend on it
	if got := meanNull([]float64{160, nan}); got != 80 {
		t.Errorf("meanNull=%v want 80", got)
	}
	if got := mean([]float64{160, nan}); got != 160 {
		t.Errorf("mean=%v want 160", got)
	}
}

func TestZonesMatchThePlan(t *testing.T) {
	// LTHR 168: Z2 143–150, threshold pace 356 s/km: Z4 360–374 (the same numbers the app shows)
	if r := hrRange(2, 168); r != [2]float64{143, 150} {
		t.Errorf("Z2 hr %v", r)
	}
	if r := paceRange(4, 356); r != [2]float64{360, 374} {
		t.Errorf("Z4 pace %v", r)
	}
	for z, hr := range map[int]float64{0: 100, 1: 130, 2: 148, 3: 155, 4: 164, 5: 170, 6: 180} {
		if got := HrZoneOf(hr, 168); got != z {
			t.Errorf("HrZoneOf(%v)=%d want %d", hr, got, z)
		}
	}
	for z, p := range map[int]float64{0: 537, 1: 480, 2: 430, 4: 360, 5: 345, 6: 320} {
		if got := PaceZoneOf(p, 356); got != z {
			t.Errorf("PaceZoneOf(%v)=%d want %d", p, got, z)
		}
	}
}

// Golden: every session metric and per-km row must equal what the Node engine exported (gate G2).
// GOLDEN_SESSIONS=../../../tools/golden/out/sessions.json GOLDEN_FIT=/path/to/server/data/fit go test ./internal/engine -run Golden
func TestGoldenSessions(t *testing.T) {
	sf, fitDir := os.Getenv("GOLDEN_SESSIONS"), os.Getenv("GOLDEN_FIT")
	if sf == "" || fitDir == "" {
		t.Skip("GOLDEN_SESSIONS / GOLDEN_FIT not set")
	}
	raw, err := os.ReadFile(sf)
	if err != nil {
		t.Fatal(err)
	}
	var G []map[string]any
	if err := json.Unmarshal(raw, &G); err != nil {
		t.Fatal(err)
	}
	n := 0
	for _, g := range G {
		label, date := g["label_id"].(string), g["date"].(string)
		file := filepath.Join(fitDir, date[:4], label+".fit")
		if _, err := os.Stat(file); err != nil {
			continue
		}
		S, err := ReadFIT(file)
		if err != nil {
			t.Fatalf("%s: %v", label, err)
		}
		res := SessionMetrics(S, DefaultBaseline)
		b, _ := json.Marshal(res.Metrics)
		var got any
		_ = json.Unmarshal(b, &got)
		want := g["metrics"]
		gb, _ := json.Marshal(got)
		wb, _ := json.Marshal(want)
		if string(gb) != string(wb) && !jsonEqual(got, want) {
			t.Errorf("%s: metrics differ", label)
		}
		n++
	}
	if n == 0 {
		t.Fatal("no FIT files matched")
	}
	t.Logf("%d sessions identical", n)
}

func jsonEqual(a, b any) bool {
	switch x := a.(type) {
	case map[string]any:
		y, ok := b.(map[string]any)
		if !ok || len(x) != len(y) {
			return false
		}
		for k, v := range x {
			if !jsonEqual(v, y[k]) {
				return false
			}
		}
		return true
	case []any:
		y, ok := b.([]any)
		if !ok || len(x) != len(y) {
			return false
		}
		for i := range x {
			if !jsonEqual(x[i], y[i]) {
				return false
			}
		}
		return true
	case float64:
		y, ok := b.(float64)
		return ok && math.Abs(x-y) < 1e-9
	}
	return a == b
}
