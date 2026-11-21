package main

import "testing"

func TestSub4FromTwinUsesDataWhenThereIsEnough(t *testing.T) {
	st := `{"races":{"baseline_vdot":33.4},"durability":{"run_share_by_km":[
		{"km":19,"run_share":0.9,"n":5},{"km":21,"run_share":0.5,"n":4},{"km":25,"run_share":0.3,"n":4},{"km":30,"run_share":0.2,"n":2}]}}`
	in := sub4FromTwin(st)
	if in.VDOT.Value != 33.4 || in.VDOT.Basis != "data" {
		t.Fatalf("vdot %+v", in.VDOT)
	}
	want := (0.5*4 + 0.3*4 + 0.2*2) / 10 // km 19 is not beyond km 20
	if d := in.RunShareAfter20K.Value - want; d > 1e-9 || d < -1e-9 || in.RunShareAfter20K.Basis != "data" {
		t.Fatalf("run share %+v want %v", in.RunShareAfter20K, want)
	}
}

func TestSub4FromTwinFallsBackAndSaysSo(t *testing.T) {
	for _, st := range []string{"", "not json", `{"races":{"baseline_vdot":5},"durability":{"run_share_by_km":[{"km":25,"run_share":0.9,"n":2}]}}`} {
		in := sub4FromTwin(st)
		if in.VDOT.Value != fallbackVDOT || in.VDOT.Basis == "data" || in.RunShareAfter20K.Value != fallbackRunShare || in.RunShareAfter20K.Basis == "data" {
			t.Fatalf("%q -> %+v", st, in)
		}
	}
}

func TestSub4VDOTFallsBackToProjection(t *testing.T) {
	in := sub4FromTwin(`{"projection":{"vdot0":34.2}}`)
	if in.VDOT.Value != 34.2 || in.VDOT.Basis != "data" {
		t.Fatalf("%+v", in.VDOT)
	}
}
