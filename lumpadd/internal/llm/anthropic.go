package llm

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// Anthropic Messages API provider. The stable system prompt is sent as a cached block (cache_control), so the long, identical prefix of every coach
// call is billed at the cache-read price after the first call. Anthropic has no JSON mode: the prompt already demands one JSON object, and the reply is
// parsed leniently (code fences and surrounding prose are tolerated).

type Anthropic struct {
	ProviderName string
	Base         string
	Key          func() (string, error)
	Model        string
	Version      string         // anthropic-version header
	Thinking     map[string]int // effort → extended-thinking budget tokens; absent = no extended thinking
	Prices       *Prices
	HTTP         *http.Client
	Sleep        func(time.Duration)
}

func (p *Anthropic) Name() string { return p.ProviderName }
func (p *Anthropic) sleep(d time.Duration) {
	if p.Sleep != nil {
		p.Sleep(d)
		return
	}
	time.Sleep(d)
}

func (p *Anthropic) call(ctx context.Context, body map[string]any) (map[string]any, error) {
	key, err := p.Key()
	if err != nil {
		return nil, &APIError{Status: 503, Msg: err.Error(), Permanent: true}
	}
	b, _ := json.Marshal(body)
	c, cancel := context.WithTimeout(ctx, 180*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(c, "POST", p.Base+"/v1/messages", bytes.NewReader(b))
	if err != nil {
		return nil, err
	}
	req.Header.Set("x-api-key", key)
	v := p.Version
	if v == "" {
		v = "2023-06-01"
	}
	req.Header.Set("anthropic-version", v)
	req.Header.Set("content-type", "application/json")
	client := p.HTTP
	if client == nil {
		client = http.DefaultClient
	}
	resp, err := client.Do(req)
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

func anthropicRetryable(e *APIError) bool {
	if e.Permanent {
		return false
	}
	switch e.Status {
	case 429, 500, 502, 503, 504, 529, 0: // 529 = overloaded
		return true
	}
	return false
}

func (p *Anthropic) Complete(ctx context.Context, r Request) (Response, error) {
	effort := r.Effort
	if effort == "" {
		effort = "high"
	}
	max := r.MaxTokens
	if max == 0 {
		max = Budget(effort)
	}
	resp, err := p.once(ctx, r, effort, max)
	ae, ok := err.(*APIError)
	if err == nil || !ok || !ae.Truncated || effort == "low" {
		return resp, err
	}
	// cut off by max_tokens (thinking counts inside it): retry once without extended thinking and with a larger answer share
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
		v := *r2.CostCNY + *ae.CostCNY
		r2.CostCNY = &v
	}
	return r2, nil
}

func (p *Anthropic) once(ctx context.Context, r Request, effort string, maxTokens int) (Response, error) {
	system, msgs := r.System, []map[string]any{{"role": "user", "content": r.User}}
	if r.Messages != nil { // the repair prompt: a leading system message becomes the system block, the rest are turns
		system, msgs = "", nil
		for _, m := range r.Messages {
			if m.Role == "system" {
				system += m.Content
				continue
			}
			msgs = append(msgs, map[string]any{"role": m.Role, "content": m.Content})
		}
	}
	body := map[string]any{"model": p.Model, "max_tokens": maxTokens, "messages": msgs}
	if system != "" {
		body["system"] = []map[string]any{{"type": "text", "text": system, "cache_control": map[string]any{"type": "ephemeral"}}}
	}
	if b := p.Thinking[effort]; b > 0 && maxTokens > b {
		body["thinking"] = map[string]any{"type": "enabled", "budget_tokens": b}
	}
	var j map[string]any
	var lastErr error
	for a := 0; a < 3; a++ {
		var err error
		j, err = p.call(ctx, body)
		if err == nil {
			break
		}
		lastErr = err
		ae, ok := err.(*APIError)
		if !ok || !anthropicRetryable(ae) {
			return Response{}, err
		}
		p.sleep(time.Duration(1500*(a+1)) * time.Millisecond)
	}
	if j == nil {
		return Response{}, lastErr
	}
	var text strings.Builder
	if blocks, ok := j["content"].([]any); ok {
		for _, bl := range blocks {
			if m, ok := bl.(map[string]any); ok && m["type"] == "text" {
				s, _ := m["text"].(string)
				text.WriteString(s)
			}
		}
	}
	stop, _ := j["stop_reason"].(string)
	u, _ := j["usage"].(map[string]any)
	f := func(k string) int { x, _ := u[k].(float64); return int(x) }
	read, write := f("cache_read_input_tokens"), f("cache_creation_input_tokens")
	// Anthropic reports input_tokens WITHOUT the cached parts; Prompt here is the full prompt size
	tokens := TokenUsage{Prompt: f("input_tokens") + read + write, Completion: f("output_tokens"), CachedPrompt: read}
	cost := p.Prices.Cost(tokens, write)
	if stop == "max_tokens" {
		return Response{}, &APIError{Status: 502, Msg: "response truncated (max_tokens) — the model used its whole budget before finishing", Truncated: true, Text: text.String(), CostCNY: cost}
	}
	usageRaw, _ := json.Marshal(j["usage"])
	return Response{Text: text.String(), JSON: ParseJSONLenient(text.String()), Usage: usageRaw, Tokens: tokens, Provider: p.ProviderName, Model: p.Model, ModelName: p.Model, CostCNY: cost, Effort: effort, Finish: stop}, nil
}

// ParseJSONLenient: like ParseJSON, and when the reply wraps the object in prose, the outermost {...} is tried.
func ParseJSONLenient(text string) any {
	if v := ParseJSON(text); v != nil {
		return v
	}
	i, k := strings.Index(text, "{"), strings.LastIndex(text, "}")
	if i >= 0 && k > i {
		var v any
		if json.Unmarshal([]byte(text[i:k+1]), &v) == nil {
			return v
		}
	}
	return nil
}
