package llm

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"
)

type scripted struct {
	Status int             `json:"status"`
	Body   json.RawMessage `json:"body"`
	Text   *string         `json:"text"`
}
type trace struct {
	Name  string
	Env   map[string]string
	Cache *struct {
		ID      string
		Name    string
		Context *float64
		Efforts []string
		Age     string
	}
	Opts struct {
		System, User string
		Messages     []Message
		Effort       string
		MaxTokens    int
		Intent       string
	}
	Script   map[string][]scripted
	Requests []struct {
		Method, Path string
		Auth         *string
		Body         any
	}
	Delays []float64
	Result *struct {
		Text       string
		JSON       any
		Usage      any
		Model      string
		ModelName  string   `json:"model_name"`
		CostCNY    *float64 `json:"cost_cny"`
		Effort     string
		RetriedLow *bool `json:"retried_low"`
	}
	Error *struct {
		Message   string
		Status    *int
		Truncated bool
		CostCNY   *float64 `json:"cost_cny"`
		Text      *string
	}
	CacheAfter *struct {
		ID, Name string
		Changed  *bool
	}
}

var fixedNow = time.Date(2026, 11, 19, 0, 0, 0, 0, time.UTC)

func TestDeepSeekMatchesNodeClientTraces(t *testing.T) {
	b, err := os.ReadFile("testdata/deepseek_traces.json")
	if err != nil {
		t.Fatal(err)
	}
	var traces []trace
	if err := json.Unmarshal(b, &traces); err != nil {
		t.Fatal(err)
	}
	if len(traces) < 20 {
		t.Fatalf("only %d traces; run node tools/gen_llm_traces.mjs", len(traces))
	}
	for _, tr := range traces {
		t.Run(tr.Name, func(t *testing.T) {
			var mu sync.Mutex
			queues := map[string][]scripted{}
			for k, v := range tr.Script {
				queues[k] = append([]scripted{}, v...)
			}
			type rec struct {
				Method, Path string
				Auth         *string
				Body         any
			}
			var got []rec
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				mu.Lock()
				defer mu.Unlock()
				rc := rec{Method: r.Method, Path: r.URL.Path}
				if a := r.Header.Get("Authorization"); a != "" {
					rc.Auth = &a
				}
				if r.Method == "POST" {
					raw, _ := io.ReadAll(r.Body)
					_ = json.Unmarshal(raw, &rc.Body)
				}
				got = append(got, rc)
				q := queues[r.URL.Path]
				if len(q) == 0 {
					http.Error(w, "script exhausted for "+r.URL.Path, 599)
					return
				}
				s := q[0]
				queues[r.URL.Path] = q[1:]
				w.WriteHeader(s.Status)
				if s.Text != nil {
					_, _ = w.Write([]byte(*s.Text))
				} else {
					_, _ = w.Write(s.Body)
				}
			}))
			defer srv.Close()

			kv := MemKV{}
			if tr.Cache != nil {
				age := map[string]float64{"fresh": 1000, "stale": 2 * 864e5, "near": 0.95 * 864e5, "over": 1.05 * 864e5}[tr.Cache.Age]
				_ = kv.Set("deepseek_model", ModelInfo{ID: tr.Cache.ID, Name: tr.Cache.Name, Context: tr.Cache.Context, Efforts: tr.Cache.Efforts, At: float64(fixedNow.UnixMilli()) - age})
				// as Node stored it: no "changed" key
				var m map[string]any
				_ = json.Unmarshal(kv["deepseek_model"], &m)
				delete(m, "changed")
				kv["deepseek_model"], _ = json.Marshal(m)
			}
			d := NewDeepSeek(srv.URL, func() (string, error) { return "sk-test", nil }, tr.Env["DEEPSEEK_MODEL"], kv)
			var delays []float64
			d.Sleep = func(x time.Duration) { delays = append(delays, float64(x/time.Millisecond)) }
			d.Now = func() time.Time { return fixedNow }

			resp, err := d.Complete(context.Background(), Request{System: tr.Opts.System, User: tr.Opts.User, Messages: tr.Opts.Messages, Effort: tr.Opts.Effort, MaxTokens: tr.Opts.MaxTokens, Intent: tr.Opts.Intent})

			if len(got) != len(tr.Requests) {
				t.Fatalf("requests: go made %d, node %d\n go: %v\n js: %v", len(got), len(tr.Requests), paths(got), tr.Requests)
			}
			for i, want := range tr.Requests {
				g := got[i]
				if g.Method != want.Method || g.Path != want.Path || !reflect.DeepEqual(g.Auth, want.Auth) || !reflect.DeepEqual(g.Body, want.Body) {
					gj, _ := json.Marshal(g)
					wj, _ := json.Marshal(want)
					t.Errorf("request %d differs:\n  go %s\n  js %s", i, gj, wj)
				}
			}
			if !reflect.DeepEqual(nz(delays), nz(tr.Delays)) {
				t.Errorf("retry delays: go %v node %v", delays, tr.Delays)
			}
			if tr.Error != nil {
				ae, ok := err.(*APIError)
				if err == nil {
					t.Fatalf("expected error %q, got success", tr.Error.Message)
				}
				if !ok {
					ae = &APIError{Msg: err.Error()}
				}
				if ae.Msg != tr.Error.Message || ae.Truncated != tr.Error.Truncated || !statusEq(ae.Status, tr.Error.Status) || !floatEq(ae.CostCNY, tr.Error.CostCNY) || !strEq(ae.Text, tr.Error.Text) {
					t.Errorf("error differs:\n  go %+v\n  js %+v", ae, tr.Error)
				}
			} else {
				if err != nil {
					t.Fatalf("unexpected error: %v", err)
				}
				w := tr.Result
				var usage any
				_ = json.Unmarshal(resp.Usage, &usage)
				retried := tr.Result.RetriedLow != nil && *tr.Result.RetriedLow
				if resp.Text != w.Text || !reflect.DeepEqual(resp.JSON, w.JSON) || !reflect.DeepEqual(usage, w.Usage) || resp.Model != w.Model || resp.ModelName != w.ModelName || !floatEq(resp.CostCNY, w.CostCNY) || resp.Effort != w.Effort || resp.RetriedLow != retried {
					gj, _ := json.Marshal(resp)
					wj, _ := json.Marshal(w)
					t.Errorf("result differs:\n  go %s\n  js %s", gj, wj)
				}
			}
			if tr.CacheAfter != nil {
				var m map[string]any
				raw, _ := kv.Get("deepseek_model")
				_ = json.Unmarshal(raw, &m)
				var ch *bool
				if c, ok := m["changed"].(bool); ok {
					ch = &c
				}
				if m["id"] != tr.CacheAfter.ID || m["name"] != tr.CacheAfter.Name || !reflect.DeepEqual(ch, tr.CacheAfter.Changed) {
					t.Errorf("cached model after: go %v, node %+v", m, tr.CacheAfter)
				}
			}
		})
	}
}

func paths(g any) string { return fmt.Sprint(g) }
func nz(x []float64) []float64 {
	if len(x) == 0 {
		return nil
	}
	return x
}
func statusEq(a int, b *int) bool {
	if b == nil {
		return a == 0
	}
	return a == *b
}
func floatEq(a, b *float64) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return *a == *b
}
func strEq(a string, b *string) bool {
	if b == nil {
		return a == ""
	}
	return a == *b
}

var _ = strings.TrimSpace
