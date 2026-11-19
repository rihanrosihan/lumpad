package analytics

import (
	"math"
	"sort"
)

// Port of server/intel/stats.js: deterministic, dependency-free statistics for the twin and the correlation engine.
// These keep the JS semantics exactly (mean of [] = 0, sd divides by max(1, n−1), stable ranks with averaged ties).

// RNG is mulberry32 (stats.js rng); all arithmetic is mod 2^32 as in the JS.
func RNG(seed uint32) func() float64 {
	s := seed
	return func() float64 {
		s += 0x6d2b79f5
		t := s
		t = (t ^ (t >> 15)) * (t | 1)
		t ^= t + (t^(t>>7))*(t|61)
		return float64(t^(t>>14)) / 4294967296
	}
}

func Mean(a []float64) float64 {
	s := 0.0
	for _, x := range a {
		s += x
	}
	n := len(a)
	if n == 0 {
		n = 1
	}
	return s / float64(n)
}
func SD(a []float64) float64 {
	m, s := Mean(a), 0.0
	for _, x := range a {
		s += (x - m) * (x - m)
	}
	return math.Sqrt(s / math.Max(1, float64(len(a)-1)))
}
func Quantile(a []float64, q float64) float64 {
	if len(a) == 0 {
		return math.NaN()
	}
	v := append([]float64(nil), a...)
	sort.Float64s(v)
	i := float64(len(v)-1) * q
	lo, hi := int(math.Floor(i)), int(math.Ceil(i))
	return v[lo] + (v[hi]-v[lo])*(i-float64(lo))
}
func Rank(a []float64) []float64 {
	idx := make([]int, len(a))
	for i := range idx {
		idx[i] = i
	}
	sort.SliceStable(idx, func(x, y int) bool { return a[idx[x]] < a[idx[y]] })
	r := make([]float64, len(a))
	for i := 0; i < len(idx); {
		j := i
		for j+1 < len(idx) && a[idx[j+1]] == a[idx[i]] {
			j++
		}
		avg := float64(i+j)/2 + 1
		for k := i; k <= j; k++ {
			r[idx[k]] = avg
		}
		i = j + 1
	}
	return r
}
func Pearson(x, y []float64) float64 {
	mx, my := Mean(x), Mean(y)
	sxy, sx, sy := 0.0, 0.0, 0.0
	for i := range x {
		sxy += (x[i] - mx) * (y[i] - my)
		sx += (x[i] - mx) * (x[i] - mx)
		sy += (y[i] - my) * (y[i] - my)
	}
	if sx == 0 || sy == 0 || math.IsNaN(sx) || math.IsNaN(sy) {
		if math.IsNaN(sx) || math.IsNaN(sy) { // JS: NaN is falsy → 0
			return 0
		}
		return 0
	}
	return sxy / math.Sqrt(sx*sy)
}
func Spearman(x, y []float64) float64 { return Pearson(Rank(x), Rank(y)) }

// OLS: y ~ 1 + X (rows), Gaussian elimination with partial pivoting and a 1e-9 ridge, exactly as the JS.
func OLS(X [][]float64, y []float64) (coef, res []float64) {
	n, p := len(y), 1
	if len(X) > 0 {
		p = len(X[0]) + 1
	}
	A := make([][]float64, p)
	for i := range A {
		A[i] = make([]float64, p+1)
	}
	row := make([]float64, p)
	for i := 0; i < n; i++ {
		row[0] = 1
		copy(row[1:], X[i])
		for a := 0; a < p; a++ {
			for b := 0; b < p; b++ {
				A[a][b] += row[a] * row[b]
			}
			A[a][p] += row[a] * y[i]
		}
	}
	for c := 0; c < p; c++ {
		A[c][c] += 1e-9
		m := c
		for r := c + 1; r < p; r++ {
			if math.Abs(A[r][c]) > math.Abs(A[m][c]) {
				m = r
			}
		}
		A[c], A[m] = A[m], A[c]
		for r := 0; r < p; r++ {
			if r != c {
				f := A[r][c] / A[c][c]
				for k := c; k <= p; k++ {
					A[r][k] -= f * A[c][k]
				}
			}
		}
	}
	coef = make([]float64, p)
	for i := range A {
		coef[i] = A[i][p] / A[i][i]
	}
	res = make([]float64, n)
	for i := range y {
		s := 0.0
		for j, x := range X[i] {
			s += coef[j+1] * x
		}
		res[i] = y[i] - coef[0] - s
	}
	return
}

// PartialSpearman: rank everything, remove the linear effect of the controls from both, correlate the residuals.
func PartialSpearman(x, y []float64, Z [][]float64) float64 {
	if len(Z) == 0 || len(Z[0]) == 0 {
		return Spearman(x, y)
	}
	cols := make([][]float64, len(Z[0]))
	for j := range cols {
		c := make([]float64, len(Z))
		for i := range Z {
			c[i] = Z[i][j]
		}
		cols[j] = Rank(c)
	}
	Zr := make([][]float64, len(x))
	for i := range x {
		Zr[i] = make([]float64, len(cols))
		for j := range cols {
			Zr[i][j] = cols[j][i]
		}
	}
	_, rx := OLS(Zr, Rank(x))
	_, ry := OLS(Zr, Rank(y))
	return Pearson(rx, ry)
}
func ACF1(v []float64) float64 {
	m, a, b := Mean(v), 0.0, 0.0
	for i := range v {
		b += (v[i] - m) * (v[i] - m)
		if i > 0 {
			a += (v[i] - m) * (v[i-1] - m)
		}
	}
	if b == 0 || math.IsNaN(b) {
		return 0
	}
	return a / b
}
func NEff(n int, series []float64) float64 {
	r := math.Max(0, math.Min(0.95, ACF1(series)))
	return math.Max(3, math.Min(float64(n), float64(n)*(1-r)/(1+r)))
}

type statFn func(x, y []float64) float64

// ShiftP: circular-shift permutation p-value (keeps the outcome's autocorrelation), two-sided on |ρ|.
func ShiftP(x, y []float64, stat statFn) float64 {
	n, obs := len(y), math.Abs(stat(x, y))
	ge, tot := 1, 1
	ys := make([]float64, n)
	for k := 1; k < n; k++ {
		for i := range y {
			ys[i] = y[(i+k)%n]
		}
		tot++
		if math.Abs(stat(x, ys)) >= obs-1e-12 {
			ge++
		}
	}
	return float64(ge) / float64(tot)
}

// BlockBootstrapCI: resample whole groups (ISO weeks) with the seeded RNG; 95 % percentile interval.
func BlockBootstrapCI(x, y []float64, groups []string, stat statFn, B int, seed uint32) [2]float64 {
	R, by, keys := RNG(seed), map[string][]int{}, []string{}
	for i, g := range groups {
		if _, ok := by[g]; !ok {
			keys = append(keys, g)
		}
		by[g] = append(by[g], i)
	}
	var out []float64
	for b := 0; b < B; b++ {
		var xi, yi []float64
		for k := 0; k < len(keys); k++ {
			for _, i := range by[keys[int(math.Floor(R()*float64(len(keys))))]] {
				xi, yi = append(xi, x[i]), append(yi, y[i])
			}
		}
		if len(xi) >= 5 {
			out = append(out, stat(xi, yi))
		}
	}
	if len(out) == 0 {
		return [2]float64{math.NaN(), math.NaN()}
	}
	return [2]float64{Quantile(out, 0.025), Quantile(out, 0.975)}
}

// BH: Benjamini–Hochberg q-values.
func BH(ps []float64) []float64 {
	m := len(ps)
	idx := make([]int, m)
	for i := range idx {
		idx[i] = i
	}
	sort.SliceStable(idx, func(a, b int) bool { return ps[idx[a]] < ps[idx[b]] })
	q, min := make([]float64, m), 1.0
	for k := m - 1; k >= 0; k-- {
		min = math.Min(min, ps[idx[k]]*float64(m)/float64(k+1))
		q[idx[k]] = min
	}
	return q
}
