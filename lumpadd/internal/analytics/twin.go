package analytics

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/rihanrosihan/lumpad/lumpadd/internal/athlete"
	"github.com/rihanrosihan/lumpad/lumpadd/internal/engine"
)

// AthleteDigitalTwin (schema twin/1): port of server/intel/twin.js buildTwin. A JSON state rebuilt from measured data; the output keys and
// numbers match the Node builder (verified against a fresh Node build of the same snapshot and date).

const TwinSchema = "twin/1"

// tr: twin.js r(x, d) = Math.round(x·10^d)/10^d, null for null / non-finite
func tr(x float64, d int) any {
	if math.IsNaN(x) || math.IsInf(x, 0) {
		return nil
	}
	p := math.Pow(10, float64(d))
	return jsRound(x*p)/p + 0
}
func trp(x *float64, d int) any {
	if x == nil {
		return nil
	}
	return tr(*x, d)
}

// js0 is JS arithmetic on a nullable number: null counts as 0 (comparisons and stats.js mean / quantile)
func js0(x *float64) float64 {
	if x == nil {
		return 0
	}
	return *x
}

type sess struct {
	LabelID, ActivityID, Date, ShoeID                                     string
	DistanceM, ElapsedS, RunShare, EF, HR800, PaceHR150, OnsetKm, GCTFade *float64
	RunPace, RunHR, TempDevice, WBGT, WxTemp, Indoor                      *float64
	KM                                                                    []kmRowT
	Metrics                                                               map[string]any
	MetricsRaw                                                            string
}
type kmRowT struct {
	Km       float64  `json:"km"`
	RunShare *float64 `json:"runShare"`
}

func (s sess) metric(k string) *float64 {
	if v, ok := s.Metrics[k].(float64); ok {
		return &v
	}
	return nil
}

func twinSessions(ctx context.Context, db *pgxpool.Pool, since string) ([]sess, error) {
	rows, err := db.Query(ctx, `SELECT s.label_id, COALESCE(s.activity_id, ''), s.date, COALESCE(s.shoe_id, ''), s.distance_m, s.elapsed_s, s.run_share, s.ef, s.hr800, s.pace_hr150, s.onset_km,
		s.gct_fade, s.run_pace, s.run_hr, s.temp_device_c, w.wbgt, w.temp_c, w.indoor::float8, COALESCE(s.km, '[]'), COALESCE(s.metrics, '{}')
		FROM train.session_metric s LEFT JOIN train.run_weather w ON w.label_id = s.label_id WHERE s.date >= $1 ORDER BY s.date, s.start_ms, s.label_id`, since)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []sess
	for rows.Next() {
		var s sess
		var d *time.Time
		var km string
		if err := rows.Scan(&s.LabelID, &s.ActivityID, &d, &s.ShoeID, &s.DistanceM, &s.ElapsedS, &s.RunShare, &s.EF, &s.HR800, &s.PaceHR150, &s.OnsetKm, &s.GCTFade,
			&s.RunPace, &s.RunHR, &s.TempDevice, &s.WBGT, &s.WxTemp, &s.Indoor, &km, &s.MetricsRaw); err != nil {
			return nil, err
		}
		s.Date = dateStr(d)
		_ = json.Unmarshal([]byte(km), &s.KM)
		_ = json.Unmarshal([]byte(s.MetricsRaw), &s.Metrics)
		out = append(out, s)
	}
	return out, rows.Err()
}

func filterS(S []sess, keep func(sess) bool) []sess {
	o := []sess{}
	for _, s := range S {
		if keep(s) {
			o = append(o, s)
		}
	}
	return o
}
func vals(S []sess, g func(sess) *float64) []float64 { // non-null values
	o := []float64{}
	for _, s := range S {
		if v := g(s); v != nil {
			o = append(o, *v)
		}
	}
	return o
}
func vals0(S []sess, g func(sess) *float64) []float64 { // null → 0, as JS arithmetic does
	o := make([]float64, len(S))
	for i, s := range S {
		o[i] = js0(g(s))
	}
	return o
}

// ---- kv
func kvValues(ctx context.Context, db *pgxpool.Pool, keys ...string) (map[string]json.RawMessage, error) {
	rows, err := db.Query(ctx, `SELECT key, value::text FROM app.kv WHERE key = ANY($1)`, keys)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]json.RawMessage{}
	for rows.Next() {
		var k, v string
		if err := rows.Scan(&k, &v); err != nil {
			return nil, err
		}
		out[k] = json.RawMessage(v)
	}
	return out, rows.Err()
}

// ---- load + readiness (same code and inputs as the client)
type hrow struct {
	engine.HealthRow
	HRVStatus                                *string
	HRVBaseline, Stress, LoadShort, LoadLong *float64
	LoadRatio                                *float64
}

func nanp(x *float64) float64 {
	if x == nil {
		return math.NaN()
	}
	return *x
}

func healthRows(ctx context.Context, db *pgxpool.Pool, from, to string) ([]hrow, error) {
	rows, err := db.Query(ctx, `SELECT date, hrv_avg, resting_hr, sleep_total_min, sleep_awake_min, sleep_deep_min, sleep_rem_min, sleep_light_min, sleep_score, sleep_hr_avg,
		hrv_status, hrv_baseline, stress_avg, load_short, load_long, load_ratio FROM health.daily WHERE date BETWEEN $1 AND $2 ORDER BY date`, from, to)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []hrow
	for rows.Next() {
		var d *time.Time
		var hrv, rhr, tot, awake, deep, rem, light, score, shr *float64
		var h hrow
		if err := rows.Scan(&d, &hrv, &rhr, &tot, &awake, &deep, &rem, &light, &score, &shr, &h.HRVStatus, &h.HRVBaseline, &h.Stress, &h.LoadShort, &h.LoadLong, &h.LoadRatio); err != nil {
			return nil, err
		}
		h.HealthRow = engine.HealthRow{Date: dateStr(d), HRV: nanp(hrv), RHR: nanp(rhr), SleepTotal: nanp(tot), SleepAwake: nanp(awake), SleepDeep: nanp(deep), SleepREM: nanp(rem),
			SleepLight: nanp(light), SleepScore: nanp(score), SleepHR: nanp(shr)}
		out = append(out, h)
	}
	return out, rows.Err()
}

type act struct {
	Date, Sport string
	DistanceM   float64
}

func loadAndReadiness(ctx context.Context, db *pgxpool.Pool, T string, aerZ float64, aerN int) (map[string]any, map[string]any, []any, error) {
	from := addDays(T, -120)
	health, err := healthRows(ctx, db, from, T)
	if err != nil {
		return nil, nil, nil, err
	}
	lrows, err := db.Query(ctx, `SELECT date, SUM(training_load) FROM train.activity WHERE source='coros' AND training_load IS NOT NULL AND date BETWEEN $1 AND $2 GROUP BY date ORDER BY date`, from, T)
	if err != nil {
		return nil, nil, nil, err
	}
	byDate := map[string]float64{}
	for lrows.Next() {
		var d *time.Time
		var l float64
		if err := lrows.Scan(&d, &l); err != nil {
			lrows.Close()
			return nil, nil, nil, err
		}
		byDate[dateStr(d)] = l
	}
	lrows.Close()
	var series []engine.DayLoad
	for d := from; d <= T; d = addDays(d, 1) {
		series = append(series, engine.DayLoad{Date: d, Load: byDate[d]})
	}
	P := engine.Pmc(series, 14)
	var cur *engine.PMCPoint
	if len(P) > 0 {
		cur = &P[len(P)-1]
	}
	arows, err := db.Query(ctx, `SELECT date, COALESCE(sport, ''), COALESCE(distance_m, 0) FROM train.activity WHERE date BETWEEN $1 AND $2 AND source = 'coros'`, from, T)
	if err != nil {
		return nil, nil, nil, err
	}
	var acts []act
	for arows.Next() {
		var a act
		var d *time.Time
		if err := arows.Scan(&d, &a.Sport, &a.DistanceM); err != nil {
			arows.Close()
			return nil, nil, nil, err
		}
		a.Date = dateStr(d)
		acts = append(acts, a)
	}
	arows.Close()
	kv, err := kvValues(ctx, db, "lumpad.settings", "lumpad.daily."+T)
	if err != nil {
		return nil, nil, nil, err
	}
	var settings struct {
		SleepNeedMin float64 `json:"sleepNeedMin"`
	}
	_ = json.Unmarshal(kv["lumpad.settings"], &settings)
	need := settings.SleepNeedMin
	if need == 0 {
		need = 480
	}
	var fRaw map[string]any
	_ = json.Unmarshal(kv["lumpad.daily."+T], &fRaw)
	num := func(v any) float64 {
		if x, ok := v.(float64); ok {
			return x
		}
		return math.NaN()
	}
	hrvF, _ := fRaw["hrv"].(string)
	tib, _ := fRaw["tibia"].(bool)
	f := engine.Checkin{Pain: num(fRaw["pain"]), Energy: num(fRaw["energy"]), SleepHR: num(fRaw["sleepHR"]), HRV: hrvF, Tibia: tib}

	H := make([]engine.HealthRow, len(health))
	for i := range health {
		H[i] = health[i].HealthRow
	}
	eacts := make([]engine.Activity, len(acts))
	for i, a := range acts {
		eacts[i] = engine.Activity{Date: a.Date, Run: a.Sport == "Run", DistanceM: a.DistanceM}
	}
	hrv, rhr, sleep := engine.HRVStateAt(H, T), engine.RHRStateAt(H, T), engine.SleepStateAt(H, T, need)
	mono, prog := engine.MonotonyStrain(series), engine.DistanceProgression(eacts, T)
	day := athlete.PlanBy[T]
	phase, hard := "", false
	if day != nil {
		phase, hard = day.Phase, athlete.Hard[day.Kind]
	}
	shr := math.NaN()
	for _, h := range H {
		if h.Date == T {
			shr = h.SleepHR
			break
		}
	}
	rd := engine.ComputeReadiness(engine.ReadinessInput{F: f, HRV: hrv, RHR: rhr, Sleep: sleep, PMC: cur, Monotony: mono, Progression: &prog, MuscleMax: math.NaN(), Phase: phase, Hard: hard, SleepHR: shr, AerobicZ: aerZ, AerobicN: aerN})

	weekKm, longest := 0.0, 0.0
	for _, a := range acts {
		if a.Sport == "Run" && a.Date > addDays(T, -28) {
			weekKm += a.DistanceM / 1000
		}
		if a.Sport == "Run" && a.Date > addDays(T, -30) && a.Date < T {
			longest = math.Max(longest, a.DistanceM/1000)
		}
	}
	recent := []any{}
	for _, h := range health {
		if h.Date <= addDays(T, -8) {
			continue
		}
		asleep := any(nil)
		if !math.IsNaN(h.SleepTotal) {
			aw := h.SleepAwake
			if math.IsNaN(aw) {
				aw = 0
			}
			asleep = h.SleepTotal - aw
		}
		var st any
		if h.HRVStatus != nil {
			st = *h.HRVStatus
		}
		recent = append(recent, map[string]any{"date": h.Date, "hrv": nvf(h.HRV), "hrv_status": st, "hrv_baseline": ptr(h.HRVBaseline), "sleep_hr": nvf(h.SleepHR), "rhr": nvf(h.RHR),
			"sleep_min_asleep": asleep, "sleep_score": nvf(h.SleepScore), "stress": ptr(h.Stress), "load_short": ptr(h.LoadShort), "load_long": ptr(h.LoadLong)})
	}
	var ctl, atl, tsb, acwr any
	if cur != nil {
		ctl, atl, tsb, acwr = cur.CTL, cur.ATL, cur.TSB, cur.ACWR
	}
	var monoV any
	if mono != nil {
		monoV = mono.Monotony
	}
	var ratio any
	if len(health) > 0 {
		ratio = ptr(health[len(health)-1].LoadRatio)
	}
	load := map[string]any{"ctl": ctl, "atl": atl, "tsb": tsb, "acwr_uncoupled": engine.AcwrRolling(series, -1), "acwr_ewma": acwr, "monotony": monoV, "ramp_7d": engine.CtlRamp(P),
		"km_vs_4wk_avg_pct": nvf(prog.Pct), "weekly_km_4w": tr(weekKm/4, 1), "longest_run_km_30d": tr(longest, 1), "coros_ratio": ratio}

	pillars := map[string]any{}
	for k, p := range map[string]engine.Pillar{"msk": rd.Pillars.MSK, "ans": rd.Pillars.ANS, "sleep": rd.Pillars.Sleep, "load": rd.Pillars.Load} {
		if p.HaveWeight != 0 {
			pillars[k] = jsRound(p.Earned / p.HaveWeight * 100)
		} else {
			pillars[k] = nil
		}
	}
	caps := []string{}
	for _, c := range rd.Caps {
		caps = append(caps, c.Why)
	}
	var tier any
	if rd.Tier != nil {
		tier = rd.Tier.ID
	}
	gate := "unknown"
	if len(caps) > 0 {
		gate = "red"
	} else if s, ok := rd.Score.(float64); ok {
		gate = map[bool]string{true: "green", false: map[bool]string{true: "amber", false: "red"}[s >= 45]}[s >= 65]
	}
	readiness := map[string]any{"score": rd.Score, "raw": rd.Raw, "tier": tier, "caps": caps, "coverage": rd.Coverage, "pillars": pillars, "gate": gate}
	return load, readiness, recent, nil
}
func nvf(x float64) any {
	if math.IsNaN(x) || math.IsInf(x, 0) {
		return nil
	}
	return x
}
func ptr(x *float64) any {
	if x == nil {
		return nil
	}
	return *x
}

// ---- sections
// hr800Base is the HR at 8:00/km reference valid on T: the newest athlete.baseline row (written monthly by the Node baselineJob), else the KB seed.
type hr800Base struct {
	Value, SD float64
	N         int
	Source    string
}

var seedHR800 = hr800Base{143.1, 5.0, 26, "seed: KB Jan–Sep 2026"}

func hr800Baseline(ctx context.Context, db *pgxpool.Pool, T string) (hr800Base, error) {
	var v, sd *float64
	var n *int64
	var src *string
	err := db.QueryRow(ctx, `SELECT value, sd, n, source FROM athlete.baseline WHERE name='hr800' AND valid_from <= $1 ORDER BY valid_from DESC LIMIT 1`, T).Scan(&v, &sd, &n, &src)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return seedHR800, nil
		}
		return seedHR800, err
	}
	if v == nil || sd == nil || *sd <= 0 {
		return seedHR800, nil
	}
	b := hr800Base{Value: *v, SD: *sd, Source: ""}
	if n != nil {
		b.N = int(*n)
	}
	if src != nil {
		b.Source = *src
	}
	return b, nil
}

// orNil: an empty sample is unknown (null), never 0
func orNil(ok bool, f func() any) any {
	if !ok {
		return nil
	}
	return f()
}

// jsNumStr formats like JavaScript's String(number) for ordinary values (143.1 → "143.1", 5 → "5").
func jsNumStr(x float64) string { return strconv.FormatFloat(x, 'f', -1, 64) }

// steady easy runs only (3–15 km, ≥ 90 % running): races and run-walk sessions measure effort and heat, not aerobic fitness
func steadyRun(s sess) bool {
	return js0(s.RunShare) >= 0.9 && js0(s.DistanceM) >= 3000 && js0(s.DistanceM) <= 15000
}

func twinAerobic(S []sess, T string, base hr800Base) map[string]any {
	win := func(a, b int) []sess {
		return filterS(S, func(s sess) bool { return s.Date > addDays(T, -a) && s.Date <= addDays(T, -b) && steadyRun(s) })
	}
	hr := func(L []sess) []float64 { return vals(L, func(s sess) *float64 { return s.HR800 }) }
	p150 := func(L []sess) []float64 { return vals(L, func(s sess) *float64 { return s.PaceHR150 }) }
	cur, prev := hr(win(28, 0)), hr(win(56, 28))
	easy := vals(win(28, 0), func(s sess) *float64 { return s.EF })
	var z, pv, pv150 any
	if len(cur) > 0 {
		z = tr((Mean(cur)-base.Value)/base.SD, 1)
	}
	if len(prev) > 0 {
		pv = tr(Mean(prev), 1)
	}
	p := p150(win(28, 0))
	if len(p) > 0 {
		pv150 = tr(Mean(p), 0)
	}
	return map[string]any{
		"hr_at_800":     map[string]any{"value": orNil(len(cur) > 0, func() any { return tr(Mean(cur), 1) }), "n": len(cur), "z": z, "prev_28d": pv, "baseline": fmt.Sprintf("%s ± %s (%s, n=%d)", jsNumStr(base.Value), jsNumStr(base.SD), base.Source, base.N), "steady_only": true},
		"pace_at_hr150": map[string]any{"value": pv150, "n": len(p)},
		"ef_easy_28d":   map[string]any{"value": orNil(len(easy) > 0, func() any { return tr(Mean(easy), 3) }), "n": len(easy)},
	}
}

type kmShare struct {
	km float64
	v  []float64
}

// group run share by km (null → 0, as JS arithmetic), sorted by km
func byKm(L []sess) []kmShare {
	idx, out := map[float64]int{}, []kmShare{}
	for _, s := range L {
		for _, k := range s.KM {
			i, ok := idx[k.Km]
			if !ok {
				i = len(out)
				idx[k.Km] = i
				out = append(out, kmShare{km: k.Km})
			}
			out[i].v = append(out[i].v, js0(k.RunShare))
		}
	}
	sort.SliceStable(out, func(a, b int) bool { return out[a].km < out[b].km })
	return out
}

func twinDurability(S []sess, T string) map[string]any {
	L := filterS(S, func(s sess) bool { return s.Date > addDays(T, -90) && js0(s.DistanceM) >= 16000 })
	cont := func(s sess) float64 {
		best, cur := 0, 0
		for _, k := range s.KM {
			if js0(k.RunShare) >= 0.9 {
				cur++
				if cur > best {
					best = cur
				}
			} else {
				cur = 0
			}
		}
		return float64(best)
	}
	onset := vals(L, func(s sess) *float64 { return s.OnsetKm })
	rs := []map[string]any{}
	var below any
	for _, k := range byKm(L) {
		if len(k.v) < 2 {
			continue
		}
		share := tr(Mean(k.v), 2)
		rs = append(rs, map[string]any{"km": k.km, "run_share": share, "n": len(k.v)})
		if below == nil && k.km >= 5 && share.(float64) < 0.9 {
			below = k.km
		}
	}
	longest, longest30 := 0.0, 0.0
	for _, s := range L {
		longest = math.Max(longest, cont(s))
		if s.Date > addDays(T, -30) {
			longest30 = math.Max(longest30, cont(s))
		}
	}
	var med any
	if len(onset) > 0 {
		med = tr(Quantile(onset, 0.5), 0)
	}
	if len(rs) > 45 {
		rs = rs[:45]
	}
	return map[string]any{"long_runs_90d": len(L), "longest_continuous_run_km": longest, "longest_continuous_run_km_30d": longest30, "durability_km": below,
		"fade_onset_km_median_90d": med, "gct_fade_ms_median_90d": tr(Quantile(vals(L, func(s sess) *float64 { return s.GCTFade }), 0.5), 1), "run_share_by_km": rs}
}

func twinHeat(S []sess) map[string]any {
	L := filterS(S, func(s sess) bool {
		return s.Indoor != nil && *s.Indoor == 0 && s.WBGT != nil && js0(s.RunShare) >= 0.9 && js0(s.DistanceM) >= 3000 && js0(s.DistanceM) <= 15000 && s.EF != nil && s.RunPace != nil && s.RunHR != nil
	})
	if len(L) < 15 {
		return map[string]any{"n": len(L), "note": "needs ≥ 15 steady outdoor runs with weather"}
	}
	fit := func(rows []sess, y func(sess) float64) float64 {
		X, Y := make([][]float64, len(rows)), make([]float64, len(rows))
		for i, s := range rows {
			X[i], Y[i] = []float64{*s.RunPace, *s.WBGT}, y(s)
		}
		c, _ := OLS(X, Y)
		return c[2]
	}
	hr := func(s sess) float64 { return *s.RunHR }
	ef := func(s sess) float64 { return *s.EF }
	R, B, Be := RNG(3), []float64{}, []float64{}
	for b := 0; b < 200; b++ {
		rs := make([]sess, len(L))
		for i := range rs {
			rs[i] = L[int(math.Floor(R()*float64(len(L))))]
		}
		B, Be = append(B, fit(rs, hr)), append(Be, fit(rs, ef))
	}
	lo, hi := math.Inf(1), math.Inf(-1)
	for _, s := range L {
		lo, hi = math.Min(lo, *s.WBGT), math.Max(hi, *s.WBGT)
	}
	return map[string]any{"n": len(L),
		"hr_cost_bpm_per_c": map[string]any{"value": tr(fit(L, hr), 2), "ci": []any{tr(Quantile(B, 0.025), 2), tr(Quantile(B, 0.975), 2)}},
		"ef_cost_per_c":     map[string]any{"value": tr(fit(L, ef), 4), "ci": []any{tr(Quantile(Be, 0.025), 4), tr(Quantile(Be, 0.975), 4)}},
		"wbgt_range":        []any{tr(lo, 1), tr(hi, 1)}}
}

func twinShoes(ctx context.Context, db *pgxpool.Pool, S []sess) ([]any, error) {
	type gear struct {
		ID, Name string
		DistM    *float64
		Retired  bool
	}
	grows, err := db.Query(ctx, `SELECT id, COALESCE(name, ''), distance_m, COALESCE(retired, 0) <> 0 FROM train.gear`)
	if err != nil {
		return nil, err
	}
	var gears []gear
	for grows.Next() {
		var g gear
		if err := grows.Scan(&g.ID, &g.Name, &g.DistM, &g.Retired); err != nil {
			grows.Close()
			return nil, err
		}
		gears = append(gears, g)
	}
	grows.Close()
	arows, err := db.Query(ctx, `SELECT id, distance_m, gear_id FROM train.activity WHERE source='coros' AND sport='Run' AND gear_id IS NOT NULL ORDER BY date, start_ts`)
	if err != nil {
		return nil, err
	}
	cum, kmAt := map[string]float64{}, map[string]float64{}
	for arows.Next() {
		var id, gid string
		var dm *float64
		if err := arows.Scan(&id, &dm, &gid); err != nil {
			arows.Close()
			return nil, err
		}
		cum[gid] += js0(dm) / 1000
		kmAt[id] = cum[gid]
	}
	arows.Close()
	temp := func(s sess) *float64 {
		if s.WBGT != nil {
			return s.WBGT
		}
		if s.WxTemp != nil {
			return s.WxTemp
		}
		return s.TempDevice
	}
	ok := filterS(S, func(s sess) bool {
		return js0(s.RunShare) >= 0.85 && js0(s.DistanceM) >= 3000 && s.EF != nil && s.RunPace != nil && temp(s) != nil
	})
	var coef []float64
	if len(ok) >= 20 {
		X, Y := make([][]float64, len(ok)), make([]float64, len(ok))
		for i, s := range ok {
			X[i], Y[i] = []float64{*s.RunPace, *temp(s), js0(s.ElapsedS) / 60}, *s.EF
		}
		coef, _ = OLS(X, Y)
	}
	type row struct {
		km any
		m  map[string]any
	}
	rows := []row{}
	for _, g := range gears {
		mine := filterS(ok, func(s sess) bool { _, has := kmAt[s.ActivityID]; return s.ShoeID == g.ID && has })
		km := trp(func() *float64 {
			if g.DistM == nil {
				return nil
			}
			v := *g.DistM / 1000
			return &v
		}(), 0)
		r := map[string]any{"gear_id": g.ID, "name": g.Name, "km": km, "retired": g.Retired, "n": len(mine), "flag": nil}
		if coef != nil && len(mine) >= 8 {
			res, x := make([]float64, len(mine)), make([]float64, len(mine))
			for i, s := range mine {
				res[i] = *s.EF - (coef[0] + coef[1]**s.RunPace + coef[2]**temp(s) + coef[3]*(js0(s.ElapsedS)/60))
				x[i] = kmAt[s.ActivityID]
			}
			slope := func(xs, ys []float64) float64 {
				X := make([][]float64, len(xs))
				for i, v := range xs {
					X[i] = []float64{v}
				}
				c, _ := OLS(X, ys)
				return c[1]
			}
			R, slopes := RNG(5), []float64{}
			for b := 0; b < 200; b++ {
				ix, seen := make([]int, len(mine)), map[int]bool{}
				for i := range ix {
					ix[i] = int(math.Floor(R() * float64(len(mine))))
					seen[ix[i]] = true
				}
				if len(seen) > 3 {
					xs, ys := make([]float64, len(ix)), make([]float64, len(ix))
					for i, j := range ix {
						xs[i], ys[i] = x[j], res[j]
					}
					slopes = append(slopes, slope(xs, ys))
				}
			}
			sl, ci := slope(x, res), [2]float64{Quantile(slopes, 0.025), Quantile(slopes, 0.975)}
			flag := "no clear change"
			if ci[1] < 0 {
				flag = "EF declining with mileage (CI excludes 0)"
			} else if ci[0] > 0 {
				flag = "EF improving with mileage"
			}
			r["ef_resid_per_100km"], r["ci_per_100km"], r["flag"] = tr(sl*100, 4), []any{tr(ci[0]*100, 4), tr(ci[1]*100, 4)}, flag
		} else {
			r["flag"] = "insufficient data (needs n ≥ 8)"
		}
		rows = append(rows, row{km, r})
	}
	f := func(v any) float64 {
		if x, ok := v.(float64); ok {
			return x
		}
		return math.NaN()
	}
	sort.SliceStable(rows, func(a, b int) bool { return f(rows[b].km)-f(rows[a].km) < 0 })
	out := make([]any, len(rows))
	for i, r := range rows {
		out[i] = r.m
	}
	return out, nil
}

func twinFadeCurves(S []sess) map[string]any {
	out := map[string]any{}
	for _, c := range []struct {
		name   string
		lo, hi float64
	}{{"10k", 8000, 13000}, {"hm", 19000, 24000}, {"25_35", 24000, 37000}, {"fm", 37000, 50000}} {
		L := filterS(S, func(s sess) bool { return js0(s.DistanceM) >= c.lo && js0(s.DistanceM) < c.hi })
		if len(L) == 0 {
			out[c.name] = map[string]any{"n": 0}
			continue
		}
		rs := []any{}
		for _, k := range byKm(L) {
			rs = append(rs, map[string]any{"km": k.km, "v": tr(Mean(k.v), 2)})
		}
		if len(rs) > 45 {
			rs = rs[:45]
		}
		out[c.name] = map[string]any{"n": len(L), "run_share": rs, "run_share_overall": tr(Mean(vals0(L, func(s sess) *float64 { return s.RunShare })), 2),
			"ef_median": tr(Quantile(vals0(L, func(s sess) *float64 { return s.EF }), 0.5), 3)}
	}
	return out
}

func twinRaces(S []sess, results map[string]athlete.CheckpointResult) map[string]any {
	base, fm := athlete.Goal.Baseline, []any{}
	for _, s := range filterS(S, func(s sess) bool { return js0(s.DistanceM) > 40000 }) {
		v := engine.VdotFromRace(math.Min(42195, *s.DistanceM), js0(s.ElapsedS))
		m := map[string]any{"date": s.Date, "km": tr(*s.DistanceM/1000, 1), "time_s": ptr(s.ElapsedS), "vdot": tr(v, 1), "ratio": tr(v/base, 2), "run_share": ptr(s.RunShare)}
		if oh, present := s.Metrics["open_hr_first_hour"]; present { // undefined in JS → the key is omitted
			m["open_hr"] = oh
		}
		fm = append(fm, m)
	}
	return map[string]any{"baseline_vdot": base, "realization_ratio_note": "Jakim 14 Jun 2026 (6:53:03) = 0.59 (KB); DNF/black-flag races are not valid VDOT points", "fm_attempts": fm, "results_logged": len(results)}
}

func twinInjury(ctx context.Context, db *pgxpool.Pool, T string) (map[string]any, int, error) {
	rows, err := db.Query(ctx, `SELECT date, pain FROM health.checkin WHERE pain IS NOT NULL ORDER BY date`)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	type site struct {
		last     string
		lastPain float64
		events   int
	}
	sites, order, logN, log90 := map[string]*site{}, []string{}, 0, 0
	for rows.Next() {
		var d *time.Time
		var pain string
		if err := rows.Scan(&d, &pain); err != nil {
			return nil, 0, err
		}
		date := dateStr(d)
		logN++
		if date > addDays(T, -90) {
			log90++
		}
		var m map[string]float64
		_ = json.Unmarshal([]byte(pain), &m)
		keys := make([]string, 0, len(m))
		for k := range m {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		for _, k := range keys {
			v := m[k]
			s, ok := sites[k]
			if !ok {
				s = &site{}
				sites[k], order = s, append(order, k)
			}
			if v > 0 {
				s.last, s.lastPain = date, v
			}
			if v >= 2 && date > addDays(T, -90) {
				s.events++
			}
		}
	}
	out := map[string]any{}
	t0, _ := time.Parse("2006-01-02", T)
	for _, k := range order {
		s := sites[k]
		var last, free any
		if s.last != "" {
			t1, _ := time.Parse("2006-01-02", s.last)
			last, free = s.last, jsRound(t0.Sub(t1).Hours()/24)
		}
		out[k] = map[string]any{"last_pain_date": last, "last_pain": s.lastPain, "pain_free_days": free, "events_90d": s.events}
	}
	var note any
	if logN == 0 {
		note = `no pain log yet — injury state unknown, not "healthy"`
	}
	return map[string]any{"sites": out, "log_days_90d": log90, "note": note}, logN, rows.Err()
}

func twinPlan(T string, results map[string]athlete.CheckpointResult) map[string]any {
	day := athlete.PlanBy[T]
	var phase, week, today, next any
	if day != nil {
		phase, week, today = day.Phase, day.Week, map[string]any{"km": day.Km, "kind": day.Kind, "label": day.Label}
	}
	for _, c := range athlete.Checkpoints {
		if c.Date >= T {
			var line any
			if c.Line != nil {
				line = *c.Line
			}
			next = map[string]any{"id": c.ID, "date": c.Date, "name": c.Name, "line": line}
			break
		}
	}
	kg := "ok"
	if fired, _ := athlete.KillGate(results); fired {
		kg = "triggered"
	}
	return map[string]any{"phase": phase, "week": week, "today": today, "next_cp": next, "kill_gate": kg, "race_date": "2027-10-24"}
}

// TwinProjection: P(sub-4) Monte Carlo [MODEL] — illustrative scenarios, NOT a prediction (see twin.js).
func TwinProjection(T string, vdot0 float64) map[string]any {
	race, _ := time.Parse("2006-01-02", "2027-10-24")
	t0, _ := time.Parse("2006-01-02", T)
	months := math.Max(0, float64(race.Sub(t0).Milliseconds())/(30.44*864e5))
	run := func(seed uint32, rate float64, tri3 [3]float64) map[string]any {
		R, out := RNG(seed), make([]float64, 0, 4000)
		gauss := func() float64 {
			u := 0.0
			for i := 0; i < 6; i++ {
				u += R()
			}
			return (u - 3) / 0.7071
		}
		tri := func(lo, mode, hi float64) float64 {
			u, F := R(), (mode-lo)/(hi-lo)
			if u < F {
				return lo + math.Sqrt(u*(hi-lo)*(mode-lo))
			}
			return hi - math.Sqrt((1-u)*(hi-lo)*(hi-mode))
		}
		sub4 := 0
		for i := 0; i < 4000; i++ {
			v := vdot0 + months*math.Max(0, rate+0.25*gauss())
			ratio := tri(tri3[0], tri3[1], tri3[2])
			t := engine.RaceTime(math.Max(15, v*ratio), 42195)
			out = append(out, t)
			if t < 14400 {
				sub4++
			}
		}
		return map[string]any{"fm_time_p10_p50_p90": []any{jsRound(Quantile(out, 0.1)), jsRound(Quantile(out, 0.5)), jsRound(Quantile(out, 0.9))}, "p_sub4": tr(float64(sub4)/4000, 3)}
	}
	scen := func(name string, rate float64, seed uint32, ratio [3]float64) map[string]any {
		m := map[string]any{"name": name, "gain_per_month": rate, "ratio": ratio[:]}
		for k, v := range run(seed, rate, ratio) {
			m[k] = v
		}
		return m
	}
	need := func(target, ratio float64) float64 { return (target/ratio - vdot0) / math.Max(0.1, months) }
	return map[string]any{"months_to_race": tr(months, 1), "vdot0": vdot0,
		"scenarios": []any{
			scen("observed pace of improvement, realistic marathon ratio", 0.6, 11, [3]float64{0.70, 0.90, 0.97}),
			scen("best observed pace (0.74/mo), good marathon ratio", 0.74, 12, [3]float64{0.80, 0.93, 0.98}),
			scen("plan assumptions (1.02/mo, ratio ≈ 0.95)", 1.02, 13, [3]float64{0.90, 0.95, 0.98}),
		},
		"required_gain_per_month": map[string]any{"ratio 0.95": tr(need(37.9, 0.95), 2), "ratio 0.90": tr(need(37.9, 0.9), 2)},
		"label":                   "[MODEL] scenarios built on stated assumptions; the ratio is the biggest unknown (observed 0.59, n=1). Not a prediction."}
}

func twinProfile(ctx context.Context, db *pgxpool.Pool, S []sess, T string) (map[string]any, error) {
	rows, err := db.Query(ctx, `SELECT resting_hr FROM health.daily WHERE date > $1 AND date <= $2 AND resting_hr IS NOT NULL`, addDays(T, -7), T)
	if err != nil {
		return nil, err
	}
	var h []float64
	for rows.Next() {
		var v float64
		if err := rows.Scan(&v); err != nil {
			rows.Close()
			return nil, err
		}
		h = append(h, v)
	}
	rows.Close()
	maxObs := 0.0
	for _, s := range filterS(S, func(s sess) bool { return s.Date > addDays(T, -180) }) {
		maxObs = math.Max(maxObs, js0(s.metric("max_hr")))
	}
	var rhr7, mx any
	if len(h) > 0 {
		rhr7 = tr(Mean(h), 0)
	}
	if maxObs != 0 {
		mx = maxObs
	}
	A := athlete.Athlete
	return map[string]any{"lthr": A.LTHR, "hrmax": A.HRMax, "rhr_setting": A.RHR, "threshold_pace_s_km": A.TPaceS, "z2_ceiling": A.Z2Ceiling, "vo2max_coros": A.VO2Coros,
		"weight_kg": A.WeightKg, "src": A.Src, "rhr_7d": rhr7, "hrmax_observed_180d": mx, "devices": A.Devices}, nil
}

func twinBaselines(S []sess, T string) map[string]any {
	steady := func(d int) []sess {
		return filterS(S, func(s sess) bool {
			return s.Date > addDays(T, -d) && js0(s.RunShare) >= 0.9 && js0(s.DistanceM) >= 3000 && js0(s.DistanceM) <= 15000
		})
	}
	meanOrNil := func(v []float64) float64 { // empty → null, never 0
		if len(v) == 0 {
			return math.NaN()
		}
		return Mean(v)
	}
	finiteVals := func(L []sess, g func(sess) *float64) []float64 {
		o := []float64{}
		for _, v := range vals(L, g) {
			if !math.IsInf(v, 0) && !math.IsNaN(v) {
				o = append(o, v)
			}
		}
		return o
	}
	met := func(k string) func(sess) *float64 { return func(s sess) *float64 { return s.metric(k) } }
	one := func(d int) map[string]any {
		L := steady(d)
		return map[string]any{"n": len(L), "ef": tr(meanOrNil(finiteVals(L, func(s sess) *float64 { return s.EF })), 3), "hr_at_800": tr(meanOrNil(finiteVals(L, func(s sess) *float64 { return s.HR800 })), 1),
			"pace_at_hr150_s": tr(meanOrNil(finiteVals(L, func(s sess) *float64 { return s.PaceHR150 })), 0), "cadence_spm": tr(meanOrNil(finiteVals(L, met("run_cad"))), 1),
			"gct_ms": tr(meanOrNil(finiteVals(L, met("run_gct"))), 0), "stride_m": tr(meanOrNil(finiteVals(L, met("run_step"))), 3), "vertical_ratio_pct": tr(meanOrNil(finiteVals(L, met("run_vr"))), 2)}
	}
	a, b := one(30), one(90)
	delta := map[string]any{}
	for _, k := range []string{"ef", "hr_at_800", "pace_at_hr150_s", "cadence_spm", "gct_ms", "stride_m", "vertical_ratio_pct"} {
		x, okA := a[k].(float64)
		y, okB := b[k].(float64)
		if !okA || !okB {
			delta[k] = nil
			continue
		}
		d := 1
		if k == "ef" || k == "stride_m" {
			d = 3
		}
		delta[k] = tr(x-y, d)
	}
	return map[string]any{"d30": a, "d90": b, "delta_30_vs_90": delta, "note": "EF up / HR@8:00 down / pace@HR150 lower = fitter. Means of steady 3–15 km runs; small n is noisy."}
}

func twinIntensity(S []sess, T string) map[string]any {
	L := filterS(S, func(s sess) bool { return s.Date > addDays(T, -28) })
	tot := make([]float64, 7)
	for _, s := range L {
		z6, _ := s.Metrics["z6"].(map[string]any)
		if hs, ok := z6["hr_s"].([]any); ok {
			for i, v := range hs {
				if i < 7 {
					x, _ := v.(float64)
					tot[i] += x
				}
			}
		}
	}
	all := 0.0
	for _, v := range tot {
		all += v
	}
	var pct, low any
	if all != 0 {
		p := make([]any, 7)
		for i, v := range tot {
			p[i] = jsRound(v / all * 100)
		}
		pct, low = p, p[0].(float64)+p[1].(float64)+p[2].(float64)
	}
	z2 := athlete.Athlete.Z2Ceiling
	easy := filterS(L, func(s sess) bool {
		kind := "easy"
		if d := athlete.PlanBy[s.Date]; d != nil && d.Kind != "" {
			kind = d.Kind
		}
		return js0(s.DistanceM) <= 15000 && (kind == "easy" || kind == "social" || kind == "recovery") && s.RunHR != nil
	})
	above := len(filterS(easy, func(s sess) bool { return *s.RunHR > z2 }))
	return map[string]any{"hr_zone_pct_28d": pct, "low_share_pct": low, "minutes_28d": jsRound(all / 60), "easy_runs": len(easy), "easy_runs_above_z2": above, "z2_ceiling": z2}
}

// ListEdges: stored correlation edges, supported first, then by q and |partial ρ| (corr.js listEdges).
func ListEdges(ctx context.Context, db *pgxpool.Pool) ([]map[string]any, error) {
	rows, err := db.Query(ctx, `SELECT exposure, outcome, lag_lo, lag_hi, n, partial_rho, status FROM analytics.corr_edge ORDER BY (status='supported') DESC, q, ABS(partial_rho) DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var exp, out2, st string
		var lo, hi, n *int64
		var prho *float64
		if err := rows.Scan(&exp, &out2, &lo, &hi, &n, &prho, &st); err != nil {
			return nil, err
		}
		out = append(out, map[string]any{"exposure": exp, "outcome": out2, "lag_lo": lo, "lag_hi": hi, "n": n, "partial_rho": prho, "status": st})
	}
	return out, rows.Err()
}

func twinStrength(ctx context.Context, db *pgxpool.Pool) (map[string]any, error) {
	mx, _ := Matrices(ctx, db)
	gym, lag := any([]any{}), any([]any{})
	if mx != nil {
		gym, lag = mx["gym_to_stride"], mx["gym_lag"]
	}
	all, err := ListEdges(ctx, db)
	if err != nil {
		return nil, err
	}
	edges := []any{}
	for _, e := range all {
		if strings.HasPrefix(e["exposure"].(string), "strength") && len(edges) < 6 {
			edges = append(edges, map[string]any{"exposure": e["exposure"], "outcome": e["outcome"], "days_before": []any{e["lag_lo"], e["lag_hi"]}, "partial_rho": e["partial_rho"], "n": e["n"], "status": e["status"]})
		}
	}
	return map[string]any{"gym_vs_fresh": gym, "by_lag_hours": lag, "edges": edges, "note": "associations in observational data, not proof of cause"}, nil
}

// BuildTwin returns the twin state for date T (YYYY-MM-DD, WIB) with the same JSON as twin.js buildTwin(T).
func BuildTwin(ctx context.Context, db *pgxpool.Pool, T string) (map[string]any, error) {
	S, err := twinSessions(ctx, db, "2025-01-01")
	if err != nil {
		return nil, err
	}
	base, err := hr800Baseline(ctx, db, T)
	if err != nil {
		return nil, err
	}
	aer := twinAerobic(S, T, base)
	az, an := math.NaN(), 0
	if h, ok := aer["hr_at_800"].(map[string]any); ok {
		if zf, ok := h["z"].(float64); ok {
			az = zf
		}
		an, _ = h["n"].(int)
	}
	load, readiness, recent, err := loadAndReadiness(ctx, db, T, az, an)
	if err != nil {
		return nil, err
	}
	kv, err := kvValues(ctx, db, "lumpad.results")
	if err != nil {
		return nil, err
	}
	results := map[string]athlete.CheckpointResult{}
	_ = json.Unmarshal(kv["lumpad.results"], &results)
	vdot0 := athlete.Goal.Baseline
	for _, c := range athlete.Checkpoints {
		if r, ok := results[fmt.Sprint(c.ID)]; ok && r.Vdot != nil && c.Kind == "tt" {
			vdot0 = *r.Vdot
		}
	}
	gaps := []any{}
	noShoe := len(filterS(S, func(s sess) bool { return s.Date >= "2026-01-01" && s.ShoeID == "" }))
	if noShoe > 0 {
		gaps = append(gaps, fmt.Sprintf("%d runs in 2026 without a shoe", noShoe))
	}
	var noWx, runs int
	if err := db.QueryRow(ctx, `SELECT COUNT(*) FROM train.session_metric s LEFT JOIN train.run_weather w ON w.label_id = s.label_id WHERE w.label_id IS NULL`).Scan(&noWx); err != nil {
		return nil, err
	}
	if noWx > 0 {
		gaps = append(gaps, fmt.Sprintf("%d sessions without weather", noWx))
	}
	injury, logN, err := twinInjury(ctx, db, T)
	if err != nil {
		return nil, err
	}
	if logN == 0 {
		gaps = append(gaps, "no pain log yet")
	}
	if err := db.QueryRow(ctx, `SELECT COUNT(*) FROM train.activity WHERE sport='Run' AND source='coros'`).Scan(&runs); err != nil {
		return nil, err
	}
	if pending := runs - len(S); pending > 0 {
		gaps = append(gaps, fmt.Sprintf("%d runs have no FIT file yet (laps-only metrics)", pending))
	}
	profile, err := twinProfile(ctx, db, S, T)
	if err != nil {
		return nil, err
	}
	strength, err := twinStrength(ctx, db)
	if err != nil {
		return nil, err
	}
	shoes, err := twinShoes(ctx, db, S)
	if err != nil {
		return nil, err
	}
	return map[string]any{"schema": TwinSchema, "as_of": T, "physiological_profile": profile, "recent_days": recent, "load": load, "readiness": readiness,
		"baselines": twinBaselines(S, T), "intensity": twinIntensity(S, T), "strength_to_run_transfer": strength, "aerobic": aer, "durability": twinDurability(S, T),
		"heat": twinHeat(S), "shoes": shoes, "fade_curves": twinFadeCurves(S), "races": twinRaces(S, results), "injury": injury, "plan": twinPlan(T, results),
		"projection": TwinProjection(T, vdot0), "sessions_with_fit": len(S), "data_gaps": gaps}, nil
}
