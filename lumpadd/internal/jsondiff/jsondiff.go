// Package jsondiff compares two JSON-shaped values (after a JSON round trip) and lists every path where they differ.
package jsondiff

import (
	"encoding/json"
	"fmt"
	"math"
	"sort"
)

// Roundtrip normalises Go values (ints, structs, nil maps) to what JSON decoding gives.
func Roundtrip(v any) any {
	b, _ := json.Marshal(v)
	var o any
	_ = json.Unmarshal(b, &o)
	return o
}

// Diff appends "path: a / b" for each difference; numbers are equal within tol·max(1, |b|).
func Diff(path string, a, b any, tol float64, out *[]string) {
	switch x := a.(type) {
	case map[string]any:
		y, ok := b.(map[string]any)
		if !ok {
			*out = append(*out, fmt.Sprintf("%s: %.120v / %.120v", path, a, b))
			return
		}
		keys := map[string]bool{}
		for k := range x {
			keys[k] = true
		}
		for k := range y {
			keys[k] = true
		}
		ks := make([]string, 0, len(keys))
		for k := range keys {
			ks = append(ks, k)
		}
		sort.Strings(ks)
		for _, k := range ks {
			Diff(path+"."+k, x[k], y[k], tol, out)
		}
	case []any:
		y, ok := b.([]any)
		if !ok || len(x) != len(y) {
			*out = append(*out, fmt.Sprintf("%s: length %d / %.120v", path, len(x), b))
			return
		}
		for i := range x {
			Diff(fmt.Sprintf("%s[%d]", path, i), x[i], y[i], tol, out)
		}
	case float64:
		y, ok := b.(float64)
		if !ok || math.Abs(x-y) > tol*math.Max(1, math.Abs(y)) {
			*out = append(*out, fmt.Sprintf("%s: %v / %v", path, a, b))
		}
	default:
		if fmt.Sprint(a) != fmt.Sprint(b) {
			*out = append(*out, fmt.Sprintf("%s: %.120v / %.120v", path, a, b))
		}
	}
}
