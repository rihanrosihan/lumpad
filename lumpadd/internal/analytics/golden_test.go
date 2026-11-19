package analytics

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"os"
	"sort"
	"testing"

	"github.com/rihanrosihan/lumpad/lumpadd/internal/db"
)

// Golden diff (gate G2): load the snapshot the fixtures came from with `lumpadd load`, then
//
//	GOLDEN_DATABASE_URL=postgres://… GOLDEN_DIR=../tools/golden/out go test ./internal/analytics
func goldenDB(t *testing.T) (context.Context, string, func(string) any) {
	url, dir := os.Getenv("GOLDEN_DATABASE_URL"), os.Getenv("GOLDEN_DIR")
	if url == "" || dir == "" {
		t.Skip("GOLDEN_DATABASE_URL / GOLDEN_DIR not set")
	}
	read := func(name string) any {
		b, err := os.ReadFile(dir + "/" + name)
		if err != nil {
			t.Fatal(err)
		}
		var v any
		if err := json.Unmarshal(b, &v); err != nil {
			t.Fatal(err)
		}
		return v
	}
	return context.Background(), url, read
}

// diffJSON lists every path where a and b differ (numbers compared at the fixture's 1e-6 rounding)
func diffJSON(path string, a, b any, out *[]string) {
	switch x := a.(type) {
	case map[string]any:
		y, ok := b.(map[string]any)
		if !ok {
			*out = append(*out, fmt.Sprintf("%s: go %v / js %v", path, a, b))
			return
		}
		keys := map[string]bool{}
		for k := range x {
			keys[k] = true
		}
		for k := range y {
			keys[k] = true
		}
		ks := []string{}
		for k := range keys {
			ks = append(ks, k)
		}
		sort.Strings(ks)
		for _, k := range ks {
			diffJSON(path+"."+k, x[k], y[k], out)
		}
	case []any:
		y, ok := b.([]any)
		if !ok || len(x) != len(y) {
			*out = append(*out, fmt.Sprintf("%s: go %.200v / js %.200v", path, a, b))
			return
		}
		for i := range x {
			diffJSON(fmt.Sprintf("%s[%d]", path, i), x[i], y[i], out)
		}
	case float64:
		y, ok := b.(float64)
		if !ok || math.Abs(x-y) > 1e-6*math.Max(1, math.Abs(y)) {
			*out = append(*out, fmt.Sprintf("%s: go %v / js %v", path, a, b))
		}
	default:
		if a != b {
			*out = append(*out, fmt.Sprintf("%s: go %v / js %v", path, a, b))
		}
	}
}
func roundtrip(v any) any {
	b, _ := json.Marshal(v)
	var o any
	_ = json.Unmarshal(b, &o)
	return o
}

func TestMatricesGolden(t *testing.T) {
	ctx, url, read := goldenDB(t)
	pool, err := db.Connect(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	got, err := Matrices(ctx, pool)
	if err != nil {
		t.Fatal(err)
	}
	var diffs []string
	diffJSON("matrices", roundtrip(got), read("matrices.json"), &diffs)
	for _, d := range diffs {
		t.Error(d)
	}
}

func sessionsJSON(ss []Session) any {
	nn := func(x float64) any {
		if math.IsNaN(x) || math.IsInf(x, 0) {
			return nil
		}
		return x
	}
	out := make([]any, len(ss))
	for i, s := range ss {
		ctl := make([]any, len(s.Ctl))
		for j, c := range s.Ctl {
			ctl[j] = nn(c)
		}
		y, x := map[string]any{}, map[string]any{}
		for k, v := range s.Y {
			y[k] = nn(v)
		}
		for k, v := range s.X {
			x[k] = nn(v)
		}
		out[i] = map[string]any{"date": s.Date, "ctl": ctl, "y": y, "x": x}
	}
	return roundtrip(out)
}

func TestCorrelationGolden(t *testing.T) {
	ctx, url, read := goldenDB(t)
	pool, err := db.Connect(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	ds, err := SessionDataset(ctx, pool)
	if err != nil {
		t.Fatal(err)
	}
	want := read("corr.json").(map[string]any)
	var diffs []string
	diffJSON("dataset", sessionsJSON(ds), want["dataset"], &diffs)
	diffJSON("result", roundtrip(ComputeEdges(ds, 100, 7, 0)), want["result"], &diffs)
	for i, d := range diffs {
		if i < 20 {
			t.Error(d)
		}
	}
	if len(diffs) > 20 {
		t.Errorf("… %d differences in total", len(diffs))
	}
}
