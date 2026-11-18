package engine

import (
	"fmt"
	"math"
)

// Daniels–Gilbert equations (port of src/lib/vdot.js). [ALGORITHMIC, calculated]
func vo2(v float64) float64 { return -4.6 + 0.182258*v + 0.000104*v*v } // v in m/min
func pctMax(t float64) float64 { // t in min
	return 0.8 + 0.1894393*math.Exp(-0.012778*t) + 0.2989558*math.Exp(-0.1932605*t)
}

func VdotFromRace(meters, seconds float64) float64 {
	t := seconds / 60
	return vo2(meters/t) / pctMax(t)
}
func velAtVO2(x float64) float64 { // m/min
	a, b, c := 0.000104, 0.182258, -4.6-x
	return (-b + math.Sqrt(b*b-4*a*c)) / (2 * a)
}

// RaceTime in seconds by bisection (80 iterations, as the JS).
func RaceTime(vdot, meters float64) float64 {
	lo, hi := 60.0, 3600.0*8
	for i := 0; i < 80; i++ {
		mid := (lo + hi) / 2
		if VdotFromRace(meters, mid) > vdot {
			lo = mid
		} else {
			hi = mid
		}
	}
	return (lo + hi) / 2
}
func PaceSecPerKm(vdot, frac float64) float64 { return 60000 / velAtVO2(vdot*frac) }

type Paces struct {
	E                       [2]float64 // slow..fast
	T, SubT, I, R, M        float64
	FiveK, TenK, Half, Full float64
}

func PacesFor(vdot float64) Paces {
	T := PaceSecPerKm(vdot, 0.888)
	return Paces{E: [2]float64{PaceSecPerKm(vdot, 0.59), PaceSecPerKm(vdot, 0.74)}, T: T, SubT: T + 12, I: PaceSecPerKm(vdot, 1.0), R: RaceTime(vdot, 1609.34) / 1.60934,
		M: RaceTime(vdot, 42195) / 42.195, FiveK: RaceTime(vdot, 5000), TenK: RaceTime(vdot, 10000), Half: RaceTime(vdot, 21097.5), Full: RaceTime(vdot, 42195)}
}

func FmtPace(s float64) string {
	return fmt.Sprintf("%d:%02d", int(math.Floor(s/60)), int(jsRound(math.Mod(s, 60))))
}
func FmtTime(s float64) string {
	s = jsRound(s)
	h, m, x := int(math.Floor(s/3600)), int(math.Floor(math.Mod(s, 3600)/60)), int(math.Mod(s, 60))
	if h > 0 {
		return fmt.Sprintf("%d:%02d:%02d", h, m, x)
	}
	return fmt.Sprintf("%d:%02d", m, x)
}
