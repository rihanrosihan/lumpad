// Package analytics: descriptive matrices, the correlation engine and the twin builder (port of server/intel/{matrices,corr,twin}.js).
package analytics

import (
	"math"
	"strconv"
	"time"

	"github.com/rihanrosihan/lumpad/lumpadd/internal/engine"
)

// Nullable numbers are *float64 (nil = SQL NULL / JS null).
func f(x float64) *float64 { return &x }

// avg: mean over the finite, non-null values; nil when there are none (JS avg in matrices.js / stats.mean)
func avg(a []*float64) *float64 {
	s, n := 0.0, 0
	for _, x := range a {
		if x != nil && !math.IsNaN(*x) && !math.IsInf(*x, 0) {
			s += *x
			n++
		}
	}
	if n == 0 {
		return nil
	}
	return f(s / float64(n))
}

// rx: JS `x == null ? null : +x.toFixed(d)`
func rx(x *float64, d int) any {
	if x == nil {
		return nil
	}
	v, _ := strconv.ParseFloat(engine.ToFixed(*x, d), 64)
	return v + 0
}
func rv(x float64, d int) any { return rx(&x, d) }

// sum treats null as 0 (JS `s + (x || 0)`)
func sum(a []*float64) float64 {
	s := 0.0
	for _, x := range a {
		if x != nil && !math.IsNaN(*x) {
			s += *x
		}
	}
	return s
}
func jsRound(x float64) float64 { return math.Floor(x + 0.5) }

func addDays(s string, n int) string {
	t, err := time.Parse("2006-01-02", s)
	if err != nil {
		return s
	}
	return t.AddDate(0, 0, n).Format("2006-01-02")
}
func truthy(x *float64) bool { return x != nil && *x != 0 && !math.IsNaN(*x) }
