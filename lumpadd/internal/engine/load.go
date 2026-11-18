package engine

import "math"

// Load model: port of src/lib/load.js. Daily load = COROS Training Load per day; CTL τ=42, ATL τ=7, TSB_t = CTL_{t-1} − ATL_{t-1}.
type DayLoad struct {
	Date string
	Load float64
}

type PMCPoint struct {
	Date   string  `json:"date"`
	Load   float64 `json:"load"`
	CTL    any     `json:"ctl"`
	ATL    any     `json:"atl"`
	TSB    any     `json:"tsb"`
	ACWR   any     `json:"acwr"`
	TSBPct any     `json:"tsbPct"`
}

func loads(s []DayLoad) []float64 {
	o := make([]float64, len(s))
	for i, d := range s {
		o[i] = d.Load
	}
	return o
}

// meanOr0 is `mean(...) || 0` (JS mean returns null for an empty array).
func meanOr0(a []float64) float64 {
	m := mean(a)
	if math.IsNaN(m) {
		return 0
	}
	return m
}

func Pmc(series []DayLoad, seedDays int) []PMCPoint {
	if len(series) == 0 {
		return []PMCPoint{}
	}
	seed := meanOr0(loads(series[:min(seedDays, len(series))]))
	ctl, atl := seed, seed
	out := make([]PMCPoint, len(series))
	for i, d := range series {
		tsb := ctl - atl
		ctl += (d.Load - ctl) / 42
		atl += (d.Load - atl) / 7
		p := PMCPoint{Date: d.Date, Load: d.Load, CTL: r1(ctl, 1), ATL: r1(atl, 1), TSB: r1(tsb, 1)}
		if ctl > 0 {
			p.ACWR, p.TSBPct = r1(atl/ctl, 2), r1((tsb/ctl)*100, 0)
		}
		out[i] = p
	}
	return out
}

// AcwrRolling: acute = mean of the last 7 days; chronic = mean of days 8–35 (the acute week is not included). idx < 0 means the last day.
func AcwrRolling(series []DayLoad, idx int) any {
	if idx < 0 {
		idx = len(series) - 1
	}
	if idx < 34 || idx >= len(series) {
		return nil
	}
	a, c := mean(loads(series[idx-6:idx+1])), mean(loads(series[idx-34:idx-6]))
	if c > 0 {
		return r1(a/c, 2)
	}
	return nil
}

type Monotony struct {
	Monotony any     `json:"monotony"`
	Strain   any     `json:"strain"`
	WeekLoad float64 `json:"weekLoad"`
}

// MonotonyStrain (Foster 1998, last 7 days); nil when fewer than 7 days.
func MonotonyStrain(series []DayLoad) *Monotony {
	if len(series) < 7 {
		return nil
	}
	w := loads(series[len(series)-7:])
	m, s := mean(w), sd(w)
	total := 0.0
	for _, x := range w {
		total += x
	}
	if s == 0 || math.IsNaN(s) {
		return &Monotony{WeekLoad: total}
	}
	return &Monotony{Monotony: r1(m/s, 2), Strain: jsRound(total * (m / s)), WeekLoad: total}
}

type FormZoneT struct{ ID, Label string }

// FormZone: relative to CTL (scale-free).
func FormZone(pct float64) *FormZoneT {
	switch {
	case math.IsNaN(pct):
		return nil
	case pct <= -30:
		return &FormZoneT{"overload", "Overload"}
	case pct <= -10:
		return &FormZoneT{"productive", "Productive"}
	case pct <= 5:
		return &FormZoneT{"grey", "Neutral"}
	case pct <= 25:
		return &FormZoneT{"fresh", "Fresh / peak"}
	}
	return &FormZoneT{"transition", "Transition / detraining"}
}

// CtlRamp: CTL change over 7 days (needs the rounded series from Pmc).
func CtlRamp(p []PMCPoint) any {
	if len(p) > 7 {
		return r1(p[len(p)-1].CTL.(float64)-p[len(p)-8].CTL.(float64), 1)
	}
	return nil
}

// Project runs the EWMA forward with planned daily loads, starting from a rounded PMC point.
type ProjPoint struct {
	Date string  `json:"date"`
	Load float64 `json:"load"`
	CTL  any     `json:"ctl"`
	ATL  any     `json:"atl"`
	TSB  any     `json:"tsb"`
}

func Project(last PMCPoint, planned []DayLoad) []ProjPoint {
	ctl, atl := last.CTL.(float64), last.ATL.(float64)
	out := make([]ProjPoint, len(planned))
	for i, d := range planned {
		tsb := ctl - atl
		ctl += (d.Load - ctl) / 42
		atl += (d.Load - atl) / 7
		out[i] = ProjPoint{Date: d.Date, Load: d.Load, CTL: r1(ctl, 1), ATL: r1(atl, 1), TSB: r1(tsb, 1)}
	}
	return out
}
