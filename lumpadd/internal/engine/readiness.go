package engine

import (
	"math"
	"math/big"
	"strings"
)

// Composite readiness: port of src/lib/readiness.js (docs/readiness-model.md §2). Four pillars, phase-adjusted weights,
// capped by the athlete's validated gates so the score can never contradict them.

type Weights struct {
	MSK   float64 `json:"msk"`
	ANS   float64 `json:"ans"`
	Sleep float64 `json:"sleep"`
	Load  float64 `json:"load"`
}

func WeightsFor(phase string) Weights {
	switch phase {
	case "TAPER", "RACE WEEK":
		return Weights{30, 30, 25, 15}
	case "PEAK":
		return Weights{30, 25, 20, 25}
	}
	return Weights{30, 30, 20, 20}
}

type Tier struct {
	Min    float64 `json:"min"`
	ID     string  `json:"id"`
	Label  string  `json:"label"`
	Color  string  `json:"color"`
	Advice string  `json:"advice"`
}

var Tiers = []Tier{
	{85, "prime", "Prime", "green", "Ready for I/R work or a race effort."},
	{65, "optimal", "Optimal", "teal", "Run T, M or the long run as planned."},
	{45, "compromised", "Compromised", "yellow", "Scale down: swap the hard session for easy, or cut volume 20–30 %."},
	{0, "depleted", "Depleted", "red", "Rest or very light recovery."},
}

func TierOf(s float64) *Tier {
	if isNull(s) {
		return nil
	}
	for i := range Tiers {
		if s >= Tiers[i].Min {
			return &Tiers[i]
		}
	}
	return nil
}

// Comp: one scored component. Value is what the UI shows (string, number or nil); Pts nil = no data.
type Comp struct {
	ID    string  `json:"id"`
	Label string  `json:"label"`
	Max   float64 `json:"max"`
	Value any     `json:"value"`
	Pts   any     `json:"pts"`
}
type Pillar struct {
	Weight     float64 `json:"weight"`
	HaveWeight float64 `json:"haveWeight"`
	Earned     float64 `json:"earned"`
	Comps      []Comp  `json:"comps"`
}

func pillarScore(comps []Comp, weight float64) Pillar {
	max, haveMax, got := 0.0, 0.0, 0.0
	for _, c := range comps {
		max += c.Max
		if p, ok := c.Pts.(float64); ok {
			haveMax += c.Max
			got += p
		}
	}
	scale := weight / max
	out := make([]Comp, len(comps))
	for i, c := range comps {
		c.Max *= scale
		if p, ok := c.Pts.(float64); ok {
			c.Pts = p * scale
		}
		out[i] = c
	}
	return Pillar{Weight: weight, HaveWeight: haveMax * scale, Earned: got * scale, Comps: out}
}

// Checkin: the morning check-in (kv lumpad.daily.<date>). NaN = not answered (” or null in JS).
type Checkin struct {
	Pain, Energy, SleepHR float64
	HRV                   string // 'reduced' triggers a cap before a hard session
	Tibia                 bool   // true only when answered "tender"
}

type ReadinessInput struct {
	F           Checkin
	HRV         HRVState
	RHR         RHRState
	Sleep       SleepState
	PMC         *PMCPoint
	Monotony    *Monotony
	Progression *Progression
	MuscleMax   float64 // 0–3, NaN = none
	Phase       string
	Hard        bool
	SleepHR     float64 // from the night's data, NaN = none; the check-in value wins
}

type Cap struct {
	Max float64 `json:"max"`
	Why string  `json:"why"`
}
type Pillars struct {
	MSK   Pillar `json:"msk"`
	ANS   Pillar `json:"ans"`
	Sleep Pillar `json:"sleep"`
	Load  Pillar `json:"load"`
}
type Readiness struct {
	Score    any     `json:"score"`
	Raw      any     `json:"raw"`
	Capped   bool    `json:"capped"`
	Caps     []Cap   `json:"caps"`
	Tier     *Tier   `json:"tier"`
	Coverage float64 `json:"coverage"`
	Weights  Weights `json:"weights"`
	Pillars  Pillars `json:"pillars"`
}

// toFixed: JS Number.prototype.toFixed (exact decimal value, ties to the larger magnitude).
func toFixed(x float64, d int) string {
	if math.IsNaN(x) || math.IsInf(x, 0) {
		return "NaN"
	}
	neg := x < 0
	s := new(big.Float).SetFloat64(math.Abs(x)).Text('f', 1100)
	dot := strings.IndexByte(s, '.')
	digits := []byte(s[:dot] + s[dot+1:dot+1+d])
	if s[dot+1+d] >= '5' { // round half up on the exact expansion
		i := len(digits) - 1
		for ; i >= 0; i-- {
			if digits[i] == '9' {
				digits[i] = '0'
				continue
			}
			digits[i]++
			break
		}
		if i < 0 {
			digits = append([]byte{'1'}, digits...)
		}
	}
	ip, fp := string(digits[:len(digits)-d]), string(digits[len(digits)-d:])
	out := ip
	if d > 0 {
		out += "." + fp
	}
	if neg && strings.Trim(out, "0.") != "" {
		out = "-" + out
	}
	return out
}

func numOrNil(x float64) any { return nv(x) }
func ptsIf(ok bool, v float64) any {
	if ok {
		return v
	}
	return nil
}
func valIf(ok bool, v string) any {
	if ok {
		return v
	}
	return nil
}

func ComputeReadiness(in ReadinessInput) Readiness {
	w, f := WeightsFor(in.Phase), in.F
	hasPain, hasEnergy := !isNull(f.Pain), !isNull(f.Energy)
	painPts := 15.0
	if hasPain && f.Pain >= 2 {
		painPts = 0
	} else if hasPain && f.Pain == 1 {
		painPts = 9
	}
	msk := pillarScore([]Comp{
		{"pain", "Pain while running (worst site)", 15, valIf(hasPain, jsNum(f.Pain)+"/10"), ptsIf(hasPain, painPts)},
		{"energy", "How the body feels today", 12, valIf(hasEnergy, jsNum(f.Energy)+"/5"), ptsIf(hasEnergy, lin(f.Energy, 1, 0, 5, 12))},
		{"muscle", "Muscle load (from strength work)", 3, valIf(!isNull(in.MuscleMax), toFixed(in.MuscleMax, 1)+"/3"), ptsIf(!isNull(in.MuscleMax), clamp(3-in.MuscleMax, 0, 3))},
	}, w.MSK)

	h, r := in.HRV, in.RHR
	dayPts := 2.0
	if h.ZToday >= -1 {
		dayPts = 5
	}
	cvPts := 3.0
	if h.FlagCv {
		cvPts = 0
	}
	sign := ""
	if r.Dev > 0 {
		sign = "+"
	}
	ans := pillarScore([]Comp{
		{"hrv7", "HRV 7-day vs baseline", 16, valIf(h.Enough, "z "+jsNum(h.Z7)), ptsIf(h.Enough, lin(h.Z7, -2, 0, -0.5, 16))},
		{"hrvday", "Overnight HRV", 5, valIf(h.Enough && !isNull(h.ZToday), "z "+jsNum(h.ZToday)), ptsIf(h.Enough && !isNull(h.ZToday), dayPts)},
		{"cv", "Stabilitas HRV (CV)", 3, valIf(h.Enough && !isNull(h.CV7), jsNum(h.CV7)+"%"), ptsIf(h.Enough && !isNull(h.CV7) && !isNull(h.CVMean), cvPts)},
		{"rhr", "Resting HR vs 30 days", 6, valIf(r.Enough, sign+jsNum(r.Dev)+" bpm"), ptsIf(r.Enough, lin(r.Dev, 2, 6, 6, 0))},
	}, w.ANS)

	s := in.Sleep
	debtOK := s.Enough && s.Nights >= 7 // nights only exists when there is a night to score
	slp := pillarScore([]Comp{
		{"dur", "Sleep vs need", 10, valIf(s.Enough, jsNum(jsRound(s.AsleepMin))+" min"), ptsIf(s.Enough, lin(s.AsleepMin, s.NeedMin-120, 0, s.NeedMin, 10))},
		{"debt", "Sleep debt 14 days", 6, valIf(debtOK, jsNum(jsRound(s.DebtMin/6)/10)+" h"), ptsIf(debtOK, lin(s.DebtMin, 120, 6, 480, 0))},
		{"eff", "Sleep efficiency", 4, valIf(s.Enough, jsNum(s.Eff)+"%"), ptsIf(s.Enough, lin(s.Eff, 75, 0, 90, 4))},
	}, w.Sleep)

	acwr, tsbPct := nan, nan
	if in.PMC != nil {
		if v, ok := in.PMC.ACWR.(float64); ok {
			acwr = v
		}
		if v, ok := in.PMC.TSBPct.(float64); ok {
			tsbPct = v
		}
	}
	prog, mono := nan, nan
	if in.Progression != nil {
		prog = in.Progression.Pct
	}
	if in.Monotony != nil {
		if v, ok := in.Monotony.Monotony.(float64); ok {
			mono = v
		}
	}
	step := func(x float64, f func(float64) float64) any {
		if isNull(x) {
			return nil
		}
		return f(x)
	}
	ld := pillarScore([]Comp{
		{"acwr", "ACWR (EWMA)", 6, numOrNil(acwr), step(acwr, func(a float64) float64 {
			switch {
			case a > 1.5:
				return 0
			case a > 1.3:
				return 3
			case a < 0.8:
				return 5
			}
			return 6
		})},
		{"form", "Form (% fitness)", 6, valIf(!isNull(tsbPct), jsNum(tsbPct)+"%"), step(tsbPct, func(p float64) float64 {
			switch {
			case p >= -10:
				return 6
			case p >= -30:
				return 4
			}
			return 1
		})},
		{"prog", "Weekly distance progression", 5, valIf(!isNull(prog), jsNum(prog)+"%"), step(prog, func(p float64) float64 {
			switch {
			case p < 10:
				return 5
			case p <= 30:
				return 3
			}
			return 0
		})},
		{"mono", "Monotony 7-day", 3, numOrNil(mono), step(mono, func(m float64) float64 {
			switch {
			case m <= 1.5:
				return 3
			case m <= 2:
				return 1.5
			}
			return 0
		})},
	}, w.Load)

	P := Pillars{msk, ans, slp, ld}
	haveW := msk.HaveWeight + ans.HaveWeight + slp.HaveWeight + ld.HaveWeight
	earned := msk.Earned + ans.Earned + slp.Earned + ld.Earned
	score := nan
	if haveW >= 60 {
		score = jsRound(earned / haveW * 100)
	}
	caps := []Cap{}
	if hasPain && f.Pain >= 2 {
		caps = append(caps, Cap{44, "Pain " + jsNum(f.Pain) + "/10 ≥ 2 → durability event"})
	}
	shr := in.SleepHR
	if !isNull(f.SleepHR) {
		shr = f.SleepHR
	}
	if !isNull(shr) && shr > 67 && in.Hard {
		caps = append(caps, Cap{64, "Sleep HR " + jsNum(shr) + " > 67 before a hard session [VALIDATED]"})
	}
	if f.HRV == "reduced" && in.Hard {
		caps = append(caps, Cap{64, "HRV Reduced + hard session"})
	}
	if f.Tibia {
		caps = append(caps, Cap{64, "Tibia tender (MTSS history)"})
	}
	capped := score
	if !isNull(score) && len(caps) > 0 {
		for _, c := range caps {
			capped = math.Min(capped, c.Max)
		}
	}
	return Readiness{Score: nv(capped), Raw: nv(score), Capped: !(capped == score || (isNull(capped) && isNull(score))), Caps: caps, Tier: TierOf(capped),
		Coverage: jsRound(haveW), Weights: w, Pillars: P}
}

// ToFixed is JS Number.prototype.toFixed (exported for the analytics package).
func ToFixed(x float64, d int) string { return toFixed(x, d) }
