package engine

import "math"

const (
	StopMS = 0.3
	RunCad = 125
)

// Baseline mirrors BASELINE in server/intel/metrics.js (LTHR, HRmax, threshold pace from src/lib/athlete.js).
type Baseline struct{ GCT, Cad, LTHR, HRmax, TPace float64 }

var DefaultBaseline = Baseline{GCT: 300, Cad: 170, LTHR: 168, HRmax: 189, TPace: 356}

// ---- JS-compatible helpers ---------------------------------------------------------------------------------------------------------
func jsRound(x float64) float64 { return math.Floor(x + 0.5) }

// r1 = Math.round(x*10^d)/10^d, or nil (JS null) when x is NaN.
func r1(x float64, d int) any {
	if math.IsNaN(x) {
		return nil
	}
	p := math.Pow(10, float64(d))
	return jsRound(x*p) / p
}
func rf(x float64, d int) float64 { // numeric form of r1 (NaN stays NaN) used where later maths reads the rounded value, as the JS does
	if math.IsNaN(x) {
		return nan
	}
	p := math.Pow(10, float64(d))
	return jsRound(x*p) / p
}
func mean(a []float64) float64 {
	s, n := 0.0, 0
	for _, x := range a {
		if !math.IsNaN(x) {
			s += x
			n++
		}
	}
	if n == 0 {
		return nan
	}
	return s / float64(n)
}

// meanNull is JS mean() over values that may be null: null is not NaN in JS, so it counts as 0 (fadeOnset's references depend on this).
func meanNull(a []float64) float64 {
	s := 0.0
	for _, x := range a {
		if !math.IsNaN(x) {
			s += x
		}
	}
	if len(a) == 0 {
		return nan
	}
	return s / float64(len(a))
}
func sd(a []float64) float64 {
	var v []float64
	for _, x := range a {
		if !math.IsNaN(x) {
			v = append(v, x)
		}
	}
	m := mean(v)
	if len(v) > 1 {
		s := 0.0
		for _, x := range v {
			s += (x - m) * (x - m)
		}
		return math.Sqrt(s / float64(len(v)-1))
	}
	return nan
}
func paceOf(speed float64) float64 {
	if speed > 0 {
		return 1000 / speed
	}
	return nan
}

// ---- classification and grade --------------------------------------------------------------------------------------------------------
func stepSpeed(S *Series) []float64 {
	v := make([]float64, S.N)
	for i := 1; i < S.N; i++ {
		v[i] = S.Dist[i] - S.Dist[i-1]
	}
	if S.N > 1 {
		v[0] = v[1]
	}
	return v
}

// Classify: 0 stop, 1 walk, 2 run (also sets S.V).
func Classify(S *Series) []uint8 {
	c := make([]uint8, S.N)
	lastCad, since := nan, 99
	if S.V == nil {
		S.V = stepSpeed(S)
	}
	for i := 0; i < S.N; i++ {
		sp := S.V[i]
		if !(sp >= StopMS) {
			c[i] = 0
			continue
		}
		cad := S.Cad[i]
		if math.IsNaN(cad) {
			if since <= 5 {
				cad = lastCad
			} else {
				cad = nan
			}
		} else {
			lastCad, since = cad, 0
		}
		since++
		switch {
		case math.IsNaN(cad):
			if sp >= 2.0 {
				c[i] = 2
			} else {
				c[i] = 1
			}
		case cad >= RunCad:
			c[i] = 2
		default:
			c[i] = 1
		}
	}
	return c
}

func GradeSeries(S *Series) []float64 {
	a := make([]float64, S.N)
	g := make([]float64, S.N)
	const W = 15
	for i := 0; i < S.N; i++ {
		s, k := 0.0, 0
		for j := max(0, i-7); j <= min(S.N-1, i+7); j++ {
			if !math.IsNaN(S.Alt[j]) {
				s += S.Alt[j]
				k++
			}
		}
		if k > 0 {
			a[i] = s / float64(k)
		} else {
			a[i] = nan
		}
	}
	for i := W; i < S.N-W; i++ {
		dd, da := S.Dist[i+W]-S.Dist[i-W], a[i+W]-a[i-W]
		if dd > 20 && !math.IsNaN(da) {
			g[i] = math.Max(-0.15, math.Min(0.15, da/dd))
		}
	}
	return g
}

// ---- windows and per-km ---------------------------------------------------------------------------------------------------------------
type Win struct {
	Elapsed, Stop, Walk, Run, Moving                                                    int
	RunShare, RunSpeed, RunPace, RunHr, RunPower, RunCad, RunGct, RunStep, RunVr, RunVo float64
	Economy, BeatsKm, EF                                                                float64
}

func Window(S *Series, cls []uint8, i0, i1 int) Win {
	var stop, walk, run, n int
	sp := 0.0
	var hr, pw, cad, gct, st, vr, vo []float64
	for i := i0; i < min(i1, S.N); i++ {
		n++
		switch cls[i] {
		case 0:
			stop++
		case 1:
			walk++
		default:
			run++
			if S.V != nil {
				sp += S.V[i]
			} else {
				sp += S.Speed[i]
			}
			hr, pw, cad, gct, st, vr, vo = append(hr, S.HR[i]), append(pw, S.Power[i]), append(cad, S.Cad[i]), append(gct, S.GCT[i]), append(st, S.Step[i]), append(vr, S.VR[i]), append(vo, S.VO[i])
		}
	}
	runSpeed := nan
	if run > 0 {
		runSpeed = sp / float64(run)
	}
	runHr, runPw := mean(hr), mean(pw)
	w := Win{Elapsed: n, Stop: stop, Walk: walk, Run: run, Moving: n - stop, RunShare: nan, RunSpeed: runSpeed, RunPace: paceOf(runSpeed), RunHr: runHr, RunPower: runPw, RunCad: mean(cad), RunGct: mean(gct), RunStep: mean(st), RunVr: mean(vr), RunVo: mean(vo), Economy: nan, EF: nan}
	if n > 0 {
		w.RunShare = float64(run) / float64(n)
	}
	if runSpeed > 0 {
		w.Economy = runPw / runSpeed
	}
	w.BeatsKm = runHr * (paceOf(runSpeed) / 60)
	if runHr > 0 {
		w.EF = (runSpeed * 60) / runHr
	}
	return w
}

func distRange(S *Series, d0, d1 float64) (int, int) {
	a := 0
	for a < S.N && S.Dist[a] < d0 {
		a++
	}
	b := a
	for b < S.N && S.Dist[b] < d1 {
		b++
	}
	return a, b
}

// KM is one kilometre; fields hold the ROUNDED values the JS stores (NaN = JS null) because later steps read them.
type KM struct {
	Km, Sec, Run, Walk, Stop                                         int
	RunShare, Pace, RunPace, HR, Power, Cad, GCT, Step, VR, EF, Gain float64
}

func PerKm(S *Series, cls []uint8, grade []float64) []KM {
	var out []KM
	total := S.Dist[S.N-1]
	for k := 0; float64(k)*1000 < total; k++ {
		a, b := distRange(S, float64(k)*1000, float64(k+1)*1000)
		if b-a < 20 {
			continue
		}
		w := Window(S, cls, a, b)
		gain := 0.0
		for i := a + 1; i < b; i++ {
			if grade[i] > 0 {
				gain += grade[i] * (S.Dist[i] - S.Dist[i-1])
			}
		}
		den := (S.Dist[b-1] - S.Dist[a]) / 1000
		pace := nan
		if den != 0 {
			pace = float64(w.Elapsed) / den
		}
		out = append(out, KM{Km: k + 1, Sec: w.Elapsed, Run: w.Run, Walk: w.Walk, Stop: w.Stop, RunShare: rf(w.RunShare, 3), Pace: rf(pace, 0), RunPace: rf(w.RunPace, 0),
			HR: rf(mean(S.HR[a:b]), 0), Power: rf(w.RunPower, 0), Cad: rf(w.RunCad, 0), GCT: rf(w.RunGct, 0), Step: rf(w.RunStep, 3), VR: rf(w.RunVr, 2), EF: rf(w.EF, 3), Gain: rf(gain, 0)})
	}
	return out
}

// ---- steady blocks, HR at pace ------------------------------------------------------------------------------------------------------
type Block struct {
	At       int
	Pace, HR float64
}

func SteadyBlocks(S *Series, cls []uint8, grade []float64) []Block {
	var blocks []Block
	prev := nan
	for a := 180; a+60 <= min(S.N, 3600); a += 60 {
		ok := true
		var sp, cad, hr []float64
		g := 0.0
		for i := a; i < a+60; i++ {
			if cls[i] != 2 {
				ok = false
				break
			}
			sp, cad, g = append(sp, S.Speed[i]), append(cad, S.Cad[i]), g+grade[i]
			if i >= a+10 {
				hr = append(hr, S.HR[i])
			}
		}
		if !ok {
			prev = nan
			continue
		}
		msp := mean(sp)
		pace := paceOf(msp)
		mg := math.Abs(g / 60)
		mh := mean(hr)
		good := mean(cad) >= 150 && mg < 0.025 && sd(sp)/msp < 0.08 && !math.IsNaN(mh) && !(math.Abs(pace-prev)/prev >= 0.08)
		prev = pace
		if good {
			blocks = append(blocks, Block{At: a, Pace: pace, HR: mh})
		}
	}
	return blocks
}

type HRPace struct {
	HR800, PaceAtHR150       any
	HR800Min, PaceAtHR150Min int
}

func HrAtPace(blocks []Block) HRPace {
	const slope, minBlocks = -0.073, 5
	var P, H []Block
	for _, b := range blocks {
		if b.Pace >= 460 && b.Pace <= 500 {
			P = append(P, b)
		}
		if b.HR >= 146 && b.HR <= 154 {
			H = append(H, b)
		}
	}
	r := HRPace{HR800Min: len(P), PaceAtHR150Min: len(H)}
	if len(P) >= minBlocks {
		var v []float64
		for _, b := range P {
			v = append(v, b.HR+slope*(480-b.Pace))
		}
		r.HR800 = r1(mean(v), 1)
	}
	if len(H) >= minBlocks {
		var v []float64
		for _, b := range H {
			v = append(v, b.Pace)
		}
		r.PaceAtHR150 = r1(mean(v), 0)
	}
	return r
}

// ---- drift and fades -------------------------------------------------------------------------------------------------------------------
func Drift(S *Series, cls []uint8) map[string]any {
	a, b := 600, S.N
	if b-a < 2700 {
		return map[string]any{"value": nil, "why": "steady portion < 45 min"}
	}
	w := Window(S, cls, a, b)
	if w.RunShare < 0.9 {
		return map[string]any{"value": nil, "why": "run share < 90 %"}
	}
	var blocks []float64
	for i := a; i+60 <= b; i += 60 {
		blocks = append(blocks, mean(S.Speed[i:i+60]))
	}
	if sd(blocks)/mean(blocks) >= 0.08 {
		return map[string]any{"value": nil, "why": "pace CV >= 8 % (not steady)"}
	}
	m := a + ((b - a) >> 1)
	h1, h2 := Window(S, cls, a, m), Window(S, cls, m, b)
	if !(h1.EF > 0 && h2.EF > 0) {
		return map[string]any{"value": nil, "why": "no HR"}
	}
	return map[string]any{"value": r1(((h1.EF-h2.EF)/h1.EF)*100, 2), "ef1": r1(h1.EF, 3), "ef2": r1(h2.EF, 3)}
}

func runIdx(S *Series, cls []uint8) []int {
	var idx []int
	for i := 600; i < S.N; i++ {
		if cls[i] == 2 {
			idx = append(idx, i)
		}
	}
	return idx
}

func RunPhaseDrift(S *Series, cls []uint8) map[string]any {
	idx := runIdx(S, cls)
	if len(idx) < 3600 {
		return map[string]any{"value": nil, "why": "run phase < 60 min after warm-up"}
	}
	ef := func(ids []int) float64 {
		sp := 0.0
		var h []float64
		for _, i := range ids {
			sp += S.Speed[i]
			h = append(h, S.HR[i])
		}
		return (sp / float64(len(ids))) * 60 / mean(h)
	}
	h := len(idx) >> 1
	e1, e2 := ef(idx[:h]), ef(idx[h:])
	return map[string]any{"value": r1(((e1-e2)/e1)*100, 2), "ef1": r1(e1, 3), "ef2": r1(e2, 3)}
}

func BioFade(S *Series, cls []uint8) map[string]any {
	idx := runIdx(S, cls)
	if len(idx) < 1800 {
		return nil
	}
	q := len(idx) >> 2
	A, B := idx[:q], idx[len(idx)-q:]
	m := func(ids []int, arr []float64) float64 {
		v := make([]float64, len(ids))
		for i, k := range ids {
			v[i] = arr[k]
		}
		return mean(v)
	}
	eff := func(ids []int) float64 {
		v := make([]float64, len(ids))
		for i, k := range ids {
			v[i] = S.Speed[k] - S.Effort[k]
		}
		return mean(v)
	}
	return map[string]any{"gct_ms": r1(m(B, S.GCT)-m(A, S.GCT), 1), "stride_m": r1(m(B, S.Step)-m(A, S.Step), 3), "vratio_pct": r1(m(B, S.VR)-m(A, S.VR), 2), "vo_mm": r1(m(B, S.VO)-m(A, S.VO), 1),
		"cadence": r1(m(B, S.Cad)-m(A, S.Cad), 1), "power_w": r1(m(B, S.Power)-m(A, S.Power), 1), "effort_gap_ms": r1(eff(B)-eff(A), 3), "n_run_s": len(idx)}
}

func FadeOnset(km []KM) map[string]any {
	if len(km) < 8 {
		return nil
	}
	var ref []KM
	for _, k := range km[1:4] {
		if k.RunShare >= 0.8 {
			ref = append(ref, k)
		}
	}
	var cs, gs []float64
	for _, k := range ref {
		cs, gs = append(cs, k.Cad), append(gs, k.GCT)
	}
	c0, g0 := meanNull(cs), meanNull(gs)
	if len(ref) < 2 {
		return map[string]any{"km": nil, "trigger": "no clean reference km 2–4"}
	}
	for i := 4; i < len(km); i++ {
		var sh []float64
		for _, k := range km[i:min(i+2, len(km))] {
			sh = append(sh, k.RunShare)
		}
		share := meanNull(sh)
		k := km[i]
		if share < 0.85 {
			return map[string]any{"km": k.Km, "trigger": "run_share<85%"}
		}
		if k.RunShare >= 0.5 && !math.IsNaN(k.GCT) && !math.IsNaN(g0) && k.GCT > g0+15 {
			return map[string]any{"km": k.Km, "trigger": "gct>ref+15"}
		}
		if k.RunShare >= 0.5 && !math.IsNaN(k.Cad) && !math.IsNaN(c0) && k.Cad < c0-5 {
			return map[string]any{"km": k.Km, "trigger": "cadence<ref-5"}
		}
	}
	return map[string]any{"km": nil, "trigger": "none"}
}

func MechAbs(km []KM, b Baseline) any {
	for _, x := range km {
		if x.RunShare >= 0.5 && ((!math.IsNaN(x.Cad) && x.Cad < b.Cad-5) || (!math.IsNaN(x.GCT) && x.GCT > b.GCT+15)) {
			return x.Km
		}
	}
	return nil
}
