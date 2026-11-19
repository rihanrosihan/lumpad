// Package llm: the provider-agnostic model gateway (redesign Phase 4). One interface in front of DeepSeek, Anthropic and any
// OpenAI-compatible API; routing, fallback, budget guard and the call ledger sit on top (router.go).
package llm

import (
	"context"
	"encoding/json"
	"unicode/utf16"
)

type Message struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// Request is one logical model call. System is the stable prefix (identical between calls: providers that support prompt caching reuse it).
type Request struct {
	System, User string
	Messages     []Message // when set, sent as given (the repair prompt) instead of System + User
	Effort       string    // low | medium | high | max; empty = high
	MaxTokens    int       // 0 = by effort budget
	Intent       string
}

type TokenUsage struct {
	Prompt, Completion, Reasoning, CachedPrompt int
}

type Response struct {
	Text       string          `json:"text"`
	JSON       any             `json:"json"` // nil when the reply is not JSON
	Usage      json.RawMessage `json:"usage"`
	Tokens     TokenUsage      `json:"-"`
	Provider   string          `json:"provider"`
	Model      string          `json:"model"`
	ModelName  string          `json:"model_name"`
	CostCNY    *float64        `json:"cost_cny"`
	Effort     string          `json:"effort"`
	RetriedLow bool            `json:"retried_low"`
	Finish     string          `json:"-"`
}

// APIError is a failed call. Truncated: the model used its whole token budget before finishing (its hidden reasoning counts inside max_tokens).
type APIError struct {
	Status    int
	Msg       string
	Truncated bool
	Text      string
	CostCNY   *float64
	Permanent bool // retrying cannot help (for example the API key is not set)
}

func (e *APIError) Error() string { return e.Msg }

// Retryable: a failure another attempt can fix (rate limit, server error, network error). A missing key or a truncated answer is not.
func (e *APIError) Retryable() bool {
	if e.Permanent || e.Truncated {
		return false
	}
	switch e.Status {
	case 429, 500, 502, 503, 504, 0:
		return true
	}
	return false
}

type Provider interface {
	Name() string
	// Complete makes one call including the provider's own retries; it never falls back to another provider.
	Complete(ctx context.Context, r Request) (Response, error)
}

// Budget: max_tokens by effort (the hidden reasoning counts inside it, so 'high' needs far more than the answer itself).
func Budget(effort string) int {
	switch effort {
	case "high":
		return 24000
	case "medium":
		return 14000
	case "low":
		return 8000
	}
	return 14000
}

func jsSlice(s string, n int) string {
	u := utf16.Encode([]rune(s))
	if len(u) <= n {
		return s
	}
	return string(utf16.Decode(u[:n]))
}
