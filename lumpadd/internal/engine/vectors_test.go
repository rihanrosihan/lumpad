package engine

import (
	"encoding/json"
	"fmt"
	"math"
	"os"
	"testing"
)

// Vectors are produced by tools/gen_engine_vectors.mjs from the current JavaScript libraries (synthetic inputs). The Go port must reproduce them.
type vec struct {
	Load []struct {
		Series []struct {
			Date string
			Load float64
		}
		Planned []struct {
			Date string
			Load float64
		}
		PMC     []map[string]any `json:"pmc"`
		ACWR    any              `json:"acwr"`
		ACWR20  any              `json:"acwr20"`
		Mono    map[string]any   `json:"mono"`
		Ramp    any              `json:"ramp"`
		Forms   []any            `json:"forms"`
		Project []map[string]any `json:"project"`
	} `json:"load"`
	Vdot struct {
		Races []struct{ M, S, Vdot float64 }
		Times []struct{ Vdot, M, T float64 }
		Paces []struct {
			Vdot  float64
			E     float64
			Paces map[string]any
		}
		Fmt []struct {
			S    float64
			Pace string
			Time string
		}
	} `json:"vdot"`
}

func same(a, b any) error {
	ja, _ := json.Marshal(a)
	jb, _ := json.Marshal(b)
	var x, y any
	_ = json.Unmarshal(ja, &x)
	_ = json.Unmarshal(jb, &y)
	if !eq(x, y) {
		return fmt.Errorf("go %.300s\n  js %.300s", ja, jb)
	}
	return nil
}
func eq(a, b any) bool {
	switch x := a.(type) {
	case map[string]any:
		y, ok := b.(map[string]any)
		if !ok || len(x) != len(y) {
			return false
		}
		for k, v := range x {
			if !eq(v, y[k]) {
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
			if !eq(x[i], y[i]) {
				return false
			}
		}
		return true
	case float64:
		y, ok := b.(float64)
		return ok && math.Abs(x-y) <= 1e-9*math.Max(1, math.Abs(y))
	}
	return a == b
}

func loadVec(t *testing.T) vec {
	b, err := os.ReadFile("testdata/vectors.json")
	if err != nil {
		t.Fatal(err)
	}
	var v vec
	if err := json.Unmarshal(b, &v); err != nil {
		t.Fatal(err)
	}
	return v
}

func TestLoadMatchesJS(t *testing.T) {
	for i, c := range loadVec(t).Load {
		var s, pl []DayLoad
		for _, d := range c.Series {
			s = append(s, DayLoad{d.Date, d.Load})
		}
		for _, d := range c.Planned {
			pl = append(pl, DayLoad{d.Date, d.Load})
		}
		P := Pmc(s, 14)
		if len(P) != len(c.PMC) {
			t.Fatalf("case %d: pmc length %d vs %d", i, len(P), len(c.PMC))
		}
		if err := same(P, c.PMC); err != nil {
			t.Errorf("case %d pmc: %v", i, err)
		}
		if err := same(AcwrRolling(s, -1), c.ACWR); err != nil {
			t.Errorf("case %d acwr: %v", i, err)
		}
		idx := min(20, len(s)-1)
		if len(s) > 0 {
			if err := same(AcwrRolling(s, idx), c.ACWR20); err != nil {
				t.Errorf("case %d acwr20: %v", i, err)
			}
		}
		if m := MonotonyStrain(s); (m == nil) != (c.Mono == nil) {
			t.Errorf("case %d mono nil mismatch", i)
		} else if m != nil {
			if err := same(m, c.Mono); err != nil {
				t.Errorf("case %d mono: %v", i, err)
			}
		}
		if len(P) > 0 {
			if err := same(CtlRamp(P), c.Ramp); err != nil {
				t.Errorf("case %d ramp: %v", i, err)
			}
			if err := same(Project(P[len(P)-1], pl), c.Project); err != nil {
				t.Errorf("case %d project: %v", i, err)
			}
		}
		for j, pct := range []float64{-45, -30, -29.9, -10, 0, 5, 5.1, 25, 40, math.NaN()} {
			var got any
			if z := FormZone(pct); z != nil {
				got = z.ID
			}
			if got != c.Forms[j] {
				t.Errorf("form zone %v: %v vs %v", pct, got, c.Forms[j])
			}
		}
	}
}

func TestVdotMatchesJS(t *testing.T) {
	v := loadVec(t).Vdot
	for _, r := range v.Races {
		if !eq(VdotFromRace(r.M, r.S), r.Vdot) {
			t.Errorf("vdot %v m in %v s: %v vs %v", r.M, r.S, VdotFromRace(r.M, r.S), r.Vdot)
		}
	}
	for _, r := range v.Times {
		if !eq(RaceTime(r.Vdot, r.M), r.T) {
			t.Errorf("raceTime(%v,%v): %v vs %v", r.Vdot, r.M, RaceTime(r.Vdot, r.M), r.T)
		}
	}
	for _, r := range v.Paces {
		p := PacesFor(r.Vdot)
		got := map[string]any{"E": []any{p.E[0], p.E[1]}, "T": p.T, "subT": p.SubT, "I": p.I, "R": p.R, "M": p.M, "fiveK": p.FiveK, "tenK": p.TenK, "half": p.Half, "full": p.Full}
		if err := same(got, r.Paces); err != nil {
			t.Errorf("paces(%v): %v", r.Vdot, err)
		}
	}
	for _, f := range v.Fmt {
		if FmtPace(f.S) != f.Pace || FmtTime(f.S) != f.Time {
			t.Errorf("fmt %v: %s %s vs %s %s", f.S, FmtPace(f.S), FmtTime(f.S), f.Pace, f.Time)
		}
	}
}
