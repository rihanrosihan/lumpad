package analytics

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/rihanrosihan/lumpad/lumpadd/internal/athlete"
)

// The four correlation matrices of the blueprint (§6), computed from the FIT-session table (measured, observational, within-athlete).
// Descriptive comparisons only; the statistically tested version lives in the correlation engine.

type run struct {
	LabelID, Date                                              string
	DistanceM, ElapsedS                                        float64
	EF, DriftPaHR, RunDrift, GCTFade, StrideFade, RunHR, AvgHR *float64
	PaceHR150, GainM                                           *float64
	KM, Metrics                                                string
	Indoor                                                     bool
}
type feat struct{ RunKm, Strength, StrengthLower, ThrMin *float64 }

func dateStr(t *time.Time) string {
	if t == nil {
		return ""
	}
	return t.Format("2006-01-02")
}

func loadRuns(ctx context.Context, db *pgxpool.Pool) ([]run, error) {
	rows, err := db.Query(ctx, `SELECT s.label_id, s.date, s.distance_m, COALESCE(s.elapsed_s, 0), s.ef, s.drift_pahr, s.run_drift, s.gct_fade, s.stride_fade, s.run_hr, s.avg_hr,
		s.pace_hr150, s.gain_m, COALESCE(s.km, '[]'), COALESCE(s.metrics, '{}'), COALESCE(w.indoor, 0) <> 0
		FROM train.session_metric s LEFT JOIN train.run_weather w ON w.label_id = s.label_id
		WHERE s.distance_m >= 3000 AND s.ef IS NOT NULL ORDER BY s.date, s.label_id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []run
	for rows.Next() {
		var r run
		var d *time.Time
		if err := rows.Scan(&r.LabelID, &d, &r.DistanceM, &r.ElapsedS, &r.EF, &r.DriftPaHR, &r.RunDrift, &r.GCTFade, &r.StrideFade, &r.RunHR, &r.AvgHR, &r.PaceHR150, &r.GainM, &r.KM, &r.Metrics, &r.Indoor); err != nil {
			return nil, err
		}
		r.Date = dateStr(d)
		out = append(out, r)
	}
	return out, rows.Err()
}

func loadFeat(ctx context.Context, db *pgxpool.Pool) (map[string]feat, error) {
	rows, err := db.Query(ctx, `SELECT date, run_km, strength::float8, strength_lower::float8, thr_min FROM analytics.daily_feat`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]feat{}
	for rows.Next() {
		var d *time.Time
		var x feat
		if err := rows.Scan(&d, &x.RunKm, &x.Strength, &x.StrengthLower, &x.ThrMin); err != nil {
			return nil, err
		}
		out[dateStr(d)] = x
	}
	return out, rows.Err()
}

func gymDays(ctx context.Context, db *pgxpool.Pool) (map[string]bool, error) {
	rows, err := db.Query(ctx, `SELECT DISTINCT date FROM train.activity WHERE source <> 'garmin' AND sport IN ('Strength','WeightTraining','Workout')`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]bool{}
	for rows.Next() {
		var d *time.Time
		if err := rows.Scan(&d); err != nil {
			return nil, err
		}
		out[dateStr(d)] = true
	}
	return out, rows.Err()
}

type kmRow struct {
	Km       float64  `json:"km"`
	Pace     *float64 `json:"pace"`
	GCT      *float64 `json:"gct"`
	RunShare *float64 `json:"runShare"`
}

// RaceFade: late-race fade from the per-km rows (pace = elapsed per km, so walking counts). nil when either window has < 3 km.
func RaceFade(km []kmRow, distKm float64) map[string]any {
	e0, e1, l0, l1 := 1.0, 10.0, 15.0, 21.0
	if distKm > 30 {
		e0, e1, l0, l1 = 1, 20, 30, 42
	}
	var E, L []kmRow
	for _, k := range km {
		if k.Km >= e0 && k.Km <= e1 {
			E = append(E, k)
		}
		if k.Km >= l0 && k.Km <= l1 {
			L = append(L, k)
		}
	}
	if len(E) < 3 || len(L) < 3 {
		return nil
	}
	col := func(a []kmRow, g func(kmRow) *float64) []*float64 {
		o := make([]*float64, len(a))
		for i, k := range a {
			o[i] = g(k)
		}
		return o
	}
	pace := func(k kmRow) *float64 { return k.Pace }
	gct := func(k kmRow) *float64 { return k.GCT }
	pe, pl, ge, gl := avg(col(E, pace)), avg(col(L, pace)), avg(col(E, gct)), avg(col(L, gct))
	var fade, gf any
	if pe != nil && pl != nil && *pe != 0 && *pl != 0 {
		fade = rv((*pl-*pe) / *pe * 100, 1)
	}
	if ge != nil && gl != nil {
		gf = rv(*gl-*ge, 0)
	}
	return map[string]any{"early": fmt.Sprintf("km %g–%g", e0, e1), "late": fmt.Sprintf("km %g–%g", l0, math.Min(l1, float64(len(km)))),
		"pace_early_s": rx(pe, 0), "pace_late_s": rx(pl, 0), "pace_fade_pct": fade, "gct_fade_ms": gf, "run_share_late": rx(avg(col(L, func(k kmRow) *float64 { return k.RunShare })), 2)}
}

// Matrices returns the same JSON as server/intel/matrices.js matrices(), or nil when there are no runs.
func Matrices(ctx context.Context, db *pgxpool.Pool) (map[string]any, error) {
	runs, err := loadRuns(ctx, db)
	if err != nil || len(runs) == 0 {
		return nil, err
	}
	fe, err := loadFeat(ctx, db)
	if err != nil {
		return nil, err
	}
	gym, err := gymDays(ctx, db)
	if err != nil {
		return nil, err
	}
	pick := func(rs []run, g func(run) *float64) []*float64 {
		o := make([]*float64, len(rs))
		for i, r := range rs {
			o[i] = g(r)
		}
		return o
	}
	filter := func(rs []run, keep func(run) bool) []run {
		o := []run{}
		for _, r := range rs {
			if keep(r) {
				o = append(o, r)
			}
		}
		return o
	}
	gctAvg := func(r run) *float64 {
		var m struct {
			RunGCT *float64 `json:"run_gct"`
		}
		_ = json.Unmarshal([]byte(r.Metrics), &m)
		return m.RunGCT
	}
	grp := func(rs []run, extra map[string]any) map[string]any {
		g := map[string]any{"n": len(rs),
			"ef": rx(avg(pick(rs, func(r run) *float64 { return r.EF })), 3),
			"drift": rx(avg(pick(rs, func(r run) *float64 {
				if r.DriftPaHR != nil {
					return r.DriftPaHR
				}
				return r.RunDrift
			})), 1),
			"gct_fade":    rx(avg(pick(rs, func(r run) *float64 { return r.GCTFade })), 1),
			"gct_avg":     rx(avg(pick(rs, gctAvg)), 0),
			"stride_fade": rx(avg(pick(rs, func(r run) *float64 { return r.StrideFade })), 3)}
		for k, v := range extra {
			g[k] = v
		}
		return g
	}
	nonEmpty := func(gs ...map[string]any) []map[string]any {
		o := []map[string]any{}
		for _, g := range gs {
			if g["n"].(int) > 0 {
				o = append(o, g)
			}
		}
		return o
	}

	// 1) gym → stride
	long5 := filter(runs, func(r run) bool { return r.DistanceM >= 5000 })
	afterGym := func(d string) bool { return gym[addDays(d, -1)] || gym[addDays(d, -2)] || gym[addDays(d, -3)] }
	lowerKnown := false
	for _, x := range fe {
		lowerKnown = lowerKnown || truthy(x.StrengthLower)
	}
	key := func(x feat) *float64 {
		if lowerKnown {
			return x.StrengthLower
		}
		return x.Strength
	}
	lowerLag := func(d string) int {
		for n := 1; n <= 3; n++ {
			if x, ok := fe[addDays(d, -n)]; ok && truthy(key(x)) {
				return n
			}
		}
		return 0
	}
	post := filter(long5, func(r run) bool { return afterGym(r.Date) })
	fresh := filter(long5, func(r run) bool { return !afterGym(r.Date) })
	var lags []map[string]any
	for h := 1; h <= 3; h++ {
		lags = append(lags, grp(filter(long5, func(r run) bool { return lowerLag(r.Date) == h }), map[string]any{"hours": h * 24}))
	}
	lags = nonEmpty(append(lags, grp(filter(long5, func(r run) bool { return lowerLag(r.Date) == 0 }), map[string]any{"hours": nil}))...)
	z2c := athlete.Athlete.Z2Ceiling
	short := filter(runs, func(r run) bool { return r.DistanceM <= 15000 && r.RunHR != nil })
	z2 := filter(short, func(r run) bool { return *r.RunHR <= z2c })
	creep := filter(short, func(r run) bool { return *r.RunHR > z2c })
	runHR := func(r run) *float64 { return r.RunHR }
	mod := func(rs []run, name string) map[string]any {
		return map[string]any{"modality": name, "n": len(rs), "avg_km": rx(avg(pick(rs, func(r run) *float64 { return f(r.DistanceM / 1000) })), 1),
			"ef": rx(avg(pick(rs, func(r run) *float64 { return r.EF })), 3), "avg_hr": rx(avg(pick(rs, func(r run) *float64 {
				if r.AvgHR != nil {
					return r.AvgHR
				}
				return r.RunHR
			})), 0)}
	}

	// 3) threshold adaptation: 4-week blocks ending on Sundays, newest last
	lastDate := runs[len(runs)-1].Date
	t, _ := time.Parse("2006-01-02", lastDate)
	lastSun := addDays(lastDate, -int(t.Weekday()))
	blocks := []map[string]any{}
	for b := 8; b >= 1; b-- {
		end := addDays(lastSun, -28*(b-1))
		start := addDays(end, -27)
		var thr, km []*float64
		for i := 0; i < 28; i++ {
			if x, ok := fe[addDays(start, i)]; ok {
				thr, km = append(thr, x.ThrMin), append(km, x.RunKm)
			}
		}
		if len(thr) == 0 {
			continue
		}
		p150 := func(r run) *float64 { return r.PaceHR150 }
		after := filter(runs, func(r run) bool { return r.Date > end && r.Date <= addDays(end, 28) && r.PaceHR150 != nil })
		during := filter(runs, func(r run) bool { return r.Date >= start && r.Date <= end && r.PaceHR150 != nil })
		blocks = append(blocks, map[string]any{"from": start, "to": end, "thr_min_per_week": rv(sum(thr)/4, 0), "km_per_week": rv(sum(km)/4, 1),
			"pace_hr150_during_s": rx(avg(pick(during, p150)), 0), "pace_hr150_next4w_s": rx(avg(pick(after, p150)), 0), "n_next": len(after)})
	}

	// 4) race fade predictors
	raceDates := map[string]*athlete.Race{}
	for i := range athlete.Athlete.Races {
		raceDates[athlete.Athlete.Races[i].Date] = &athlete.Athlete.Races[i]
	}
	isRace := func(r run) bool {
		p := athlete.PlanBy[r.Date]
		return (p != nil && p.Kind == "race") || raceDates[r.Date] != nil
	}
	fades := []map[string]any{}
	for _, x := range filter(runs, func(r run) bool { return r.DistanceM >= 19000 && isRace(r) }) {
		from := addDays(x.Date, -56)
		pre := filter(runs, func(r run) bool { return r.Date >= from && r.Date < x.Date })
		var thr, km []*float64
		for i := 0; i < 56; i++ {
			if d, ok := fe[addDays(from, i)]; ok {
				thr, km = append(thr, d.ThrMin), append(km, d.RunKm)
			}
		}
		name := "race"
		if k := raceDates[x.Date]; k != nil && k.Name != "" {
			name = k.Name
		} else if p := athlete.PlanBy[x.Date]; p != nil && p.Label != "" {
			name = p.Label
		}
		var rows []kmRow
		_ = json.Unmarshal([]byte(x.KM), &rows)
		var fade any
		if fm := RaceFade(rows, x.DistanceM/1000); fm != nil {
			fade = fm
		}
		fades = append(fades, map[string]any{"date": x.Date, "name": name, "km": rv(x.DistanceM/1000, 1), "time_s": x.ElapsedS,
			"pre8w": map[string]any{"long_runs_21k": len(filter(pre, func(r run) bool { return r.DistanceM >= 21000 })), "long_runs_16k": len(filter(pre, func(r run) bool { return r.DistanceM >= 16000 })),
				"gain_m": jsRound(sum(pick(pre, func(r run) *float64 { return r.GainM }))), "thr_min": jsRound(sum(thr)), "km_per_week": rv(sum(km)/8, 1)},
			"fade": fade})
	}

	basis := "any gym session (lower-body days not labelled yet)"
	if lowerKnown {
		basis = "lower-body gym"
	}
	return map[string]any{
		"gym_to_stride":    nonEmpty(grp(post, map[string]any{"grp": "post_gym_72h"}), grp(fresh, map[string]any{"grp": "fresh"})),
		"gym_lag":          lags,
		"gym_lag_basis":    basis,
		"z2_discipline":    nonEmpty(grp(z2, map[string]any{"zone": "z2_disciplined", "avg_hr": rx(avg(pick(z2, runHR)), 0)}), grp(creep, map[string]any{"zone": "intensity_creep", "avg_hr": rx(avg(pick(creep, runHR)), 0)})),
		"z2_ceiling":       z2c,
		"modalities":       nonEmpty(mod(filter(runs, func(r run) bool { return !r.Indoor }), "road_outdoor"), mod(filter(runs, func(r run) bool { return r.Indoor }), "treadmill_indoor")),
		"threshold_blocks": blocks,
		"race_fade":        fades,
		"sessions":         len(runs),
	}, nil
}
