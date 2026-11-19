package engine

import (
	"encoding/json"
	"os"
	"testing"
)

func TestPacingAndZonesMatchJS(t *testing.T) {
	b, err := os.ReadFile("testdata/vectors.json")
	if err != nil {
		t.Fatal(err)
	}
	var v struct {
		Pacing struct {
			Heat []struct {
				W any
				P float64
			}
			Sims []struct {
				Inp struct {
					RunPace, WalkPace, RunS, WalkS, Wbgt, GunMin, GoalS float64
					Cops                                                [][]any
				}
				Out any
			}
			Hms []struct {
				S float64
				F string
			}
		}
		Zones []struct {
			Cfg    struct{ Lthr, Tpace float64 }
			Ranges []struct {
				Z        int
				HR, Pace any
			}
			Laps  []map[string]any
			Zs    struct{ HR, Pace []float64 }
			Steps []struct {
				S   []Step
				Est struct{ Sec, Tl float64 }
				Km  float64
			}
		}
	}
	if err := json.Unmarshal(b, &v); err != nil {
		t.Fatal(err)
	}
	if len(v.Pacing.Sims) == 0 || len(v.Zones) == 0 {
		t.Fatal("no pacing/zone vectors; run node tools/gen_engine_vectors.mjs")
	}
	for _, h := range v.Pacing.Heat {
		if got := HeatPenalty(jnum(h.W)); !eq(got, h.P) {
			t.Errorf("heat %v: go %v js %v", h.W, got, h.P)
		}
	}
	for i, c := range v.Pacing.Sims {
		in := SimInput{RunPace: c.Inp.RunPace, WalkPace: c.Inp.WalkPace, RunS: c.Inp.RunS, WalkS: c.Inp.WalkS, WBGT: c.Inp.Wbgt, GunMin: c.Inp.GunMin, GoalS: c.Inp.GoalS}
		for _, p := range c.Inp.Cops {
			in.COPs = append(in.COPs, COP{p[0].(string), p[1].(float64), p[2].(string)})
		}
		var got any = Simulate(in)
		if r, _ := got.(*SimResult); r == nil {
			got = nil
		}
		if err := same(got, c.Out); err != nil {
			t.Errorf("sim %d: %v", i, err)
		}
	}
	for _, h := range v.Pacing.Hms {
		if got := FmtHMS(h.S); got != h.F {
			t.Errorf("fmtHMS %v: go %s js %s", h.S, got, h.F)
		}
	}
	for i, z := range v.Zones {
		cfg := ZoneCfg{z.Cfg.Lthr, z.Cfg.Tpace}
		for _, r := range z.Ranges {
			var gh, gp any
			if h, ok := HRRange(r.Z, cfg); ok {
				p, _ := PaceRange(r.Z, cfg)
				gh, gp = h[:], p[:]
			}
			if same(gh, r.HR) != nil || same(gp, r.Pace) != nil {
				t.Errorf("cfg %d zone %d: go %v %v js %v %v", i, r.Z, gh, gp, r.HR, r.Pace)
			}
		}
		laps := make([]Lap, len(z.Laps))
		for j, l := range z.Laps {
			laps[j] = Lap{jnum(l["duration_s"]), jnum(l["avg_hr"]), jnum(l["avg_pace_s_km"])}
		}
		hr, pace := ZoneSeconds(laps, cfg)
		if same(hr[:], z.Zs.HR) != nil || same(pace[:], z.Zs.Pace) != nil {
			t.Errorf("cfg %d zoneSeconds: go %v %v js %v %v", i, hr, pace, z.Zs.HR, z.Zs.Pace)
		}
		for j, s := range z.Steps {
			sec, tl := Estimate(s.S, cfg)
			if sec != s.Est.Sec || tl != s.Est.Tl || StepKm(s.S) != s.Km {
				t.Errorf("cfg %d steps %d: go %v s %v tl %v km, js %v s %v tl %v km", i, j, sec, tl, StepKm(s.S), s.Est.Sec, s.Est.Tl, s.Km)
			}
		}
	}
}
