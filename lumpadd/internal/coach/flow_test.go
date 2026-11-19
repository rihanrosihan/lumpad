package coach

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/rihanrosihan/lumpad/lumpadd/internal/llm"
)

// ---- test doubles
type runRec struct {
	Row      RunRow
	ID       int64
	OK       bool
	Err      string
	Parsed   map[string]any
	Cost     *float64
	Provider string
	Model    string
	Safety   bool
	Response string
}
type memStore struct {
	runs []runRec
	pain []float64
}

func (s *memStore) NewRun(_ context.Context, r RunRow) (int64, error) {
	s.runs = append(s.runs, runRec{Row: r, ID: int64(len(s.runs) + 1)})
	return int64(len(s.runs)), nil
}
func (s *memStore) SafetyRun(_ context.Context, intent, q string, parsed map[string]any) (int64, error) {
	s.runs = append(s.runs, runRec{Row: RunRow{Intent: intent, Question: q, Provider: "safety"}, ID: int64(len(s.runs) + 1), OK: true, Safety: true, Parsed: parsed})
	return int64(len(s.runs)), nil
}
func (s *memStore) FailRun(_ context.Context, id int64, e, resp string, _ json.RawMessage, c *float64, prov, model string) error {
	r := &s.runs[id-1]
	r.OK, r.Err, r.Response, r.Cost, r.Provider, r.Model = false, e, resp, c, prov, model
	return nil
}
func (s *memStore) FinishRun(_ context.Context, id int64, resp string, p map[string]any, _ json.RawMessage, c *float64, prov, model string) error {
	r := &s.runs[id-1]
	r.OK, r.Err, r.Response, r.Parsed, r.Cost, r.Provider, r.Model = true, "", resp, p, c, prov, model
	return nil
}
func (s *memStore) RecentPain(_ context.Context, n int) ([]float64, error) {
	return s.pain[:min(n, len(s.pain))], nil
}

type staticRetriever struct{ r Retrieved }

func (s staticRetriever) Retrieve(context.Context, RunInput) (Retrieved, error) { return s.r, nil }

type scripted struct {
	name  string
	out   []scriptOut
	calls int
	reqs  []llm.Request
}
type scriptOut struct {
	text string
	err  error
	cost float64
}

func (p *scripted) Name() string { return p.name }
func (p *scripted) Complete(_ context.Context, r llm.Request) (llm.Response, error) {
	p.reqs = append(p.reqs, r)
	o := p.out[min(p.calls, len(p.out)-1)]
	p.calls++
	if o.err != nil {
		return llm.Response{}, o.err
	}
	c := o.cost
	return llm.Response{Text: o.text, JSON: llm.ParseJSON(o.text), Usage: json.RawMessage(`{"prompt_tokens":10}`), Provider: p.name, Model: p.name + "-model", ModelName: p.name, CostCNY: &c, Effort: r.Effort}, nil
}

type harness struct {
	coach *Coach
	store *memStore
	mem   *MemMemory
	led   *llm.MemLedger
	provs map[string]*scripted
}

func (h *harness) provider(n string) *scripted { return h.provs[n] }

func good(over map[string]any) string {
	a := map[string]any{"summary": "Easy day.", "analysis_md": "## Twin snapshot\nEF 0.789.", "recommendations": []any{map[string]any{"action": "Easy 6 km at HR ≤ 148", "why": "gate", "priority": "now"}},
		"flags": []any{}, "memory_writes": []any{}, "cited_ids": []any{11}}
	for k, v := range over {
		a[k] = v
	}
	b, _ := json.Marshal(a)
	return string(b)
}

func newHarness(t *testing.T, _ int, outs ...[]scriptOut) *harness {
	t.Helper()
	h := &harness{store: &memStore{}, mem: &MemMemory{Items: []Memory{{ID: 11, Tier: "episodic", Kind: "session", Title: "Run 2026-11-14", Body: "EF 0.789 · 21.1 km · GCT 262 ms", Status: "active", Hash: "h11"}}}, led: &llm.MemLedger{}, provs: map[string]*scripted{}}
	names := []string{"a", "b"}
	r := &llm.Router{Providers: map[string]llm.Provider{}, Routes: map[string][]string{"default": names}, Ledger: h.led, CapCNY: 10, MaxCallsPerDay: map[string]int{},
		Guard: func(intent string, spend, cap, maxCall float64) (bool, string, string) {
			g := GuardDecision(intent, spend, cap, maxCall)
			return g.OK, g.Level, g.Reason
		}}
	for i, n := range names {
		o := []scriptOut{{text: good(nil), cost: 0.1}}
		if i < len(outs) {
			o = outs[i]
		}
		h.provs[n] = &scripted{name: n, out: o}
		r.Providers[n] = h.provs[n]
	}
	rules := []Rule{{ID: 1, Title: "Pain ≥ 2/10", Rule: "stop", Locked: true, Tag: "VALIDATED"}}
	h.coach = &Coach{Store: h.store, Memory: h.mem, Router: r, Lang: func() string { return "en" }, Retriever: staticRetriever{Retrieved{
		Ctx: Context{Rules: rules, Volatile: Volatile{Intent: "question", AsOf: "2026-11-19", Question: "q", Query: json.RawMessage(`{}`), Twin: json.RawMessage(`{"load":{"ctl":34.2}}`),
			CorrelationEdges: json.RawMessage(`[]`), Episodes: json.RawMessage(`[]`), Facts: json.RawMessage(`[]`), Telemetry: json.RawMessage(`[]`)}},
		ItemIDs: []int64{11}, Twin: map[string]any{"readiness": map[string]any{"caps": []any{}, "tier": "optimal"}, "load": map[string]any{}}, TokensEst: 1234}}}
	return h
}

func okRun(t *testing.T, h *harness, in RunInput) RunResult {
	t.Helper()
	r, err := h.coach.Run(context.Background(), in)
	if err != nil {
		t.Fatalf("run: %v", err)
	}
	return r
}

// ---- flow
func TestHappyPathStoresTheRunWithWritebackAndCost(t *testing.T) {
	h := newHarness(t, 0, []scriptOut{{text: good(map[string]any{"memory_writes": []any{map[string]any{"tier": "semantic", "title": "GCT up late", "body": "GCT 262 ms in 21.1 km", "cites": []any{11}}}}), cost: 0.25}})
	r := okRun(t, h, RunInput{Intent: "question", Question: "why?"})
	if !r.OK || r.Provider != "a" || r.CostCNY == nil || *r.CostCNY != 0.25 || len(r.Writeback.Stored) != 1 {
		t.Fatalf("%+v", r)
	}
	row := h.store.runs[0]
	if !row.OK || row.Row.Provider != "a" || row.Row.Effort != "high" || row.Row.ContextTokens != 1234 || row.Parsed["_writeback"] == nil || row.Model != "a-model" {
		t.Errorf("run row %+v", row)
	}
	if !strings.Contains(row.Row.Request.System, "LOCKED RULES") || !strings.Contains(row.Row.Request.User, "TASK (question") {
		t.Error("the prompt sent is stored with the run")
	}
	if len(h.mem.Items) != 2 || h.mem.Items[1].CreatedBy != "llm" || !strings.Contains(h.mem.Items[1].Payload, `"provider":"a"`) {
		t.Errorf("memory %+v", h.mem.Items)
	}
	if len(h.led.Calls) != 1 || h.led.Calls[0].RunID != 1 || h.led.Calls[0].Intent != "question" {
		t.Errorf("ledger %+v", h.led.Calls)
	}
	if h.provs["a"].reqs[0].Effort != "high" || h.provs["a"].reqs[0].System == "" {
		t.Errorf("request %+v", h.provs["a"].reqs[0])
	}
}

func TestDailyBriefUsesLowEffortAndUnknownIntentUsesTheQuestionTask(t *testing.T) {
	h := newHarness(t, 0)
	okRun(t, h, RunInput{Intent: "daily_brief"})
	if h.provs["a"].reqs[0].Effort != "low" {
		t.Error("daily brief runs at low effort")
	}
	okRun(t, h, RunInput{Intent: "something_new"})
	if !strings.Contains(h.provs["a"].reqs[1].User, StableData.Tasks["question"]) || h.provs["a"].reqs[1].Effort != "" {
		t.Errorf("unknown intent: %q effort %q", h.provs["a"].reqs[1].User[:80], h.provs["a"].reqs[1].Effort)
	}
}

func TestInvalidAnswerGetsOneRepairWithTheValidatorsMessage(t *testing.T) {
	h := newHarness(t, 0, []scriptOut{{text: `{"summary":5}`, cost: 0.2}, {text: good(nil), cost: 0.05}})
	r := okRun(t, h, RunInput{Intent: "question", Question: "q"})
	if !r.OK || h.provs["a"].calls != 2 || h.provs["b"].calls != 0 {
		t.Fatalf("calls a=%d b=%d %+v", h.provs["a"].calls, h.provs["b"].calls, r)
	}
	rep := h.provs["a"].reqs[1]
	if rep.Effort != "low" || len(rep.Messages) != 4 || rep.Messages[2].Role != "assistant" || rep.Messages[2].Content != `{"summary":5}` ||
		!strings.HasPrefix(rep.Messages[3].Content, "Your reply did not match the required JSON shape: $: missing analysis_md") || !strings.Contains(rep.Messages[3].Content, "$.summary: expected string, got number") ||
		!strings.HasSuffix(rep.Messages[3].Content, ". Reply again with ONE corrected JSON object only.") {
		t.Errorf("repair request %+v", rep)
	}
	if *r.CostCNY != 0.25 {
		t.Errorf("cost of both calls: %v", *r.CostCNY)
	}
	if rep.Messages[0].Content != h.provs["a"].reqs[0].System || rep.Messages[1].Content != h.provs["a"].reqs[0].User {
		t.Error("the repair prompt repeats the original system and user text")
	}
}

func TestNotJSONThenStillInvalidFallsBackToTheNextProvider(t *testing.T) {
	h := newHarness(t, 0, []scriptOut{{text: "Sorry, prose only", cost: 0.1}, {text: `{"summary":"x"}`, cost: 0.1}}, []scriptOut{{text: good(nil), cost: 0.4}})
	r := okRun(t, h, RunInput{Intent: "question", Question: "q"})
	if !r.OK || r.Provider != "b" || h.provs["a"].calls != 2 || h.provs["b"].calls != 1 {
		t.Fatalf("%+v a=%d b=%d", r, h.provs["a"].calls, h.provs["b"].calls)
	}
	if *r.CostCNY < 0.599 || *r.CostCNY > 0.601 {
		t.Errorf("the wasted calls are paid for too: %v", *r.CostCNY)
	}
	if h.store.runs[0].Row.Provider != "a" || h.store.runs[0].Provider != "b" {
		t.Errorf("run row keeps the first provider planned and records the one that answered: %+v", h.store.runs[0])
	}
}

func TestStillInvalidOnEveryProviderFailsTheRunAndDropsMemoryWrites(t *testing.T) {
	bad := []scriptOut{{text: `{"summary":"x"}`, cost: 0.1}}
	h := newHarness(t, 0, bad, bad)
	r, err := h.coach.Run(context.Background(), RunInput{Intent: "question", Question: "q"})
	if err != nil || r.OK || len(r.Errors) == 0 || len(h.mem.Items) != 1 {
		t.Fatalf("%+v %v", r, err)
	}
	row := h.store.runs[0]
	if row.OK || !strings.HasPrefix(row.Err, "schema after repair: ") || !strings.HasSuffix(row.Err, " — memory writes dropped") {
		t.Errorf("row %+v", row)
	}
}

func TestProviderErrorFallsBack(t *testing.T) {
	h := newHarness(t, 0, []scriptOut{{err: &llm.APIError{Status: 503, Msg: "a 503: down"}}}, []scriptOut{{text: good(nil), cost: 0.1}})
	r := okRun(t, h, RunInput{Intent: "question", Question: "q"})
	if !r.OK || r.Provider != "b" || len(r.Attempts) != 2 || r.Attempts[0].Status != 503 {
		t.Fatalf("%+v", r)
	}
	if len(h.led.Calls) != 2 || h.led.Calls[0].OK || !h.led.Calls[1].OK {
		t.Errorf("ledger %+v", h.led.Calls)
	}
}

func TestAllProvidersDownFailsTheRunWithBothMessages(t *testing.T) {
	h := newHarness(t, 0, []scriptOut{{err: &llm.APIError{Status: 503, Msg: "a 503: down"}}}, []scriptOut{{err: &llm.APIError{Status: 401, Msg: "b 401: bad key"}}})
	_, err := h.coach.Run(context.Background(), RunInput{Intent: "question", Question: "q"})
	if err == nil || !strings.Contains(err.Error(), "a 503: down") || !strings.Contains(err.Error(), "b 401: bad key") {
		t.Fatalf("%v", err)
	}
	if h.store.runs[0].OK || !strings.HasPrefix(h.store.runs[0].Err, "all providers failed") {
		t.Errorf("row %+v", h.store.runs[0])
	}
}

func TestBudgetStopFailsTheRunWithoutAnyProviderCall(t *testing.T) {
	h := newHarness(t, 0)
	nine := 9.5
	h.led.Calls = append(h.led.Calls, llm.Call{At: h.coachNow(), Provider: "a", CostCNY: &nine, OK: true})
	_, err := h.coach.Run(context.Background(), RunInput{Intent: "question", Question: "q"})
	var eb *llm.ErrBudget
	if !errors.As(err, &eb) || h.provs["a"].calls != 0 || h.provs["b"].calls != 0 {
		t.Fatalf("%v calls %d %d", err, h.provs["a"].calls, h.provs["b"].calls)
	}
	if h.store.runs[0].OK || !strings.Contains(h.store.runs[0].Err, "below the largest call") {
		t.Errorf("row %+v", h.store.runs[0])
	}
}

func TestGateRemovesHardSessionsAndSaysWhy(t *testing.T) {
	ans := good(map[string]any{"recommendations": []any{map[string]any{"action": "Run the Thursday tempo as planned", "why": "fitness", "priority": "this_week"}, map[string]any{"action": "Easy 6 km", "why": "recover", "priority": "now"}}})
	h := newHarness(t, 0, []scriptOut{{text: ans, cost: 0.1}})
	rd := h.coach.Retriever.(staticRetriever)
	rd.r.Twin = map[string]any{"readiness": map[string]any{"caps": []any{"Sleep HR 72 > 67 before a hard session [VALIDATED]"}, "tier": "optimal"}, "load": map[string]any{}}
	h.coach.Retriever = rd
	r := okRun(t, h, RunInput{Intent: "question", Question: "q"})
	recs := r.Parsed["recommendations"].([]any)
	if len(recs) != 1 || obj(recs[0])["action"] != "Easy 6 km" {
		t.Fatalf("recs %v", recs)
	}
	flags := r.Parsed["flags"].([]any)
	if len(flags) != 1 || obj(flags[0])["type"] != "gate" || !strings.Contains(str(obj(flags[0])["text"]), "Safety gate active (Sleep HR 72 > 67") {
		t.Errorf("flags %v", flags)
	}
	found := false
	for _, a := range h.mem.Audits {
		found = found || (a.Action == "safety:answer-adjusted" && a.RunID == 1)
	}
	if !found {
		t.Error("the adjustment is audited")
	}
	if h.store.runs[0].Parsed["safety"] == nil {
		t.Error("the stored answer carries the gate details")
	}
}

func TestDiagnosisWordingIsFlaggedNotBlocked(t *testing.T) {
	h := newHarness(t, 0, []scriptOut{{text: good(map[string]any{"summary": "You have a stress fracture in the tibia."}), cost: 0.1}})
	r := okRun(t, h, RunInput{Intent: "question", Question: "q"})
	flags := r.Parsed["flags"].([]any)
	if !r.OK || len(flags) != 1 || obj(flags[0])["type"] != "rule" || !strings.Contains(str(obj(flags[0])["text"]), `treat "You have a stress fracture" as a question for a clinician`) {
		t.Errorf("%+v", r)
	}
}

func TestMemoryWriteWithAnInventedNumberIsRejectedButTheAnswerStands(t *testing.T) {
	h := newHarness(t, 0, []scriptOut{{text: good(map[string]any{"memory_writes": []any{map[string]any{"tier": "semantic", "title": "t", "body": "EF fell to 4321.5", "cites": []any{11}}}}), cost: 0.1}})
	r := okRun(t, h, RunInput{Intent: "question", Question: "q"})
	if !r.OK || len(r.Writeback.Rejected) != 1 || !strings.Contains(strings.Join(r.Writeback.Rejected[0].Why, ","), "unverified numbers: 4321.5") || len(h.mem.Items) != 1 {
		t.Errorf("%+v", r.Writeback)
	}
}

// With the prompt's ~1,000 numbers as evidence the Node-compatible check lets 0.612 through (it is within 0.051 of 0.59 or 0.6 somewhere in the prompt);
// the strict check compares with the cited item only.
func TestStrictNumbersRejectWhatTheLooseCheckLetsThrough(t *testing.T) {
	write := map[string]any{"memory_writes": []any{map[string]any{"tier": "semantic", "title": "t", "body": "EF fell to 0.612", "cites": []any{11}}}}
	loose := newHarness(t, 0, []scriptOut{{text: good(write), cost: 0.1}})
	loose.coach.Retriever = withCorpusNumbers(loose.coach.Retriever)
	if r := okRun(t, loose, RunInput{Intent: "question", Question: "q"}); len(r.Writeback.Stored) != 1 {
		t.Errorf("the loose check accepts 0.612 because the prompt contains 0.6: %+v", r.Writeback)
	}
	strict := newHarness(t, 0, []scriptOut{{text: good(write), cost: 0.1}})
	strict.coach.Retriever = withCorpusNumbers(strict.coach.Retriever)
	strict.coach.StrictNumbers = true
	if r := okRun(t, strict, RunInput{Intent: "question", Question: "q"}); len(r.Writeback.Rejected) != 1 || len(strict.mem.Items) != 1 {
		t.Errorf("the strict check must reject 0.612 (the cited item says 0.789): %+v", r.Writeback)
	}
}

func withCorpusNumbers(r Retriever) Retriever {
	sr := r.(staticRetriever)
	sr.r.Ctx.Volatile.Twin = json.RawMessage(`{"a":0.6,"b":0.59,"c":0.95}`)
	return sr
}

func TestUnverifiedStrict(t *testing.T) {
	ev := "EF 0.789 · 36.92 km in 5:30:52 · GCT 262 ms · pace 5:41"
	for _, c := range []struct {
		text string
		bad  []string
	}{
		{"EF 0.789 and 36.92 km", nil}, {"EF 0.79", nil}, {"36.9 km", nil}, {"37 km", nil}, {"GCT 262 ms", nil}, {"GCT 263 ms", []string{"263"}}, {"EF 0.612", []string{"0.612"}}, {"EF 0.80", []string{"0.8"}},
		{"in 5:30:52", nil}, {"in 5:12:00", []string{"5:12:00"}}, {"year 2027 and 3 sessions", nil}, {"36.95 km", []string{"36.95"}}, {"36,92 km", nil}, {"about 45 km", []string{"45"}},
	} {
		got := UnverifiedStrict(c.text, ev)
		if strings.Join(got, ",") != strings.Join(c.bad, ",") {
			t.Errorf("%q → %v want %v", c.text, got, c.bad)
		}
	}
}

func TestRecentSeverePainGivesAReferralEvenForAnInnocentQuestion(t *testing.T) {
	h := newHarness(t, 0)
	h.store.pain = []float64{5, 0}
	r := okRun(t, h, RunInput{Intent: "daily_brief"})
	if !r.Safety || h.provs["a"].calls != 0 || !strings.Contains(str(r.Parsed["summary"]), "pain 5/10") {
		t.Errorf("%+v", r)
	}
	h2 := newHarness(t, 0)
	h2.store.pain = []float64{3, 2}
	if r := okRun(t, h2, RunInput{Intent: "daily_brief"}); r.Safety || h2.provs["a"].calls != 1 {
		t.Error("pain 3/10 is not a referral")
	}
}

func TestRedFlagFromQuestionAndCheckinDeduplicatesByID(t *testing.T) {
	h := newHarness(t, 0)
	h.store.pain = []float64{6, 4.5}
	f, err := h.coach.safetyPre(context.Background(), "my pain is getting worse and I have chest pain")
	if err != nil {
		t.Fatal(err)
	}
	ids := []string{}
	for _, x := range f {
		ids = append(ids, x.ID)
	}
	if strings.Join(ids, ",") != "chest,pain-worse,pain-high" || f[2].Label != "pain 4.5/10" {
		t.Errorf("ids %v last %+v (first position kept, last value wins)", ids, f[len(f)-1])
	}
}

func (h *harness) coachNow() time.Time { return time.Now() }
