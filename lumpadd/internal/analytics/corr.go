package analytics

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/rihanrosihan/lumpad/lumpadd/internal/engine"
)

// CorrelationEdge engine: port of server/intel/corr.js. Lagged exposures ("days lo..hi BEFORE the run") vs session outcomes;
// Spearman + partial (controls pace, temperature/WBGT, duration, distance), circular-shift permutation p, block bootstrap by ISO week,
// n_eff from lag-1 autocorrelation, Benjamini–Hochberg FDR and split-half stability. Associations, never causal claims.

type Window struct{ Lo, Hi int }
type Exposure struct {
	ID, Col, Agg, Label string
	Windows             []Window
}
type Outcome struct {
	ID, Label string
	Min       int
}

var DefaultWindows = []Window{{1, 3}, {4, 7}, {8, 14}, {15, 28}}
var Exposures = []Exposure{
	{"strength_lower", "strength_lower", "SUM", "lower-body strength sessions", []Window{{1, 1}, {2, 2}, {3, 3}, {1, 3}, {4, 7}}},
	{"strength_upper", "strength_upper", "SUM", "upper-body strength sessions", nil},
	{"strength_tl", "strength_tl", "SUM", "strength training load", nil}, {"thr_min", "thr_min", "SUM", "threshold-zone minutes", nil},
	{"quality_sessions", "quality", "SUM", "quality sessions", nil}, {"double_days", "double_day", "SUM", "double-run quality days", nil},
	{"run_km", "run_km", "SUM", "running km", nil}, {"run_tl", "run_tl", "SUM", "running training load", nil},
	{"sleep_min", "sleep_min", "AVG", "sleep minutes (mean)", nil}, {"hrv_dev", "hrv_dev", "AVG", "HRV deviation from baseline (mean)", nil},
}
var Outcomes = []Outcome{
	{"gct_fade", "late-run GCT fade (ms)", 25}, {"drift", "Pa:HR / run-phase drift (%)", 25}, {"ef_resid", "EF residual (pace/temp/duration adjusted)", 30},
	{"run_share_long", "run share on long runs ≥ 16 km", 15}, {"stride_fade", "late-run stride change (m)", 25},
	{"pace_hr150", "pace at HR ≈ 150 (s/km; lower = fitter)", 20}, {"gct_avg", "average running GCT (ms)", 25},
}

func (e Exposure) windows() []Window {
	if e.Windows != nil {
		return e.Windows
	}
	return DefaultWindows
}
func key(e Exposure, w Window) string { return fmt.Sprintf("%s__%d_%d", e.ID, w.Lo, w.Hi) }

// LagSQL: every exposure × window as a column, one row per calendar day (the frame never includes the run day).
func LagSQL() (string, []string) {
	cols, names := []string{}, []string{}
	for _, e := range Exposures {
		for _, w := range e.windows() {
			cols = append(cols, fmt.Sprintf("(%s(%s::float8) OVER (ORDER BY date ROWS BETWEEN %d PRECEDING AND %d PRECEDING))::float8", e.Agg, e.Col, w.Hi, w.Lo))
			names = append(names, key(e, w))
		}
	}
	return "SELECT date, " + strings.Join(cols, ", ") + " FROM analytics.daily_feat ORDER BY date", names
}

// Session: one run in the dataset. NaN = missing (JS null / NaN).
type Session struct {
	Date string
	Ctl  []float64          // pace, temperature, duration (min), distance (km)
	Y    map[string]float64 // outcome → value
	X    map[string]float64 // exposure__lo_hi → value
}

func finite(v ...float64) bool {
	for _, x := range v {
		if math.IsNaN(x) || math.IsInf(x, 0) {
			return false
		}
	}
	return true
}

// ISOWeek matches corr.js isoWeek ("2026-W7", no zero padding).
func ISOWeek(d string) string {
	t, _ := time.Parse("2006-01-02", d)
	y, w := t.ISOWeek()
	return strconv.Itoa(y) + "-W" + strconv.Itoa(w)
}

type Edge struct {
	Exposure   string `json:"exposure"`
	Outcome    string `json:"outcome"`
	LagLo      int    `json:"lag_lo"`
	LagHi      int    `json:"lag_hi"`
	N          int    `json:"n"`
	NEff       any    `json:"n_eff"`
	Rho        any    `json:"rho"`
	PartialRho any    `json:"partial_rho"`
	CILo       any    `json:"ci_lo"`
	CIHi       any    `json:"ci_hi"`
	P          any    `json:"p"`
	Q          any    `json:"q"`
	Stable     int    `json:"stable"`
	Status     string `json:"status"`
	Note       string `json:"note"`
}
type EdgeResult struct {
	Tested int    `json:"tested"`
	Edges  []Edge `json:"edges"`
}

func fx(x float64, d int) any { // JS +x.toFixed(d); NaN stays NaN → JSON null
	if math.IsNaN(x) || math.IsInf(x, 0) {
		return nil
	}
	return rv(x, d)
}
func sign(x float64) float64 {
	switch {
	case math.IsNaN(x):
		return math.NaN()
	case x > 0:
		return 1
	case x < 0:
		return -1
	}
	return 0
}

type corrTest struct {
	e         Exposure
	o         Outcome
	w         Window
	n         int
	nEff, rho float64
	prho      float64
	x, y      []float64
	Z         [][]float64
	weeks     []string
}

// ComputeEdges: B bootstrap draws (100 when n_eff < 20), seed for the bootstrap RNG, minN overrides each outcome's minimum (0 = default).
func ComputeEdges(sessions []Session, B int, seed uint32, minN int) EdgeResult {
	var tests []corrTest
	for _, o := range Outcomes {
		S := []Session{}
		for _, s := range sessions {
			if finite(s.Y[o.ID]) && finite(s.Ctl...) && hasKey(s.Y, o.ID) {
				S = append(S, s)
			}
		}
		sort.SliceStable(S, func(a, b int) bool { return S[a].Date < S[b].Date })
		min := o.Min
		if minN > 0 {
			min = minN
		}
		if len(S) < min {
			continue
		}
		for _, e := range Exposures {
			for _, w := range e.windows() {
				k := key(e, w)
				var rows []Session
				for _, s := range S {
					if v, ok := s.X[k]; ok && finite(v) {
						rows = append(rows, s)
					}
				}
				n := len(rows)
				if n < min {
					continue
				}
				x, y, Z, weeks, distinct := make([]float64, n), make([]float64, n), make([][]float64, n), make([]string, n), map[float64]bool{}
				for i, s := range rows {
					x[i], y[i], Z[i], weeks[i] = s.X[k], s.Y[o.ID], s.Ctl, ISOWeek(s.Date)
					distinct[x[i]] = true
				}
				if len(distinct) < 4 {
					continue
				}
				tests = append(tests, corrTest{e, o, w, n, NEff(n, y), Spearman(x, y), PartialSpearman(x, y, Z), x, y, Z, weeks})
			}
		}
	}
	ps := make([]float64, len(tests))
	for i, t := range tests {
		Z := t.Z
		ps[i] = ShiftP(t.x, t.y, func(a, b []float64) float64 { return PartialSpearman(a, b, Z) })
	}
	qs := BH(ps)
	edges := make([]Edge, len(tests))
	for i, t := range tests {
		b := B
		if t.nEff < 20 {
			b = 100
		}
		ci := BlockBootstrapCI(t.x, t.y, t.weeks, Spearman, b, seed)
		h := t.n >> 1
		r1 := PartialSpearman(t.x[:h], t.y[:h], t.Z[:h])
		r2 := PartialSpearman(t.x[h:], t.y[h:], t.Z[h:])
		stable := 0
		if sign(r1) == sign(r2) && math.Abs(r1) >= 0.2 && math.Abs(r2) >= 0.2 {
			stable = 1
		}
		sig := qs[i] < 0.10
		status := "none"
		if sig && stable == 1 && math.Abs(t.prho) >= 0.3 && t.nEff >= 20 {
			status = "supported"
		} else if sig {
			status = "candidate"
		}
		edges[i] = Edge{t.e.ID, t.o.ID, t.w.Lo, t.w.Hi, t.n, fx(t.nEff, 1), fx(t.rho, 3), fx(t.prho, 3), fx(ci[0], 3), fx(ci[1], 3), fx(ps[i], 4), fx(qs[i], 4), stable, status,
			fmt.Sprintf("halves ρ %s / %s", engine.ToFixed(r1, 2), engine.ToFixed(r2, 2))}
	}
	return EdgeResult{len(tests), edges}
}
func hasKey(m map[string]float64, k string) bool { _, ok := m[k]; return ok }

// ---- dataset from Postgres (corr.js sessionDataset)
func lagRows(ctx context.Context, db *pgxpool.Pool) (map[string]map[string]float64, error) {
	q, names := LagSQL()
	rows, err := db.Query(ctx, q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]map[string]float64{}
	for rows.Next() {
		vals := make([]*float64, len(names))
		dst := []any{new(*time.Time)}
		for i := range vals {
			dst = append(dst, &vals[i])
		}
		if err := rows.Scan(dst...); err != nil {
			return nil, err
		}
		m := make(map[string]float64, len(names))
		for i, n := range names {
			m[n] = nanIfNil(vals[i])
			if !math.IsNaN(m[n]) { // round to 1e-6 as corr.js does, so equal exposures stay equal (rank ties)
				m[n] = jsRound(m[n]*1e6) / 1e6
			}
		}
		out[dateStr(*dst[0].(**time.Time))] = m
	}
	return out, rows.Err()
}
func nanIfNil(x *float64) float64 {
	if x == nil {
		return math.NaN()
	}
	return *x
}

// SessionDataset builds the per-run dataset: outcomes (incl. the EF residual from an OLS on pace / temperature / duration) and lagged exposures.
func SessionDataset(ctx context.Context, db *pgxpool.Pool) ([]Session, error) {
	lags, err := lagRows(ctx, db)
	if err != nil {
		return nil, err
	}
	rows, err := db.Query(ctx, `SELECT s.date, s.run_pace, s.run_share, s.distance_m, s.elapsed_s, s.ef, s.gct_fade, s.drift_pahr, s.run_drift, s.stride_fade, s.pace_hr150,
		COALESCE(s.metrics, '{}'), w.wbgt, w.temp_c, s.temp_device_c
		FROM train.session_metric s LEFT JOIN train.run_weather w ON w.label_id = s.label_id WHERE s.run_pace IS NOT NULL ORDER BY s.date, s.start_ms, s.label_id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	type r struct {
		date                                                                   string
		pace, share, dist, elapsed, ef, gctFade, drift, runDrift, stride, p150 *float64
		metrics                                                                string
		wbgt, wx, dev                                                          *float64
	}
	var all []r
	for rows.Next() {
		var x r
		var d *time.Time
		if err := rows.Scan(&d, &x.pace, &x.share, &x.dist, &x.elapsed, &x.ef, &x.gctFade, &x.drift, &x.runDrift, &x.stride, &x.p150, &x.metrics, &x.wbgt, &x.wx, &x.dev); err != nil {
			return nil, err
		}
		x.date = dateStr(d)
		all = append(all, x)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	temp := func(s r) *float64 {
		if s.wbgt != nil {
			return s.wbgt
		}
		if s.wx != nil {
			return s.wx
		}
		return s.dev
	}
	num := func(x *float64) float64 { // JS arithmetic on null is 0
		if x == nil {
			return 0
		}
		return *x
	}
	var steadyX [][]float64
	var steadyY []float64
	for _, s := range all {
		if num(s.share) >= 0.85 && num(s.dist) >= 3000 && num(s.dist) <= 21000 && s.ef != nil && temp(s) != nil {
			steadyX = append(steadyX, []float64{*s.pace, *temp(s), num(s.elapsed) / 60})
			steadyY = append(steadyY, *s.ef)
		}
	}
	var coef []float64
	if len(steadyY) >= 20 {
		coef, _ = OLS(steadyX, steadyY)
	}
	out := []Session{}
	for _, s := range all {
		lx, ok := lags[s.date]
		if !ok {
			continue
		}
		t := math.NaN()
		if tp := temp(s); tp != nil {
			t = *tp
		}
		efRes := math.NaN()
		if coef != nil && s.ef != nil && temp(s) != nil && num(s.share) >= 0.85 && num(s.dist) >= 3000 {
			efRes = *s.ef - (coef[0] + coef[1]**s.pace + coef[2]*t + coef[3]*(num(s.elapsed)/60))
		}
		var m struct {
			RunGCT *float64 `json:"run_gct"`
		}
		_ = json.Unmarshal([]byte(s.metrics), &m)
		drift := s.drift
		if drift == nil {
			drift = s.runDrift
		}
		long := math.NaN()
		if num(s.dist) >= 16000 {
			long = nanIfNil(s.share)
		}
		x := make(map[string]float64, len(lx))
		for k, v := range lx {
			x[k] = v
		}
		out = append(out, Session{Date: s.date, Ctl: []float64{*s.pace, t, num(s.elapsed) / 60, num(s.dist) / 1000},
			Y: map[string]float64{"gct_fade": nanIfNil(s.gctFade), "drift": nanIfNil(drift), "ef_resid": efRes, "run_share_long": long, "stride_fade": nanIfNil(s.stride),
				"pace_hr150": nanIfNil(s.p150), "gct_avg": nanIfNil(m.RunGCT)},
			X: x})
	}
	return out, nil
}
