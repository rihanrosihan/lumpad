package engine

import (
	"encoding/json"
	"math"
	"strconv"
	"time"
)

// HRV / resting HR / sleep states and weekly distance progression: port of src/lib/hrv.js, src/lib/sleep.js and
// distanceProgression in src/lib/load.js. Missing values are NaN (JS null). Outputs marshal to the same JSON as the JS objects.

type HealthRow struct {
	Date                            string
	HRV, RHR                        float64 // hrv_avg, resting_hr
	SleepTotal, SleepAwake          float64 // sleep_total_min (includes awake), sleep_awake_min
	SleepDeep, SleepREM, SleepLight float64
	SleepScore, SleepHR             float64 // sleep_score, sleep_hr_avg
}

// ---- small JS-compatibility helpers
func isNull(x float64) bool { return math.IsNaN(x) }

// nv: a number as JSON would show it from JS (NaN/±Inf → null, -0 → 0)
func nv(x float64) any {
	if math.IsNaN(x) || math.IsInf(x, 0) {
		return nil
	}
	return x + 0
}

// jsNum formats a number like JS String(x) for the magnitudes used here.
func jsNum(x float64) string {
	if x == 0 {
		return "0"
	}
	return strconv.FormatFloat(x, 'f', -1, 64)
}

func addDays(s string, n int) string {
	t, err := time.Parse("2006-01-02", s)
	if err != nil {
		return s
	}
	return t.AddDate(0, 0, n).Format("2006-01-02")
}

func lin(x, x0, y0, x1, y1 float64) float64 {
	if x <= x0 {
		return y0
	}
	if x >= x1 {
		return y1
	}
	return y0 + ((x-x0)/(x1-x0))*(y1-y0)
}
func clamp(x, a, b float64) float64 { return math.Min(b, math.Max(a, x)) }

func findRow(h []HealthRow, date string) *HealthRow {
	for i := range h {
		if h[i].Date == date {
			return &h[i]
		}
	}
	return nil
}

// values of key for rows strictly before date and within the last `days` days (JS rowsBefore)
func rowsBefore(h []HealthRow, date string, days int, key func(*HealthRow) float64) []float64 {
	lo, out := addDays(date, -days), []float64{}
	for i := range h {
		if v := key(&h[i]); h[i].Date < date && h[i].Date >= lo && !isNull(v) {
			out = append(out, v)
		}
	}
	return out
}
func hrvOf(r *HealthRow) float64 { return r.HRV }
func rhrOf(r *HealthRow) float64 { return r.RHR }
func logs(a []float64) []float64 {
	o := make([]float64, len(a))
	for i, x := range a {
		o[i] = math.Log(x)
	}
	return o
}

// ---- HRV
type HRVState struct {
	Enough                                       bool
	Today                                        float64
	ZToday, Roll7, Z7, CV7, CVMean, CVSd, Lo, Hi float64 // rounded as in JS
	N                                            int
	FlagDay, FlagTrend, FlagCv                   bool
}

func (s HRVState) MarshalJSON() ([]byte, error) {
	if !s.Enough {
		return json.Marshal(map[string]any{"today": nv(s.Today), "enough": false, "n": s.N})
	}
	return json.Marshal(map[string]any{"enough": true, "today": nv(s.Today), "zToday": nv(s.ZToday), "roll7": nv(s.Roll7), "z7": nv(s.Z7), "cv7": nv(s.CV7),
		"cvMean": nv(s.CVMean), "cvSd": nv(s.CVSd), "lo": nv(s.Lo), "hi": nv(s.Hi), "n": s.N, "flagDay": s.FlagDay, "flagTrend": s.FlagTrend, "flagCv": s.FlagCv})
}

// HRVStateAt: ln(HRV), 60-day baseline ± 0.5 SD, 7-day rolling mean as the decision line.
func HRVStateAt(h []HealthRow, date string) HRVState {
	base := logs(rowsBefore(h, date, 60, hrvOf))
	m, s := mean(base), sd(base)
	lo7, last7 := addDays(date, -7), []float64{}
	for i := range h {
		if h[i].Date <= date && h[i].Date > lo7 && !isNull(h[i].HRV) {
			last7 = append(last7, math.Log(h[i].HRV))
		}
	}
	today := nan
	if r := findRow(h, date); r != nil {
		today = r.HRV
	}
	if len(base) < 14 || isNull(s) || s == 0 || len(last7) < 3 {
		return HRVState{Today: today, N: len(base)}
	}
	cv := func(a []float64) float64 {
		if len(a) < 3 {
			return nan
		}
		return sd(a) / mean(a) * 100
	}
	cvs := []float64{}
	for i := 6; i < len(base); i++ {
		cvs = append(cvs, cv(base[i-6:i+1]))
	}
	z7 := (mean(last7) - m) / s
	zToday := nan
	if !isNull(today) {
		zToday = (math.Log(today) - m) / s
	}
	cv7, cm, cs := cv(last7), mean(cvs), sd(cvs)
	return HRVState{Enough: true, Today: today, ZToday: rf(zToday, 2), Roll7: rf(math.Exp(mean(last7)), 1), Z7: rf(z7, 2), CV7: rf(cv7, 2), CVMean: rf(cm, 2), CVSd: rf(cs, 2),
		Lo: rf(math.Exp(m-0.5*s), 1), Hi: rf(math.Exp(m+0.5*s), 1), N: len(base),
		FlagDay: !isNull(zToday) && zToday < -1, FlagTrend: z7 < -0.5, FlagCv: len(cvs) >= 7 && cv7 > cm+cs && z7 < 0}
}

// ---- resting HR
type RHRState struct {
	Enough              bool
	Value, Base, Dev, Z float64
	Spike               bool
}

func (s RHRState) MarshalJSON() ([]byte, error) {
	if !s.Enough {
		return json.Marshal(map[string]any{"value": nv(s.Value), "enough": false})
	}
	return json.Marshal(map[string]any{"enough": true, "value": nv(s.Value), "base": nv(s.Base), "dev": nv(s.Dev), "z": nv(s.Z), "spike": s.Spike})
}

func RHRStateAt(h []HealthRow, date string) RHRState {
	base, v := rowsBefore(h, date, 30, rhrOf), nan
	if r := findRow(h, date); r != nil {
		v = r.RHR
	}
	if isNull(v) || len(base) < 7 {
		return RHRState{Value: v}
	}
	m, s := mean(base), sd(base)
	z := nan
	if !isNull(s) && s != 0 {
		z = rf((v-m)/s, 2)
	}
	return RHRState{Enough: true, Value: v, Base: rf(m, 1), Dev: rf(v-m, 1), Z: z, Spike: v-m >= 5}
}

// ---- sleep (COROS "Total" includes awake time → asleep = total − awake)
func asleepMin(r *HealthRow) float64 {
	if r == nil || isNull(r.SleepTotal) {
		return nan
	}
	aw := r.SleepAwake
	if isNull(aw) {
		aw = 0
	}
	return r.SleepTotal - aw
}

type SleepDay struct {
	Date          string
	Asleep, Delta float64
	Cum           float64
}

func (d SleepDay) MarshalJSON() ([]byte, error) {
	return json.Marshal(map[string]any{"date": d.Date, "asleep": nv(d.Asleep), "delta": nv(d.Delta), "cum": nv(d.Cum)})
}

type SleepState struct {
	Enough                                       bool
	AsleepMin, InBedMin, Eff, NeedMin, VsNeedMin float64
	Deep, REM, Light, Awake, Score, HRAvg        float64
	Series                                       []SleepDay
	DebtMin                                      float64
	Nights                                       int
}

func (s SleepState) MarshalJSON() ([]byte, error) {
	if !s.Enough {
		return json.Marshal(map[string]any{"enough": false, "series": s.Series, "debt_min": nv(s.DebtMin)})
	}
	return json.Marshal(map[string]any{"enough": true, "asleep_min": nv(s.AsleepMin), "in_bed_min": nv(s.InBedMin), "eff": nv(s.Eff), "need_min": nv(s.NeedMin), "vs_need_min": nv(s.VsNeedMin),
		"deep": nv(s.Deep), "rem": nv(s.REM), "light": nv(s.Light), "awake": nv(s.Awake), "score": nv(s.Score), "hr_avg": nv(s.HRAvg), "series": s.Series, "debt_min": nv(s.DebtMin), "nights": s.Nights})
}

func SleepStateAt(h []HealthRow, date string, needMin float64) SleepState {
	d := findRow(h, date)
	a := asleepMin(d)
	series, cum := make([]SleepDay, 14), 0.0
	for i := range series {
		day := addDays(date, i-13)
		x := asleepMin(findRow(h, day))
		series[i] = SleepDay{Date: day, Asleep: x, Delta: x - needMin}
		if !isNull(x) {
			cum += x - needMin
		}
		series[i].Cum = cum
	}
	debt := math.Max(0, -cum)
	if isNull(a) {
		return SleepState{Series: series, DebtMin: debt}
	}
	pct := func(m float64) float64 {
		if isNull(m) || d.SleepTotal == 0 {
			return nan
		}
		return jsRound(m / d.SleepTotal * 100)
	}
	nights := 0
	for _, s := range series {
		if !isNull(s.Delta) {
			nights++
		}
	}
	return SleepState{Enough: true, AsleepMin: a, InBedMin: d.SleepTotal, Eff: rf(a/d.SleepTotal*100, 0), NeedMin: needMin, VsNeedMin: a - needMin,
		Deep: pct(d.SleepDeep), REM: pct(d.SleepREM), Light: pct(d.SleepLight), Awake: pct(d.SleepAwake), Score: d.SleepScore, HRAvg: d.SleepHR,
		Series: series, DebtMin: debt, Nights: nights}
}

// ---- weekly running-distance progression: last 7 days vs the 7 before (Nielsen 2014: 10 % / 30 %)
type Activity struct {
	Date      string
	Run       bool // sport_class === 'run'
	DistanceM float64
}
type Progression struct {
	Cur, Prev, Pct float64
}

func (p Progression) MarshalJSON() ([]byte, error) {
	return json.Marshal(map[string]any{"cur": nv(p.Cur), "prev": nv(p.Prev), "pct": nv(p.Pct)})
}

func DistanceProgression(acts []Activity, date string) Progression {
	km := func(a, b string) float64 {
		s := 0.0
		for _, x := range acts {
			if x.Run && x.Date > a && x.Date <= b {
				s += x.DistanceM / 1000
			}
		}
		return s
	}
	cur, prev := km(addDays(date, -7), date), km(addDays(date, -14), addDays(date, -7))
	pct := nan
	if prev > 0 {
		pct = jsRound((cur - prev) / prev * 100)
	}
	return Progression{Cur: rf(cur, 1), Prev: rf(prev, 1), Pct: pct}
}
