// Package engine is the Go port of the sports-science core. Phase 2-a: FIT → 1 Hz series → session metrics.
// Every function mirrors server/intel/{fit,metrics}.js exactly (including rounding and null handling) so the output can be diffed against the golden fixtures.
package engine

import (
	"bufio"
	"errors"
	"math"
	"os"

	"github.com/muktihari/fit/decoder"
	"github.com/muktihari/fit/profile/mesgdef"
	"github.com/muktihari/fit/profile/typedef"
)

var nan = math.NaN()

// Series is the session at 1 Hz. Missing values are NaN. Units: speed m/s, distance m (cumulative), cadence steps/min, GCT ms, vertical oscillation mm, step length m, altitude m.
type Series struct {
	N                                                              int
	T0                                                             int64 // ms since epoch of the first record
	Speed, Dist, HR, Cad, Power, GCT, VO, VR, Step, Alt, Effort, V []float64
	Paused                                                         []bool
	Lat, Lon                                                       float64
	Session                                                        SessionInfo
}

type SessionInfo struct {
	Sport                                                                    string
	Elapsed, Timer, Distance, Ascent, Descent, AvgHR, MaxHR, TempC, AvgPower float64
}

func num(x float64) float64 {
	if math.IsInf(x, 0) {
		return nan
	}
	return x
}

// ReadFIT decodes a FIT file into a Series (the equivalent of parseFitFile + toSeries).
func ReadFIT(path string) (*Series, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	dec := decoder.New(bufio.NewReader(f))
	var recs []*mesgdef.Record
	var sess *mesgdef.Session
	effortName := map[[2]byte]string{} // (developer data index, field number) → name, from field_description messages
	for dec.Next() {
		fit, err := dec.Decode()
		if err != nil {
			return nil, err
		}
		for i := range fit.Messages {
			m := fit.Messages[i]
			switch m.Num {
			case typedef.MesgNumFieldDescription:
				d := mesgdef.NewFieldDescription(&m)
				effortName[[2]byte{d.DeveloperDataIndex, d.FieldDefinitionNumber}] = d.FieldName[0]
			case typedef.MesgNumRecord:
				r := mesgdef.NewRecord(&m)
				recs = append(recs, r)
			case typedef.MesgNumSession:
				if sess == nil {
					sess = mesgdef.NewSession(&m)
				}
			}
		}
	}
	return buildSeries(recs, sess, effortName)
}

func buildSeries(recs []*mesgdef.Record, sess *mesgdef.Session, names map[[2]byte]string) (*Series, error) {
	var rec []*mesgdef.Record
	for _, r := range recs {
		if !r.Timestamp.IsZero() {
			rec = append(rec, r)
		}
	}
	if len(rec) < 30 {
		return nil, errors.New("FIT: too few records")
	}
	t0 := rec[0].Timestamp.UnixMilli()
	n := int(math.Round(float64(rec[len(rec)-1].Timestamp.UnixMilli()-t0)/1000)) + 1
	mk := func() []float64 {
		a := make([]float64, n)
		for i := range a {
			a[i] = nan
		}
		return a
	}
	S := &Series{N: n, T0: t0, Speed: mk(), Dist: mk(), HR: mk(), Cad: mk(), Power: mk(), GCT: mk(), VO: mk(), VR: mk(), Step: mk(), Alt: mk(), Effort: mk(), Lat: nan, Lon: nan, Paused: make([]bool, n)}
	for i := range S.Paused {
		S.Paused[i] = true
	}
	for _, r := range rec {
		i := int(math.Round(float64(r.Timestamp.UnixMilli()-t0) / 1000))
		if i < 0 || i >= n {
			continue
		}
		S.Paused[i] = false
		sp := r.SpeedScaled() // fit-file-parser reports `speed`; enhanced_speed differs by 1 mm/s on some seconds
		if math.IsNaN(sp) {
			sp = r.EnhancedSpeedScaled()
		}
		S.Speed[i] = num(sp)
		S.Dist[i] = num(r.DistanceScaled())
		if r.HeartRate != 0xFF {
			S.HR[i] = float64(r.HeartRate)
		}
		al := r.EnhancedAltitudeScaled()
		if math.IsNaN(al) {
			al = r.AltitudeScaled()
		}
		S.Alt[i] = num(al)
		if r.Power != 0xFFFF {
			S.Power[i] = float64(r.Power)
		}
		if r.Cadence != 0xFF {
			frac := r.FractionalCadenceScaled()
			if math.IsNaN(frac) {
				frac = 0
			}
			S.Cad[i] = (float64(r.Cadence) + frac) * 2
		}
		if g := r.StanceTimeScaled(); g > 0 {
			S.GCT[i] = g
		}
		if v := r.VerticalOscillationScaled(); v > 0 {
			S.VO[i] = v
		}
		if v := r.VerticalRatioScaled(); v > 0 {
			S.VR[i] = v
		}
		if v := r.StepLengthScaled(); v > 0 {
			S.Step[i] = v / 1000
		}
		for _, d := range r.DeveloperFields {
			if names[[2]byte{d.DeveloperDataIndex, d.Num}] == "Effort Pace" {
				if f, ok := anyFloat(d.Value.Any()); ok {
					S.Effort[i] = f
				}
			}
		}
		if math.IsNaN(S.Lat) && r.PositionLat != math.MaxInt32 && r.PositionLong != math.MaxInt32 {
			S.Lat = float64(r.PositionLat) * (180 / 2147483648.0)
			S.Lon = float64(r.PositionLong) * (180 / 2147483648.0)
		}
	}
	// distance carried forward over gaps, speed 0 while paused
	last := 0.0
	for i := 0; i < n; i++ {
		if math.IsNaN(S.Dist[i]) {
			S.Dist[i] = last
		} else {
			last = S.Dist[i]
		}
		if S.Paused[i] {
			S.Speed[i] = 0
		}
	}
	// HR artefacts: outside 40–230 or > 25 bpm from the 5 s median (in place, as the JS does)
	for i := 0; i < n; i++ {
		h := S.HR[i]
		if math.IsNaN(h) {
			continue
		}
		if h < 40 || h > 230 {
			S.HR[i] = nan
			continue
		}
		var w []float64
		for j := max(0, i-2); j <= min(n-1, i+2); j++ {
			if !math.IsNaN(S.HR[j]) {
				w = append(w, S.HR[j])
			}
		}
		sortFloats(w)
		if len(w) >= 3 && math.Abs(h-w[len(w)>>1]) > 25 {
			S.HR[i] = nan
		}
	}
	if sess != nil {
		S.Session = SessionInfo{Sport: sess.Sport.String(), Elapsed: num(sess.TotalElapsedTimeScaled()), Timer: num(sess.TotalTimerTimeScaled()), Distance: num(sess.TotalDistanceScaled()),
			Ascent: nanIfInvalid16(sess.TotalAscent), Descent: nanIfInvalid16(sess.TotalDescent), AvgHR: nanIfInvalid8(sess.AvgHeartRate), MaxHR: nanIfInvalid8(sess.MaxHeartRate),
			TempC: nanIfInvalidS8(sess.AvgTemperature), AvgPower: nanIfInvalid16(sess.AvgPower)}
	} else {
		S.Session = SessionInfo{Elapsed: nan, Timer: nan, Distance: nan, Ascent: nan, Descent: nan, AvgHR: nan, MaxHR: nan, TempC: nan, AvgPower: nan}
	}
	return S, nil
}

func anyFloat(v any) (float64, bool) {
	switch x := v.(type) {
	case float64:
		return x, true
	case float32:
		return float64(x), true
	case uint8:
		return float64(x), true
	case uint16:
		return float64(x), true
	case uint32:
		return float64(x), true
	case int8:
		return float64(x), true
	case int16:
		return float64(x), true
	case int32:
		return float64(x), true
	}
	return 0, false
}
func nanIfInvalid8(x uint8) float64 {
	if x == 0xFF {
		return nan
	}
	return float64(x)
}
func nanIfInvalid16(x uint16) float64 {
	if x == 0xFFFF {
		return nan
	}
	return float64(x)
}
func nanIfInvalidS8(x int8) float64 {
	if x == 0x7F {
		return nan
	}
	return float64(x)
}
func sortFloats(a []float64) {
	for i := 1; i < len(a); i++ {
		for j := i; j > 0 && a[j] < a[j-1]; j-- {
			a[j], a[j-1] = a[j-1], a[j]
		}
	}
}
