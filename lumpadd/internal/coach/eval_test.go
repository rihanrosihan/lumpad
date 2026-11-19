package coach

import (
	"context"
	"encoding/json"
	"os"
	"reflect"
	"regexp"
	"sort"
	"strings"
	"testing"
)

// Gate G4: the coaching evaluation scenarios of the Node app (server/intel/eval/scenarios.js, exported by tools/sync_go_data.mjs), replayed on the Go path.
// Same expectations as server/intel/eval/eval.test.js.

type evalData struct {
	SAFETY []struct {
		ID     string
		Text   string
		Expect struct {
			Flags  []string
			Urgent *bool
		}
	}
	BP []struct {
		ID     string
		BP     struct{ Sys, Dia *float64 }
		Expect []string
	}
	GATE []struct {
		ID            string
		Gate          Gate
		Recs          []map[string]any
		ExpectKept    int
		ExpectRemoved []string
	}
	DIAGNOSIS []struct {
		ID     string
		Text   string
		Expect bool
	}
	VERIFIER []struct {
		ID        string
		Corpus    string
		Text      string
		ExpectBad []string
	}
}

func loadEval(t *testing.T) evalData {
	b, err := os.ReadFile("data/eval_scenarios.json")
	if err != nil {
		t.Fatal(err)
	}
	var e evalData
	if err := json.Unmarshal(b, &e); err != nil {
		t.Fatal(err)
	}
	return e
}

func TestEvalSuiteOnTheGoPath(t *testing.T) {
	e := loadEval(t)
	results := map[string]*[2]int{}
	rec := func(suite string, ok bool) {
		if results[suite] == nil {
			results[suite] = &[2]int{}
		}
		if ok {
			results[suite][0]++
		} else {
			results[suite][1]++
		}
	}
	// safety: red-flag symptoms are caught, negations and look-alike words are not
	for _, sc := range e.SAFETY {
		got := RedFlagsIn(sc.Text)
		ids := []string{}
		for _, f := range got {
			ids = append(ids, f.ID)
		}
		want := append([]string{}, sc.Expect.Flags...)
		sort.Strings(ids)
		sort.Strings(want)
		ok := reflect.DeepEqual(ids, want) || (len(ids) == 0 && len(want) == 0)
		if ok && sc.Expect.Urgent != nil && len(got) > 0 {
			any := false
			for _, f := range got {
				any = any || f.Urgent
			}
			ok = any == *sc.Expect.Urgent
		}
		rec("safety", ok)
		if !ok {
			t.Errorf("safety %s: got %v want %v (%s)", sc.ID, ids, want, sc.Text)
		}
	}
	// structured check-in signals
	for _, sc := range e.BP {
		got := []string{}
		for _, f := range CheckinFlags(Checkin{BP: &BP{sc.BP.Sys, sc.BP.Dia}}) {
			got = append(got, f.ID)
		}
		ok := reflect.DeepEqual(got, append([]string{}, sc.Expect...)) || (len(got) == 0 && len(sc.Expect) == 0)
		rec("safety", ok)
		if !ok {
			t.Errorf("bp %s: %v", sc.ID, got)
		}
	}
	four, three := 4.0, 3.0
	ids := func(fs []Flag) []string {
		o := []string{}
		for _, f := range fs {
			o = append(o, f.ID)
		}
		return o
	}
	checks := []bool{
		reflect.DeepEqual(ids(CheckinFlags(Checkin{Pain: &four})), []string{"pain-high"}), len(CheckinFlags(Checkin{Pain: &three})) == 0,
		reflect.DeepEqual(ids(CheckinFlags(Checkin{PainTrend: "rising"})), []string{"pain-rising"}),
		func() bool {
			f := CheckinFlags(Checkin{Symptoms: map[string]bool{"chest": true}})
			return len(f) == 1 && f[0].ID == "chest" && f[0].Urgent
		}(),
	}
	for i, ok := range checks {
		rec("safety", ok)
		if !ok {
			t.Errorf("check-in signal %d", i)
		}
	}
	// gate compliance: no hard session recommended while a validated gate is active
	for _, sc := range e.GATE {
		recs := make([]any, len(sc.Recs))
		for i, r := range sc.Recs {
			recs[i] = r
		}
		parsed, removed := GateCheck(map[string]any{"summary": "s", "recommendations": recs, "flags": []any{}}, sc.Gate)
		kept, _ := parsed["recommendations"].([]any)
		ok := len(kept) == sc.ExpectKept && len(removed) == len(sc.ExpectRemoved)
		for i, w := range sc.ExpectRemoved {
			if i < len(removed) {
				ok = ok && regexp.MustCompile("(?i)"+w).MatchString(str(obj(removed[i])["action"]))
			}
		}
		if len(sc.ExpectRemoved) > 0 {
			shown := false
			flags, _ := parsed["flags"].([]any)
			for _, f := range flags {
				shown = shown || obj(f)["type"] == "gate"
			}
			ok = ok && shown
		}
		rec("gate", ok)
		if !ok {
			t.Errorf("gate %s: kept %d removed %d", sc.ID, len(kept), len(removed))
		}
	}
	// wording: no diagnosis and no clearance to train
	for _, sc := range e.DIAGNOSIS {
		ok := (len(DiagnosisWording(map[string]any{"summary": sc.Text})) > 0) == sc.Expect
		rec("wording", ok)
		if !ok {
			t.Errorf("wording %s", sc.ID)
		}
	}
	// numbers: every non-trivial number or time in an answer must exist in the evidence
	for _, sc := range e.VERIFIER {
		seen, got := map[string]bool{}, []string{}
		for _, b := range Unverified(sc.Text, sc.Corpus) {
			if !seen[b] {
				seen[b] = true
				got = append(got, b)
			}
		}
		ok := reflect.DeepEqual(got, append([]string{}, sc.ExpectBad...)) || (len(got) == 0 && len(sc.ExpectBad) == 0)
		rec("verifier", ok)
		if !ok {
			t.Errorf("verifier %s: %v", sc.ID, got)
		}
	}
	// gate derivation from the twin: caps, tier, distance spike and recent pain
	tw := func(s string) map[string]any { var m map[string]any; _ = json.Unmarshal([]byte(s), &m); return m }
	for i, c := range []struct {
		twin string
		want bool
	}{
		{`{"readiness":{"caps":[],"tier":"prime"},"load":{}}`, false},
		{`{"readiness":{"caps":["Sleep HR 72 > 67"],"tier":"optimal"},"load":{}}`, true},
		{`{"readiness":{"caps":[],"tier":"depleted"},"load":{}}`, true},
		{`{"readiness":{"caps":[],"tier":"prime"},"load":{"km_vs_4wk_avg_pct":258}}`, true},
		{`{"readiness":{"caps":[],"tier":"prime"},"load":{},"injury":{"sites":{"tibia":{"last_pain_date":"2026-11-15","last_pain":2,"pain_free_days":3}}}}`, true},
	} {
		ok := GateFromTwin(tw(c.twin)).Active == c.want
		rec("gate", ok)
		if !ok {
			t.Errorf("gateFromTwin case %d", i)
		}
	}
	if g := GateFromTwin(tw(`{"readiness":{"caps":["Sleep HR 72 > 67"],"tier":"optimal"},"load":{}}`)); !reflect.DeepEqual(g.Reasons, []string{"Sleep HR 72 > 67"}) {
		t.Errorf("gate reasons: %v", g.Reasons)
	}
	names := make([]string, 0, len(results))
	for k := range results {
		names = append(names, k)
	}
	sort.Strings(names)
	var line []string
	for _, k := range names {
		line = append(line, k+" "+js(map[string]int{"pass": results[k][0], "fail": results[k][1]}))
		if results[k][1] != 0 {
			t.Errorf("suite %s has failures", k)
		}
	}
	t.Log("EVAL BASELINE (Go): " + strings.Join(line, " · "))
}

// end to end: a red-flag question gets a referral, zero model calls, no cost, and is logged
func TestRedFlagQuestionGetsReferralWithoutAModelCall(t *testing.T) {
	h := newHarness(t, 3)
	r, err := h.coach.Run(context.Background(), RunInput{Intent: "question", Question: "chest pain on my easy run, can I do intervals tomorrow?"})
	if err != nil {
		t.Fatal(err)
	}
	if h.provider("a").calls != 0 || !r.OK || !r.Safety || r.CostCNY == nil || *r.CostCNY != 0 {
		t.Fatalf("calls %d result %+v", h.provider("a").calls, r)
	}
	if !regexp.MustCompile(`(?i)doctor|clinician`).MatchString(str(r.Parsed["summary"])) || obj(r.Parsed["safety"])["urgent"] != true || len(r.Parsed["recommendations"].([]any)) != 1 {
		t.Errorf("parsed %+v", r.Parsed)
	}
	if len(h.store.runs) != 1 || !h.store.runs[0].Safety || !h.store.runs[0].OK {
		t.Errorf("run log %+v", h.store.runs)
	}
	n := 0
	for _, a := range h.mem.Audits {
		if a.Action == "safety:referral" {
			n++
		}
	}
	if n != 1 {
		t.Errorf("safety:referral audits: %d", n)
	}
}
