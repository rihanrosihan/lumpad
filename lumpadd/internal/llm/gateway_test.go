package llm

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"math"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

type fake struct {
	mu   sync.Mutex
	hits []fakeHit
	resp []fakeResp // consumed in order; the last one repeats
}
type fakeHit struct {
	Path    string
	Headers http.Header
	Body    map[string]any
}
type fakeResp struct {
	Status int
	Body   string
}

func (f *fake) server() *httptest.Server {
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		raw, _ := io.ReadAll(r.Body)
		var b map[string]any
		_ = json.Unmarshal(raw, &b)
		f.hits = append(f.hits, fakeHit{r.URL.Path, r.Header.Clone(), b})
		i := len(f.hits) - 1
		if i >= len(f.resp) {
			i = len(f.resp) - 1
		}
		w.WriteHeader(f.resp[i].Status)
		_, _ = w.Write([]byte(f.resp[i].Body))
	}))
}

func anthropicOK(text string, usage string) fakeResp {
	return fakeResp{200, `{"id":"msg_1","type":"message","role":"assistant","content":[{"type":"thinking","thinking":"hmm"},{"type":"text","text":` + jsonStr(text) + `}],"stop_reason":"end_turn","usage":` + usage + `}`}
}
func jsonStr(s string) string { b, _ := json.Marshal(s); return string(b) }

var noSleep = func(time.Duration) {}
var okKey = func() (string, error) { return "k-test", nil }

func newClaude(url string) (*Anthropic, *[]time.Duration) {
	var slept []time.Duration
	return &Anthropic{ProviderName: "claude", Base: url, Key: okKey, Model: "claude-sonnet-5-5", Thinking: map[string]int{"high": 6000},
		Prices: &Prices{InputPerM: 3, OutputPerM: 15, CacheReadPerM: 0.3, CacheWritePerM: 3.75, FXToCNY: 7}, Sleep: func(d time.Duration) { slept = append(slept, d) }}, &slept
}

func TestAnthropicRequestAndResponse(t *testing.T) {
	f := &fake{resp: []fakeResp{anthropicOK("```json\n{\"summary\":\"ok\"}\n```", `{"input_tokens":200,"output_tokens":50,"cache_read_input_tokens":1000,"cache_creation_input_tokens":0}`)}}
	srv := f.server()
	defer srv.Close()
	p, _ := newClaude(srv.URL)
	resp, err := p.Complete(context.Background(), Request{System: "STABLE", User: "TASK", Effort: "high"})
	if err != nil {
		t.Fatal(err)
	}
	h := f.hits[0]
	if h.Path != "/v1/messages" || h.Headers.Get("x-api-key") != "k-test" || h.Headers.Get("anthropic-version") != "2023-06-01" {
		t.Errorf("request line/headers: %s %v", h.Path, h.Headers)
	}
	sys := h.Body["system"].([]any)[0].(map[string]any)
	if sys["text"] != "STABLE" || sys["cache_control"].(map[string]any)["type"] != "ephemeral" {
		t.Errorf("the stable prompt must be a cached system block: %v", h.Body["system"])
	}
	if h.Body["model"] != "claude-sonnet-5-5" || h.Body["max_tokens"] != float64(24000) {
		t.Errorf("model/max_tokens: %v %v", h.Body["model"], h.Body["max_tokens"])
	}
	if th, _ := h.Body["thinking"].(map[string]any); th["type"] != "enabled" || th["budget_tokens"] != float64(6000) {
		t.Errorf("thinking for high effort: %v", h.Body["thinking"])
	}
	msgs := h.Body["messages"].([]any)
	if len(msgs) != 1 || msgs[0].(map[string]any)["content"] != "TASK" || msgs[0].(map[string]any)["role"] != "user" {
		t.Errorf("messages: %v", msgs)
	}
	if resp.Text != "```json\n{\"summary\":\"ok\"}\n```" {
		t.Errorf("text blocks must be joined and thinking blocks dropped: %q", resp.Text)
	}
	if m, _ := resp.JSON.(map[string]any); m["summary"] != "ok" {
		t.Errorf("json: %v", resp.JSON)
	}
	// Prompt = 200 plain + 1000 cache read; Completion 50; cost = (200·3 + 1000·0.3 + 50·15)/1e6 · 7
	want := (200*3 + 1000*0.3 + 50*15) / 1e6 * 7
	if resp.Tokens.Prompt != 1200 || resp.Tokens.CachedPrompt != 1000 || resp.Tokens.Completion != 50 || resp.CostCNY == nil || math.Abs(*resp.CostCNY-math.Round(want*1e4)/1e4) > 1e-9 {
		t.Errorf("tokens/cost: %+v cost %v want %v", resp.Tokens, resp.CostCNY, want)
	}
	if resp.Provider != "claude" || resp.Effort != "high" {
		t.Errorf("meta: %+v", resp)
	}
}

func TestAnthropicRepairMessagesAndNoThinkingAtLowEffort(t *testing.T) {
	f := &fake{resp: []fakeResp{anthropicOK(`{"a":1}`, `{"input_tokens":10,"output_tokens":5}`)}}
	srv := f.server()
	defer srv.Close()
	p, _ := newClaude(srv.URL)
	_, err := p.Complete(context.Background(), Request{Effort: "low", MaxTokens: 777, Messages: []Message{{"system", "S"}, {"user", "U"}, {"assistant", "bad"}, {"user", "fix it"}}})
	if err != nil {
		t.Fatal(err)
	}
	b := f.hits[0].Body
	if _, has := b["thinking"]; has {
		t.Error("low effort must not enable extended thinking")
	}
	if b["max_tokens"] != float64(777) {
		t.Errorf("max_tokens %v", b["max_tokens"])
	}
	m := b["messages"].([]any)
	if len(m) != 3 || m[1].(map[string]any)["role"] != "assistant" || m[2].(map[string]any)["content"] != "fix it" {
		t.Errorf("turns: %v", m)
	}
	if b["system"].([]any)[0].(map[string]any)["text"] != "S" {
		t.Errorf("system from messages: %v", b["system"])
	}
}

func TestAnthropicRetriesAndErrors(t *testing.T) {
	f := &fake{resp: []fakeResp{{529, `{"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}`}, {429, `{"error":{"message":"slow"}}`}, anthropicOK(`{"a":1}`, `{"input_tokens":1,"output_tokens":1}`)}}
	srv := f.server()
	defer srv.Close()
	p, slept := newClaude(srv.URL)
	if _, err := p.Complete(context.Background(), Request{System: "S", User: "U", Effort: "low"}); err != nil {
		t.Fatal(err)
	}
	if len(f.hits) != 3 || len(*slept) != 2 || (*slept)[0] != 1500*time.Millisecond || (*slept)[1] != 3000*time.Millisecond {
		t.Errorf("529 and 429 are retried with 1.5 s steps: hits %d sleeps %v", len(f.hits), *slept)
	}
	// 401 is not retried and carries the provider's message
	f2 := &fake{resp: []fakeResp{{401, `{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}`}}}
	srv2 := f2.server()
	defer srv2.Close()
	p2, _ := newClaude(srv2.URL)
	_, err := p2.Complete(context.Background(), Request{System: "S", User: "U"})
	var ae *APIError
	if !errors.As(err, &ae) || ae.Status != 401 || ae.Msg != "claude 401: invalid x-api-key" || len(f2.hits) != 1 {
		t.Errorf("401: %v hits %d", err, len(f2.hits))
	}
	// missing key: 503 without any request
	p3 := &Anthropic{ProviderName: "claude", Base: srv2.URL, Key: func() (string, error) { return "", errors.New("ANTHROPIC_API_KEY not set") }, Model: "m", Sleep: noSleep}
	before := len(f2.hits)
	if _, err := p3.Complete(context.Background(), Request{System: "S", User: "U", Effort: "low"}); err == nil || len(f2.hits) != before {
		t.Errorf("a missing key must fail without a request: %v", err)
	}
}

func TestAnthropicTruncationRetriesOnceAtLowEffort(t *testing.T) {
	cut := fakeResp{200, `{"content":[{"type":"thinking","thinking":"..."}],"stop_reason":"max_tokens","usage":{"input_tokens":100,"output_tokens":24000}}`}
	f := &fake{resp: []fakeResp{cut, anthropicOK(`{"ok":true}`, `{"input_tokens":100,"output_tokens":300}`)}}
	srv := f.server()
	defer srv.Close()
	p, _ := newClaude(srv.URL)
	resp, err := p.Complete(context.Background(), Request{System: "S", User: "U", Effort: "high"})
	if err != nil {
		t.Fatal(err)
	}
	if !resp.RetriedLow || len(f.hits) != 2 || f.hits[1].Body["max_tokens"] != float64(16000) {
		t.Errorf("retry: %+v hits %d", resp, len(f.hits))
	}
	if _, has := f.hits[1].Body["thinking"]; has {
		t.Error("the retry must not use extended thinking")
	}
	// costs of both calls add up
	c1 := (100*3 + 24000*15) / 1e6 * 7
	c2 := (100*3 + 300*15) / 1e6 * 7
	if resp.CostCNY == nil || math.Abs(*resp.CostCNY-(math.Round(c1*1e4)/1e4+math.Round(c2*1e4)/1e4)) > 1e-9 {
		t.Errorf("cost %v want %v", resp.CostCNY, c1+c2)
	}
}

func TestParseJSONLenient(t *testing.T) {
	for in, ok := range map[string]bool{`{"a":1}`: true, "```json\n{\"a\":1}\n```": true, `Sure! Here you go: {"a":1} Hope that helps.`: true, `no json`: false, `{broken`: false} {
		if (ParseJSONLenient(in) != nil) != ok {
			t.Errorf("%q → %v", in, ParseJSONLenient(in))
		}
	}
	if ParseJSON(`Sure: {"a":1}`) != nil {
		t.Error("the strict parser (DeepSeek path) must not accept prose")
	}
}

func TestOpenAICompatFixedModelPriceCostNoBalanceCalls(t *testing.T) {
	f := &fake{resp: []fakeResp{{200, `{"choices":[{"message":{"content":"{\"a\":1}"},"finish_reason":"stop"}],"usage":{"prompt_tokens":1000,"completion_tokens":100,"prompt_tokens_details":{"cached_tokens":600}}}`}}}
	srv := f.server()
	defer srv.Close()
	p := NewOpenAICompat("gpt", srv.URL, okKey, "gpt-x", []string{"low", "high"}, &Prices{InputPerM: 2, OutputPerM: 8, CacheReadPerM: 0.5, FXToCNY: 7})
	p.TokenParam = "max_completion_tokens"
	p.Sleep = noSleep
	resp, err := p.Complete(context.Background(), Request{System: "S", User: "U", Effort: "high"})
	if err != nil {
		t.Fatal(err)
	}
	if len(f.hits) != 1 || f.hits[0].Path != "/chat/completions" {
		t.Fatalf("exactly one request, no balance or model calls: %+v", f.hits)
	}
	b := f.hits[0].Body
	if b["model"] != "gpt-x" || b["max_completion_tokens"] != float64(24000) || b["reasoning_effort"] != "high" || b["max_tokens"] != nil {
		t.Errorf("body %v", b)
	}
	want := (400*2 + 600*0.5 + 100*8) / 1e6 * 7
	if resp.CostCNY == nil || math.Abs(*resp.CostCNY-math.Round(want*1e4)/1e4) > 1e-9 || resp.Tokens.CachedPrompt != 600 {
		t.Errorf("cost %v want %v tokens %+v", resp.CostCNY, want, resp.Tokens)
	}
	// no price table → cost unknown (nil), never 0
	p2 := NewOpenAICompat("gpt", srv.URL, okKey, "gpt-x", nil, nil)
	r2, _ := p2.Complete(context.Background(), Request{System: "S", User: "U", Effort: "low"})
	if r2.CostCNY != nil {
		t.Errorf("unknown prices must give an unknown cost, got %v", *r2.CostCNY)
	}
}

// ---- router
type stub struct {
	name  string
	resps []stubResp
	calls int
}
type stubResp struct {
	resp Response
	err  error
}

func (s *stub) Name() string { return s.name }
func (s *stub) Complete(_ context.Context, r Request) (Response, error) {
	i := min(s.calls, len(s.resps)-1)
	s.calls++
	out := s.resps[i]
	out.resp.Provider = s.name
	return out.resp, out.err
}
func cost(v float64) *float64 { return &v }
func okResp(c float64) stubResp {
	return stubResp{resp: Response{Text: "{}", JSON: map[string]any{}, Model: "m", Effort: "high", CostCNY: cost(c)}}
}

func capGuard(intent string, spend, cap, maxCall float64) (bool, string, string) {
	if spend >= cap {
		return false, "paused", "cap reached"
	}
	if cap-spend < maxCall {
		return false, "paused", "remaining below largest call"
	}
	if spend >= 0.8*cap && intent != "daily_brief" && intent != "question" {
		return false, "limited", "80 % used"
	}
	return true, "ok", ""
}

func newRouter(ps ...*stub) (*Router, *MemLedger) {
	led := &MemLedger{}
	r := &Router{Providers: map[string]Provider{}, Routes: map[string][]string{"default": {}}, Ledger: led, CapCNY: 10, Guard: capGuard, MaxCallsPerDay: map[string]int{}, Now: func() time.Time { return time.Date(2026, 11, 19, 3, 0, 0, 0, time.UTC) }}
	for _, p := range ps {
		r.Providers[p.name] = p
		r.Routes["default"] = append(r.Routes["default"], p.name)
	}
	return r, led
}

func TestRouterFirstProviderWinsAndIsRecorded(t *testing.T) {
	a, b := &stub{name: "a", resps: []stubResp{okResp(0.2)}}, &stub{name: "b", resps: []stubResp{okResp(0.5)}}
	r, led := newRouter(a, b)
	resp, att, err := r.Complete(context.Background(), "question", Request{}, nil, 42)
	if err != nil || resp.Provider != "a" || a.calls != 1 || b.calls != 0 || len(att) != 1 || !att[0].OK {
		t.Fatalf("resp %+v att %+v err %v", resp, att, err)
	}
	if len(led.Calls) != 1 || led.Calls[0].RunID != 42 || led.Calls[0].Intent != "question" || !led.Calls[0].OK || *led.Calls[0].CostCNY != 0.2 {
		t.Errorf("ledger %+v", led.Calls)
	}
}

func TestRouterFallsBackOnFailureAndOnRejectedAnswer(t *testing.T) {
	down := &stub{name: "a", resps: []stubResp{{err: &APIError{Status: 503, Msg: "a 503: down"}}}}
	bad := &stub{name: "b", resps: []stubResp{okResp(0.3)}}
	good := &stub{name: "c", resps: []stubResp{okResp(0.4)}}
	r, led := newRouter(down, bad, good)
	rejectB := func(resp Response) error {
		if resp.Provider == "b" {
			return errors.New("not valid JSON")
		}
		return nil
	}
	resp, att, err := r.Complete(context.Background(), "question", Request{}, rejectB, 7)
	if err != nil || resp.Provider != "c" {
		t.Fatalf("resp %+v err %v", resp, err)
	}
	if len(att) != 3 || att[0].Status != 503 || !strings.HasPrefix(att[1].Error, "answer rejected") || !att[2].OK {
		t.Errorf("attempts %+v", att)
	}
	if len(led.Calls) != 3 || led.Calls[0].OK || led.Calls[1].OK || !led.Calls[2].OK || led.Calls[1].Note != "answer rejected" {
		t.Errorf("ledger %+v", led.Calls)
	}
	if led.Calls[1].CostCNY == nil || *led.Calls[1].CostCNY != 0.3 {
		t.Error("a rejected answer still cost money and must be counted")
	}
}

func TestRouterAllFailAggregatesErrors(t *testing.T) {
	a := &stub{name: "a", resps: []stubResp{{err: &APIError{Status: 429, Msg: "a 429: slow"}}}}
	b := &stub{name: "b", resps: []stubResp{{err: &APIError{Status: 401, Msg: "b 401: bad key"}}}}
	r, _ := newRouter(a, b)
	_, _, err := r.Complete(context.Background(), "question", Request{}, nil, 0)
	var ae *APIError
	if !errors.As(err, &ae) || ae.Status != 401 || !strings.Contains(ae.Msg, "a: a 429: slow") || !strings.Contains(ae.Msg, "b: b 401: bad key") {
		t.Errorf("err %v", err)
	}
}

func TestRouterBudgetGuardBlocksBeforeAnyCall(t *testing.T) {
	a := &stub{name: "a", resps: []stubResp{okResp(0.2)}}
	r, led := newRouter(a)
	d := time.Date(2026, 11, 10, 0, 0, 0, 0, time.UTC)
	led.Calls = append(led.Calls, Call{At: d, Provider: "a", CostCNY: cost(9.5), OK: true})
	_, _, err := r.Complete(context.Background(), "question", Request{}, nil, 0)
	var eb *ErrBudget
	if !errors.As(err, &eb) || a.calls != 0 {
		t.Fatalf("remaining ¥0.5 is below the largest call ¥9.5: must be blocked without calling a provider: %v calls %d", err, a.calls)
	}
	led.Calls = nil
	for i := 0; i < 9; i++ { // ¥8.1 spent of ¥10, largest call ¥0.9: past the 80 % line, still room for one more call
		led.Calls = append(led.Calls, Call{At: d, Provider: "a", CostCNY: cost(0.9), OK: true})
	}
	if _, _, err := r.Complete(context.Background(), "weekly_review", Request{}, nil, 0); !errors.As(err, &eb) || eb.Level != "limited" {
		t.Errorf("80 %% rule: %v", err)
	}
	if _, _, err := r.Complete(context.Background(), "question", Request{}, nil, 0); err != nil || a.calls != 1 {
		t.Errorf("a question is still allowed at 81 %%: %v calls %d", err, a.calls)
	}
	// last month's spend does not count
	led.Calls = []Call{{At: time.Date(2026, 10, 20, 0, 0, 0, 0, time.UTC), CostCNY: cost(99), OK: true}}
	if _, _, err := r.Complete(context.Background(), "weekly_review", Request{}, nil, 0); err != nil {
		t.Errorf("a new month starts with a clean budget: %v", err)
	}
}

func TestRouterMonthBoundaryIsWIB(t *testing.T) {
	// 30 Nov 20:00 UTC is already 1 Dec 03:00 in WIB: that call belongs to December
	r, led := newRouter(&stub{name: "a", resps: []stubResp{okResp(0.1)}})
	led.Calls = []Call{{At: time.Date(2026, 11, 30, 20, 0, 0, 0, time.UTC), CostCNY: cost(9.9), OK: true}}
	r.Now = func() time.Time { return time.Date(2026, 11, 30, 10, 0, 0, 0, time.UTC) } // 30 Nov 17:00 WIB
	if s, _, _ := led.MonthSpend(context.Background(), r.Now()); s != 0 {
		t.Errorf("November spend should not include the call made after midnight WIB: %v", s)
	}
	r.Now = func() time.Time { return time.Date(2026, 12, 1, 1, 0, 0, 0, time.UTC) }
	if s, _, _ := led.MonthSpend(context.Background(), r.Now()); s != 9.9 {
		t.Errorf("December spend: %v", s)
	}
}

func TestRouterDailyCallCapForUnknownCostProviders(t *testing.T) {
	claude := &stub{name: "claude", resps: []stubResp{{resp: Response{Text: "{}", Model: "m"}}}} // cost nil = unknown
	r, led := newRouter(claude)
	r.MaxCallsPerDay["claude"] = 2
	for i := 0; i < 2; i++ {
		if _, _, err := r.Complete(context.Background(), "question", Request{}, nil, 0); err != nil {
			t.Fatal(err)
		}
	}
	_, att, err := r.Complete(context.Background(), "question", Request{}, nil, 0)
	if err == nil || claude.calls != 2 || len(att) != 1 || !strings.Contains(att[0].Skipped, "daily call cap") || len(led.Calls) != 2 {
		t.Errorf("third call must be skipped: err %v calls %d att %+v", err, claude.calls, att)
	}
}

func TestRouterRoutesPerIntent(t *testing.T) {
	cheap, strong := &stub{name: "cheap", resps: []stubResp{okResp(0.01)}}, &stub{name: "strong", resps: []stubResp{okResp(0.5)}}
	r, _ := newRouter(cheap, strong)
	r.Routes = map[string][]string{"daily_brief": {"cheap"}, "weekly_review": {"strong", "cheap"}, "default": {"cheap"}}
	for intent, want := range map[string]string{"daily_brief": "cheap", "weekly_review": "strong", "something_new": "cheap"} {
		resp, _, err := r.Complete(context.Background(), intent, Request{}, nil, 0)
		if err != nil || resp.Provider != want {
			t.Errorf("%s → %v (%v), want %s", intent, resp.Provider, err, want)
		}
	}
}

// ---- configuration
func TestConfigDefaultAndValidation(t *testing.T) {
	c, err := LoadConfig("")
	if err != nil || c.Providers["deepseek"].Kind != "deepseek" || c.Routes["default"][0] != "deepseek" {
		t.Fatalf("default config: %+v %v", c, err)
	}
	bad := []string{`{"providers":{"x":{"kind":"nope","base":"b","key_env":"K"}},"routes":{"default":["x"]}}`,
		`{"providers":{"x":{"kind":"anthropic","base":"b","key_env":"K"}},"routes":{"default":["x"]}}`, // model missing
		`{"providers":{"x":{"kind":"deepseek","base":"b","key_env":"K"}},"routes":{"default":["y"]}}`,  // unknown provider
		`{"providers":{"x":{"kind":"deepseek","base":"b","key_env":"K"}},"routes":{}}`}                 // no default
	for _, b := range bad {
		var c Config
		if json.Unmarshal([]byte(b), &c) != nil || c.Validate() == nil {
			t.Errorf("should be rejected: %s", b)
		}
	}
}

func TestBuildWiresProvidersCapsAndKeys(t *testing.T) {
	cfg := Config{Providers: map[string]ProviderCfg{
		"deepseek": {Kind: "deepseek", Base: "http://x", KeyEnv: "DS", ModelEnv: "DS_MODEL"},
		"claude":   {Kind: "anthropic", Base: "http://y", KeyEnv: "AK", Model: "claude-sonnet-5-5"},
		"gpt":      {Kind: "openai", Base: "http://z", KeyEnv: "OK", Model: "gpt-x", Prices: &Prices{InputPerM: 1, OutputPerM: 2}},
	}, Routes: map[string][]string{"default": {"deepseek", "claude"}, "question": {"claude", "gpt"}, "ds_only": {"deepseek"}}}
	env := map[string]string{"DEEPSEEK_MONTHLY_CAP_CNY": "20", "AK": "ak-1"}
	r, err := Build(cfg, MemKV{}, &MemLedger{}, capGuard, func(k string) string { return env[k] })
	if err != nil {
		t.Fatal(err)
	}
	if r.CapCNY != 20 || len(r.Providers) != 3 || r.MaxCallsPerDay["claude"] != 20 || r.MaxCallsPerDay["gpt"] != 0 || r.MaxCallsPerDay["deepseek"] != 0 {
		t.Errorf("cap %v providers %d calls/day %v", r.CapCNY, len(r.Providers), r.MaxCallsPerDay)
	}
	// keys are read at call time: a provider without its key fails with a clear message and the router moves on
	t0 := time.Now()
	_, _, err = r.Complete(context.Background(), "ds_only", Request{System: "S", User: "U"}, nil, 0)
	if err == nil || !strings.Contains(err.Error(), "DS not set") {
		t.Errorf("missing DeepSeek key should be reported: %v", err)
	}
	if time.Since(t0) > 2*time.Second {
		t.Errorf("a missing key must not be retried with sleeps: took %v", time.Since(t0))
	}
}

func TestAnthropicThinkingOnlyWhenTheBudgetFitsUnderMaxTokens(t *testing.T) {
	f := &fake{resp: []fakeResp{anthropicOK(`{"a":1}`, `{"input_tokens":1,"output_tokens":1}`)}}
	srv := f.server()
	defer srv.Close()
	p, _ := newClaude(srv.URL) // thinking budget for "high" is 6000
	if _, err := p.Complete(context.Background(), Request{System: "S", User: "U", Effort: "high", MaxTokens: 4000}); err != nil {
		t.Fatal(err)
	}
	if _, has := f.hits[0].Body["thinking"]; has {
		t.Error("the API requires max_tokens > budget_tokens: a 6000-token thinking budget cannot be used with max_tokens 4000")
	}
	if _, err := p.Complete(context.Background(), Request{System: "S", User: "U", Effort: "high", MaxTokens: 6001}); err != nil {
		t.Fatal(err)
	}
	if _, has := f.hits[1].Body["thinking"]; !has {
		t.Error("thinking should be used once the budget fits")
	}
}

func TestMissingKeyIsNeverRetriedAndMakesNoRequest(t *testing.T) {
	f := &fake{resp: []fakeResp{{200, `{}`}}}
	srv := f.server()
	defer srv.Close()
	noKey := func() (string, error) { return "", errors.New("KEY not set") }
	var slept []time.Duration
	a := &Anthropic{ProviderName: "claude", Base: srv.URL, Key: noKey, Model: "m", Sleep: func(d time.Duration) { slept = append(slept, d) }}
	d := NewDeepSeek(srv.URL, noKey, "pinned-model", MemKV{})
	d.Sleep = func(x time.Duration) { slept = append(slept, x) }
	for _, p := range []Provider{a, d} {
		_, err := p.Complete(context.Background(), Request{System: "S", User: "U", Effort: "low"})
		var ae *APIError
		if !errors.As(err, &ae) || ae.Status != 503 || !ae.Permanent {
			t.Errorf("%s: %v", p.Name(), err)
		}
	}
	if len(slept) != 0 || len(f.hits) != 0 {
		t.Errorf("a missing key must fail at once: sleeps %v, requests %d", slept, len(f.hits))
	}
}
