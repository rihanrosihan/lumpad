package engine

import "encoding/json"

// Zone ranges, per-lap zone time and the COROS-style workout estimate: port of src/lib/zones.js (the UI text helpers stay in the client).

type ZoneCfg struct{ LTHR, TPace float64 }

// HRRange / PaceRange: the rounded numbers the plan displays (bpm [lo, hi]; pace [fast, slow] s/km); ok=false for an unknown zone.
func HRRange(z int, c ZoneCfg) ([2]float64, bool) {
	if z < 1 || z > 6 {
		return [2]float64{}, false
	}
	return hrRange(z, c.LTHR), true
}
func PaceRange(z int, c ZoneCfg) ([2]float64, bool) {
	if z < 1 || z > 6 {
		return [2]float64{}, false
	}
	return paceRange(z, c.TPace), true
}

type Lap struct{ DurationS, AvgHR, AvgPace float64 }

// ZoneSeconds: seconds per zone (index 0 = below Z1, 1..6) from per-km laps, time-weighted; laps without HR / pace are skipped.
func ZoneSeconds(laps []Lap, c ZoneCfg) (hr, pace [7]float64) {
	for _, l := range laps {
		d := l.DurationS
		if isNull(d) {
			d = 0
		}
		if !isNull(l.AvgHR) && l.AvgHR != 0 {
			hr[HrZoneOf(l.AvgHR, c.LTHR)] += d
		}
		if !isNull(l.AvgPace) && l.AvgPace != 0 {
			pace[PaceZoneOf(l.AvgPace, c.TPace)] += d
		}
	}
	return
}

// Step: { t: wu|cd|run|rec|tt|race|free, sec?, m?, z?, pace? [fast, slow] } or a repeat { rep, steps }. NaN / 0 = absent.
type Step struct {
	T      string    `json:"t"`
	Sec    float64   `json:"sec"`
	M      float64   `json:"m"`
	Z      int       `json:"z"`
	Pace   []float64 `json:"pace"`
	Rep    int       `json:"rep"`
	Steps  []Step    `json:"steps"`
	HasSec bool      `json:"-"` // sec given (0 counts: JS `s.sec ?? …`)
}

// estimated pace multiple of threshold pace per zone (fits COROS's own estimates within ~2 %) and training load per minute
var estPace = map[int]float64{1: 1.36, 2: 1.28, 3: 1.12, 4: 1.025, 5: 0.985, 6: 0.93}
var tlPerMin = map[int]float64{0: 0, 1: 1.2, 2: 1.68, 3: 2.74, 4: 3.86, 5: 5.0, 6: 6.0}

func Flat(steps []Step) []Step {
	out := []Step{}
	for _, s := range steps {
		if s.Rep > 0 {
			for i := 0; i < s.Rep; i++ {
				out = append(out, s.Steps...)
			}
			continue
		}
		out = append(out, s)
	}
	return out
}

// StepKm: distance sections only, km to 2 decimals (COROS counts warm-up/cool-down time separately)
func StepKm(steps []Step) float64 {
	m := 0.0
	for _, s := range Flat(steps) {
		m += s.M
	}
	return jsRound(m/10) / 100
}

func secOf(s Step, c ZoneCfg) float64 {
	if s.HasSec {
		return s.Sec
	}
	if s.M == 0 {
		return 0
	}
	if len(s.Pace) == 2 {
		return s.M / 1000 * (s.Pace[0] + s.Pace[1]) / 2
	}
	z := s.Z
	if z == 0 {
		z = 2
	}
	return s.M / 1000 * c.TPace * estPace[z]
}

// Estimate: duration (s) and COROS-style training load; warm-up and cool-down add time but no load.
func Estimate(steps []Step, c ZoneCfg) (sec, tl float64) {
	for _, s := range Flat(steps) {
		d := secOf(s, c)
		sec += d
		if s.T != "wu" && s.T != "cd" {
			z := s.Z
			if z == 0 && s.T == "free" {
				z = 2
			}
			tl += d / 60 * tlPerMin[z]
		}
	}
	return jsRound(sec), jsRound(tl)
}

// UnmarshalJSON reads plan steps as stored by the client; a present "sec" (even 0) wins over the distance estimate, as `s.sec ?? …` does.
func (s *Step) UnmarshalJSON(b []byte) error {
	type raw Step
	var r struct {
		raw
		Sec *float64 `json:"sec"`
	}
	if err := json.Unmarshal(b, &r); err != nil {
		return err
	}
	*s = Step(r.raw)
	if r.Sec != nil {
		s.Sec, s.HasSec = *r.Sec, true
	}
	return nil
}
