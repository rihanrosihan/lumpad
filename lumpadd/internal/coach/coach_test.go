package coach

import (
	"encoding/json"
	"fmt"
	"os"
	"reflect"
	"sort"
	"testing"
)

// JSON-shaped comparison with the Node outputs (vectors from tools/gen_coach_vectors.mjs)
func rt(v any) any {
	b, err := json.Marshal(v)
	if err != nil {
		return fmt.Sprintf("marshal error: %v", err)
	}
	var o any
	_ = json.Unmarshal(b, &o)
	return o
}
func js(v any) string { b, _ := json.Marshal(v); return string(b) }

type vectors struct {
	Flags []struct {
		Text string
		Out  []map[string]any
	}
	Checkin []struct {
		In struct {
			Pain      *float64
			PainTrend string
			Symptoms  map[string]bool
			BP        *struct{ Sys, Dia *float64 }
		}
		Out []map[string]any
	}
	Referral []struct {
		In  []Flag
		Out map[string]any
	}
	GateTwin []struct {
		Twin map[string]any
		Out  Gate
	}
	GateCheck []struct {
		Parsed map[string]any
		Gate   Gate
		Out    struct {
			Parsed  map[string]any `json:"parsed"`
			Removed []any          `json:"removed"`
		}
	}
	Wording []struct {
		Parsed map[string]any
		Out    []string
	}
	Nums []struct {
		Text    string
		Numbers []float64
		Times   []string
	}
	Ver []struct {
		Text, Corpus string
		Out          []string
	}
	Dedupe []struct {
		A, B   string
		Ta, Tb []string
		J      float64
	}
	Validation []struct {
		Answer any
		Errors []string
	}
	Norm []struct {
		In  any
		Out any
	}
	Guard []struct {
		In struct {
			Intent              string
			Spend, Cap, MaxCall float64
		}
		Out Guard
	}
}

func load(t *testing.T) vectors {
	b, err := os.ReadFile("testdata/vectors.json")
	if err != nil {
		t.Fatal(err)
	}
	var v vectors
	if err := json.Unmarshal(b, &v); err != nil {
		t.Fatal(err)
	}
	return v
}

func TestRedFlagsMatchJS(t *testing.T) {
	v := load(t)
	hits := 0
	for _, c := range v.Flags {
		got := rt(RedFlagsIn(c.Text))
		want := rt(c.Out)
		if want == nil {
			want = []any{}
		}
		if !reflect.DeepEqual(got, want) {
			t.Errorf("%q:\n  go %s\n  js %s", c.Text, js(got), js(want))
		}
		if len(c.Out) > 0 {
			hits++
		}
	}
	if hits < 100 {
		t.Fatalf("vectors too weak: only %d texts with hits", hits)
	}
}

func TestCheckinAndReferralMatchJS(t *testing.T) {
	v := load(t)
	for i, c := range v.Checkin {
		in := Checkin{Pain: c.In.Pain, PainTrend: c.In.PainTrend, Symptoms: c.In.Symptoms}
		if c.In.BP != nil {
			in.BP = &BP{c.In.BP.Sys, c.In.BP.Dia}
		}
		got, want := rt(CheckinFlags(in)), rt(c.Out)
		if !reflect.DeepEqual(got, want) {
			t.Errorf("checkin %d %s:\n  go %s\n  js %s", i, js(c.In), js(got), js(want))
		}
	}
	for i, c := range v.Referral {
		if got, want := rt(ReferralFor(c.In)), rt(c.Out); !reflect.DeepEqual(got, want) {
			t.Errorf("referral %d:\n  go %.300s\n  js %.300s", i, js(got), js(want))
		}
	}
}

func TestGateMatchesJS(t *testing.T) {
	v := load(t)
	active := 0
	for i, c := range v.GateTwin {
		got := GateFromTwin(c.Twin)
		if !reflect.DeepEqual(rt(got), rt(c.Out)) {
			t.Errorf("gateFromTwin %d %s:\n  go %s\n  js %s", i, js(c.Twin), js(got), js(c.Out))
		}
		if c.Out.Active {
			active++
		}
	}
	if active < 40 {
		t.Fatalf("gate vectors too weak: %d active", active)
	}
	removed := 0
	for i, c := range v.GateCheck {
		parsed, rem := GateCheck(c.Parsed, c.Gate)
		got := rt(map[string]any{"parsed": parsed, "removed": rem})
		want := rt(map[string]any{"parsed": c.Out.Parsed, "removed": c.Out.Removed})
		if !reflect.DeepEqual(got, want) {
			t.Errorf("gateCheck %d:\n  go %.500s\n  js %.500s", i, js(got), js(want))
		}
		removed += len(c.Out.Removed)
	}
	if removed < 40 {
		t.Fatalf("gateCheck vectors too weak: %d removed", removed)
	}
}

func TestDiagnosisWordingMatchesJS(t *testing.T) {
	v := load(t)
	hit := 0
	for i, c := range v.Wording {
		got := DiagnosisWording(c.Parsed)
		if !reflect.DeepEqual(rt(got), rt(c.Out)) {
			t.Errorf("wording %d %s:\n  go %v\n  js %v", i, js(c.Parsed), got, c.Out)
		}
		if len(c.Out) > 0 {
			hit++
		}
	}
	if hit < 20 {
		t.Fatalf("wording vectors too weak: %d hits", hit)
	}
}

func TestNumberVerificationMatchesJS(t *testing.T) {
	v := load(t)
	for _, c := range v.Nums {
		if got := NumbersOf(c.Text); !reflect.DeepEqual(rt(got), rt(c.Numbers)) {
			t.Errorf("numbersOf %q: go %v js %v", c.Text, got, c.Numbers)
		}
		if got := TimesOf(c.Text); !reflect.DeepEqual(rt(got), rt(c.Times)) {
			t.Errorf("timesOf %q: go %v js %v", c.Text, got, c.Times)
		}
	}
	bad := 0
	for i, c := range v.Ver {
		got := Unverified(c.Text, c.Corpus)
		want := c.Out
		if want == nil {
			want = []string{}
		}
		if !reflect.DeepEqual(got, want) {
			t.Errorf("unverified %d:\n  text %q\n  corpus %q\n  go %v\n  js %v", i, c.Text, c.Corpus, got, want)
		}
		bad += len(want)
	}
	if bad < 30 {
		t.Fatalf("verifier vectors too weak: %d unverified items", bad)
	}
	for _, c := range v.Dedupe {
		ta, tb := Tokens(c.A), Tokens(c.B)
		keys := func(m map[string]bool) []string {
			o := []string{}
			for k := range m {
				o = append(o, k)
			}
			sort.Strings(o)
			return o
		}
		if !reflect.DeepEqual(keys(ta), nonNil(c.Ta)) || !reflect.DeepEqual(keys(tb), nonNil(c.Tb)) {
			t.Errorf("tokens %q / %q: go %v %v js %v %v", c.A, c.B, keys(ta), keys(tb), c.Ta, c.Tb)
		}
		if j := Jaccard(ta, tb); j != c.J {
			t.Errorf("jaccard %q / %q: go %v js %v", c.A, c.B, j, c.J)
		}
	}
}
func nonNil(s []string) []string {
	if s == nil {
		return []string{}
	}
	sort.Strings(s)
	return s
}

func TestValidationMatchesJS(t *testing.T) {
	v := load(t)
	invalid := 0
	for i, c := range v.Validation {
		got, want := Validate(c.Answer, OutputSchema, "$"), c.Errors
		if want == nil {
			want = []string{}
		}
		if !reflect.DeepEqual(got, want) {
			t.Errorf("validate %d %.200s:\n  go %v\n  js %v", i, js(c.Answer), got, want)
		}
		if len(want) > 0 {
			invalid++
		}
	}
	if invalid < 100 {
		t.Fatalf("validation vectors too weak: %d invalid", invalid)
	}
	for i, c := range v.Norm {
		if got := rt(Normalize(c.In)); !reflect.DeepEqual(got, rt(c.Out)) {
			t.Errorf("normalize %d:\n  go %s\n  js %s", i, js(got), js(c.Out))
		}
	}
}

func TestGuardMatchesJS(t *testing.T) {
	v := load(t)
	for _, c := range v.Guard {
		if got := GuardDecision(c.In.Intent, c.In.Spend, c.In.Cap, c.In.MaxCall); !reflect.DeepEqual(rt(got), rt(c.Out)) {
			t.Errorf("guard %+v:\n  go %s\n  js %s", c.In, js(got), js(c.Out))
		}
	}
}
