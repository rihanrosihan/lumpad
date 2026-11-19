package analytics

import (
	"encoding/json"
	"math"
	"os"
	"testing"
)

func num(v any) float64 {
	if x, ok := v.(float64); ok {
		return x
	}
	return math.NaN()
}

func TestStatsAndEdgesMatchJS(t *testing.T) {
	b, err := os.ReadFile("../engine/testdata/vectors.json")
	if err != nil {
		t.Fatal(err)
	}
	var v struct {
		Stats struct {
			Rng7, Rngs, A, B, Rank, Q                     []float64
			Z                                             [][]float64
			Pearson, Spearman, Partial, Acf1, Neff, Shift float64
			OLS                                           struct{ Coef, Res []float64 } `json:"ols"`
			Boot                                          []any
			BH                                            []float64 `json:"bh"`
			Weeks, WeekLabels                             []string
		}
		Corr struct {
			Sessions []struct {
				Date string
				Ctl  []float64
				Y, X map[string]any
			}
			Result any
		}
	}
	if err := json.Unmarshal(b, &v); err != nil {
		t.Fatal(err)
	}
	s := v.Stats
	if len(s.A) == 0 || len(v.Corr.Sessions) == 0 {
		t.Fatal("no stats/corr vectors; run node tools/gen_engine_vectors.mjs")
	}
	near := func(name string, got, want float64) {
		if !(math.Abs(got-want) <= 1e-9*math.Max(1, math.Abs(want)) || (math.IsNaN(got) && math.IsNaN(want))) {
			t.Errorf("%s: go %v js %v", name, got, want)
		}
	}
	R := RNG(12345)
	for i, x := range s.Rngs {
		near("rng", R(), x)
		_ = i
	}
	R7 := RNG(7)
	for _, x := range s.Rng7 {
		near("rng7", R7(), x)
	}
	for i, r := range Rank(s.A) {
		near("rank", r, s.Rank[i])
	}
	for i, q := range []float64{0, 0.025, 0.5, 0.975, 1} {
		near("quantile", Quantile(s.B, q), s.Q[i])
	}
	near("pearson", Pearson(s.A, s.B), s.Pearson)
	near("spearman", Spearman(s.A, s.B), s.Spearman)
	coef, res := OLS(s.Z, s.B)
	for i := range coef {
		near("ols coef", coef[i], s.OLS.Coef[i])
	}
	for i := range res {
		near("ols res", res[i], s.OLS.Res[i])
	}
	near("partial", PartialSpearman(s.A, s.B, s.Z), s.Partial)
	near("acf1", ACF1(s.B), s.Acf1)
	near("neff", NEff(30, s.B), s.Neff)
	near("shiftP", ShiftP(s.A, s.B, Spearman), s.Shift)
	g := make([]string, len(s.A))
	for i := range g {
		g[i] = "w" + string(rune('0'+i/4))
	}
	ci := BlockBootstrapCI(s.A, s.B, g, Spearman, 50, 7)
	near("boot lo", ci[0], num(s.Boot[0]))
	near("boot hi", ci[1], num(s.Boot[1]))
	for i, q := range BH([]float64{0.01, 0.04, 0.03, 0.2, 0.04, 0.9, 0.001}) {
		near("bh", q, s.BH[i])
	}
	for i, d := range s.Weeks {
		if got := ISOWeek(d); got != s.WeekLabels[i] {
			t.Errorf("isoWeek %s: go %s js %s", d, got, s.WeekLabels[i])
		}
	}
	sess := make([]Session, len(v.Corr.Sessions))
	for i, c := range v.Corr.Sessions {
		y, x := map[string]float64{}, map[string]float64{}
		for k, val := range c.Y {
			y[k] = num(val)
		}
		for k, val := range c.X {
			x[k] = num(val)
		}
		sess[i] = Session{c.Date, c.Ctl, y, x}
	}
	var diffs []string
	diffJSON("edges", roundtrip(ComputeEdges(sess, 60, 7, 0)), v.Corr.Result, &diffs)
	for i, d := range diffs {
		if i < 15 {
			t.Error(d)
		}
	}
	if len(diffs) > 15 {
		t.Errorf("… %d differences in total", len(diffs))
	}
}
