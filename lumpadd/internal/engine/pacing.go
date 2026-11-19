package engine

import (
	"fmt"
	"math"
	"strconv"
)

// Race-pace simulator: port of src/lib/pacing.js. Heat penalty (rough interpolation of Ely 2007, a hypothesis) and the run-walk average
// pace → finish time and cut-off (COP) margins. Times in seconds, paces in s/km. A what-if calculator, not a prediction.
const FMMeters = 42195

// HeatPenalty: slowdown fraction, none at or below 8 °C WBGT, +0.25 % per °C, capped at 8 %. NaN = no WBGT.
func HeatPenalty(wbgt float64) float64 {
	if isNull(wbgt) || wbgt <= 8 {
		return 0
	}
	return math.Min(0.08, (wbgt-8)*0.0025)
}

// RunWalkPace: run runS seconds at runPace, walk walkS seconds at walkPace, repeat; walkS = 0 → continuous running. NaN = invalid.
func RunWalkPace(runPace, walkPace, runS, walkS float64) float64 {
	if !(runPace > 0) || !(runS > 0) {
		return nan
	}
	if !(walkS > 0) {
		return runPace
	}
	if !(walkPace > 0) {
		return nan
	}
	return (runS + walkS) / (runS/runPace + walkS/walkPace)
}

type COP struct {
	Name  string
	Km    float64
	Close string // "HH:MM" clock minutes after midnight, as on the race guide
}
type SimInput struct {
	RunPace, WalkPace, RunS, WalkS, WBGT float64
	GunMin, GoalS                        float64
	COPs                                 []COP
}
type SimPoint struct {
	Name       string  `json:"name"`
	Km         float64 `json:"km"`
	Closes     string  `json:"closes"`
	ArrivesMin float64 `json:"arrivesMin"`
	MarginMin  float64 `json:"marginMin"`
}
type SimResult struct {
	BasePace float64    `json:"basePace"`
	Pace     float64    `json:"pace"`
	Finish   float64    `json:"finish"`
	VsGoalS  float64    `json:"vsGoalS"`
	Points   []SimPoint `json:"points"`
	AllClear bool       `json:"allClear"`
}

// DefaultSim fills the JS defaults (walkPace 0, walkS 0, wbgt 0, gun 04:00, goal 4:00:00).
func DefaultSim() SimInput { return SimInput{GunMin: 240, GoalS: 14400} }

func Simulate(in SimInput) *SimResult {
	base := RunWalkPace(in.RunPace, in.WalkPace, in.RunS, in.WalkS)
	if isNull(base) {
		return nil
	}
	pace := base * (1 + HeatPenalty(in.WBGT))
	finish := pace * (FMMeters / 1000.0)
	pts, all := make([]SimPoint, len(in.COPs)), true
	for i, c := range in.COPs {
		h, _ := strconv.Atoi(c.Close[0:2])
		m, _ := strconv.Atoi(c.Close[3:5])
		at := in.GunMin + pace*c.Km/60
		pts[i] = SimPoint{c.Name, c.Km, c.Close, at, jsRound(float64(h*60+m) - at)}
		all = all && pts[i].MarginMin >= 0
	}
	return &SimResult{base, pace, finish, jsRound(finish - in.GoalS), pts, all}
}

// FmtHMS: h:mm:ss after rounding to whole seconds.
func FmtHMS(s float64) string {
	t := int(jsRound(s))
	return fmt.Sprintf("%d:%02d:%02d", t/3600, (t%3600)/60, t%60)
}
