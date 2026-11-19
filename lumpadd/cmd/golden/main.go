// golden: diff the Go engine against the golden fixtures exported from the current Node engine (gate G2).
// Usage: golden <sessions.json> <fit dir>     e.g.  golden ../tools/golden/out/sessions.json /opt/lumpad/server/data/fit
package main

import (
	"encoding/json"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/rihanrosihan/lumpad/lumpadd/internal/engine"
)

// diff returns the paths where a and b differ (numbers equal within 1e-9).
func diff(path string, a, b any, out *[]string) {
	switch x := a.(type) {
	case map[string]any:
		y, ok := b.(map[string]any)
		if !ok {
			*out = append(*out, path+": type")
			return
		}
		keys := map[string]bool{}
		for k := range x {
			keys[k] = true
		}
		for k := range y {
			keys[k] = true
		}
		for k := range keys {
			diff(path+"."+k, x[k], y[k], out)
		}
	case []any:
		y, ok := b.([]any)
		if !ok || len(x) != len(y) {
			*out = append(*out, fmt.Sprintf("%s: length %d vs %v", path, len(x), b))
			return
		}
		for i := range x {
			diff(fmt.Sprintf("%s[%d]", path, i), x[i], y[i], out)
		}
	case float64:
		y, ok := b.(float64)
		if !ok || math.Abs(x-y) > 1e-9 {
			*out = append(*out, fmt.Sprintf("%s: %v vs %v", path, x, b))
		}
	default:
		if fmt.Sprint(a) != fmt.Sprint(b) {
			*out = append(*out, fmt.Sprintf("%s: %v vs %v", path, a, b))
		}
	}
}

// roundtrip normalises Go values (ints, nil maps, …) to what JSON decoding gives.
func roundtrip(v any) any {
	b, _ := json.Marshal(v)
	var o any
	_ = json.Unmarshal(b, &o)
	return o
}

func main() {
	if len(os.Args) < 3 {
		fmt.Fprintln(os.Stderr, "usage: golden <sessions.json> <fit dir>")
		os.Exit(2)
	}
	raw, err := os.ReadFile(os.Args[1])
	if err != nil {
		panic(err)
	}
	var G []map[string]any
	if err := json.Unmarshal(raw, &G); err != nil {
		panic(err)
	}
	bad, ok, missing := 0, 0, 0
	byKey := map[string]int{}
	var examples []string
	for _, g := range G {
		label := g["label_id"].(string)
		date := g["date"].(string)
		file := filepath.Join(os.Args[2], date[:4], label+".fit")
		if _, err := os.Stat(file); err != nil {
			missing++
			continue
		}
		S, err := engine.ReadFIT(file)
		if err != nil {
			bad++
			examples = append(examples, label+": "+err.Error())
			continue
		}
		res := engine.SessionMetrics(S, engine.DefaultBaseline)
		var d []string
		diff("metrics", g["metrics"], roundtrip(res.Metrics), &d)
		diff("km", g["km"], roundtrip(engine.KmRows(res.Km)), &d)
		if len(d) == 0 {
			ok++
			continue
		}
		bad++
		for _, x := range d {
			byKey[strings.SplitN(strings.SplitN(x, ":", 2)[0], "[", 2)[0]]++
		}
		if len(examples) < 12 {
			examples = append(examples, label+" "+d[0])
		}
	}
	fmt.Printf("golden: %d sessions identical, %d differ, %d without FIT file\n", ok, bad, missing)
	keys := make([]string, 0, len(byKey))
	for k := range byKey {
		keys = append(keys, k)
	}
	sort.Slice(keys, func(i, j int) bool { return byKey[keys[i]] > byKey[keys[j]] })
	for _, k := range keys {
		fmt.Printf("  %-34s %d\n", k, byKey[k])
	}
	for _, e := range examples {
		fmt.Println("  e.g.", e)
	}
	if bad > 0 {
		os.Exit(1)
	}
}
