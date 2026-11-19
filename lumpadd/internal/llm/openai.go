package llm

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/rihanrosihan/lumpad/lumpadd/internal/engine"
)

// OpenAI-compatible chat-completions provider (DeepSeek, OpenAI, OpenRouter, Together, Groq, Mistral, …). The DeepSeek flavour (model resolution
// from /models, balance-drop cost) is a port of server/intel/llm.js and is verified request for request against it (testdata/deepseek_traces.json).

type CostMeter interface {
	// Before / After bracket a call; the cost is what the meter says it cost (nil = unknown).
	Before(ctx context.Context) (balance *float64)
	After(ctx context.Context) (balance *float64)
}

type OpenAI struct {
	ProviderName string
	Base         string
	Key          func() (string, error)
	HTTP         *http.Client
	Models       func(ctx context.Context) (ModelInfo, error) // resolves the model for a call
	Meter        CostMeter
	Sleep        func(time.Duration)
	Now          func() time.Time
}

func (p *OpenAI) Name() string { return p.ProviderName }
func (p *OpenAI) sleep(d time.Duration) {
	if p.Sleep != nil {
		p.Sleep(d)
		return
	}
	time.Sleep(d)
}
func (p *OpenAI) client() *http.Client {
	if p.HTTP != nil {
		return p.HTTP
	}
	return http.DefaultClient
}

// api: one HTTP call; a non-2xx answer becomes an *APIError carrying the provider's message.
func (p *OpenAI) api(ctx context.Context, method, path string, body any, timeout time.Duration) (map[string]any, error) {
	key, err := p.Key()
	if err != nil {
		return nil, &APIError{Status: 503, Msg: err.Error()}
	}
	var rd io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rd = bytes.NewReader(b)
	}
	c, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	req, err := http.NewRequestWithContext(c, method, p.Base+path, rd)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+key)
	req.Header.Set("Content-Type", "application/json")
	resp, err := p.client().Do(req)
	if err != nil {
		return nil, &APIError{Status: 0, Msg: p.ProviderName + " request failed: " + jsSlice(err.Error(), 200)}
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	var j map[string]any
	if json.Unmarshal(raw, &j) != nil {
		j = nil
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		msg := string(raw)
		if e, ok := j["error"].(map[string]any); ok {
			if m, ok := e["message"].(string); ok && m != "" {
				msg = m
			}
		}
		return nil, &APIError{Status: resp.StatusCode, Msg: fmt.Sprintf("%s %d: %s", p.ProviderName, resp.StatusCode, jsSlice(msg, 200))}
	}
	return j, nil
}

var (
	reFenceOpen  = regexp.MustCompile("(?i)^```(?:json)?\\s*")
	reFenceClose = regexp.MustCompile("\\s*```$")
)

func stripFence(t string) string {
	t = strings.TrimSpace(t)
	t = reFenceOpen.ReplaceAllString(t, "")
	return reFenceClose.ReplaceAllString(t, "")
}

// ParseJSON: the model's reply as JSON (code fences removed); nil when it is not JSON.
func ParseJSON(text string) any {
	var v any
	if err := json.Unmarshal([]byte(stripFence(text)), &v); err != nil {
		return nil
	}
	return v
}

func costOf(pre, post *float64) *float64 {
	if pre == nil || post == nil {
		return nil
	}
	v, _ := strconv.ParseFloat(engine.ToFixed(math.Max(0, *pre-*post), 4), 64)
	return &v
}

// Complete: one call with the truncation rule — a reply cut off by max_tokens (the hidden reasoning ate the budget) is retried once at low effort.
func (p *OpenAI) Complete(ctx context.Context, r Request) (Response, error) {
	effort := r.Effort
	if effort == "" {
		effort = "high"
	}
	max := r.MaxTokens
	if max == 0 {
		max = Budget(effort)
	}
	resp, err := p.once(ctx, r, effort, max)
	if err == nil {
		return resp, nil
	}
	ae, ok := err.(*APIError)
	if !ok || !ae.Truncated || effort == "low" {
		return resp, err
	}
	max2 := r.MaxTokens
	if max2 == 0 {
		max2 = Budget("low") * 2
	}
	r2, err2 := p.once(ctx, r, "low", max2)
	if err2 != nil {
		return r2, err2
	}
	r2.RetriedLow = true
	if r2.CostCNY != nil && ae.CostCNY != nil {
		v, _ := strconv.ParseFloat(engine.ToFixed(*r2.CostCNY+*ae.CostCNY, 4), 64)
		r2.CostCNY = &v
	}
	return r2, nil
}

func (p *OpenAI) once(ctx context.Context, r Request, effort string, maxTokens int) (Response, error) {
	model, err := p.Models(ctx)
	if err != nil {
		return Response{}, err
	}
	var pre *float64
	if p.Meter != nil {
		pre = p.Meter.Before(ctx)
	}
	msgs := r.Messages
	if msgs == nil {
		msgs = []Message{{"system", r.System}, {"user", r.User}}
	}
	body := map[string]any{"model": model.ID, "messages": msgs, "response_format": map[string]any{"type": "json_object"}, "max_tokens": maxTokens, "stream": false}
	for _, e := range model.Efforts {
		if e == effort {
			body["reasoning_effort"] = effort
			break
		}
	}
	var j map[string]any
	var lastErr error
	for a := 0; a < 3; a++ {
		j, err = p.api(ctx, "POST", "/chat/completions", body, 120*time.Second)
		if err == nil {
			break
		}
		lastErr = err
		ae, ok := err.(*APIError)
		if !ok {
			return Response{}, err
		}
		if ae.Status == 400 && body["reasoning_effort"] != nil {
			delete(body, "reasoning_effort")
			continue
		}
		if !ae.Retryable() {
			return Response{}, err
		}
		p.sleep(time.Duration(1500*(a+1)) * time.Millisecond)
	}
	if j == nil {
		if lastErr == nil {
			lastErr = &APIError{Msg: p.ProviderName + ": empty response"}
		}
		return Response{}, lastErr
	}
	var post *float64
	if p.Meter != nil {
		post = p.Meter.After(ctx)
	}
	text, finish := "", ""
	if ch, ok := j["choices"].([]any); ok && len(ch) > 0 {
		if c0, ok := ch[0].(map[string]any); ok {
			if m, ok := c0["message"].(map[string]any); ok {
				text, _ = m["content"].(string)
			}
			finish, _ = c0["finish_reason"].(string)
		}
	}
	cost := costOf(pre, post)
	if finish == "length" {
		return Response{}, &APIError{Status: 502, Msg: "response truncated (max_tokens) — the model used its whole budget before finishing", Truncated: true, Text: text, CostCNY: cost}
	}
	usageRaw, _ := json.Marshal(j["usage"])
	if j["usage"] == nil {
		usageRaw = []byte("null")
	}
	return Response{Text: text, JSON: ParseJSON(text), Usage: usageRaw, Tokens: openAITokens(j["usage"]), Provider: p.ProviderName, Model: model.ID, ModelName: model.Name, CostCNY: cost, Effort: effort, Finish: finish}, nil
}

func openAITokens(u any) TokenUsage {
	m, _ := u.(map[string]any)
	f := func(v any) int { x, _ := v.(float64); return int(x) }
	t := TokenUsage{Prompt: f(m["prompt_tokens"]), Completion: f(m["completion_tokens"]), CachedPrompt: f(m["prompt_cache_hit_tokens"])}
	if d, ok := m["completion_tokens_details"].(map[string]any); ok {
		t.Reasoning = f(d["reasoning_tokens"])
	}
	if d, ok := m["prompt_tokens_details"].(map[string]any); ok && t.CachedPrompt == 0 {
		t.CachedPrompt = f(d["cached_tokens"])
	}
	return t
}
