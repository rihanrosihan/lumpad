package llm

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"
)

// Router: picks the provider chain for an intent, enforces the monthly budget before every call, falls back to the next provider when a call
// fails (or when the caller rejects the answer, e.g. it does not match the required JSON shape), and records every call in the ledger.

type Call struct {
	At         time.Time
	RunID      int64
	Intent     string
	Provider   string
	Model      string
	Effort     string
	OK         bool
	Error      string
	Status     int
	Tokens     TokenUsage
	CostCNY    *float64
	LatencyMs  int
	RetriedLow bool
	Note       string
}

type Ledger interface {
	Record(ctx context.Context, c Call) error
	// MonthSpend: CNY spent and the largest single call in the month (WIB) containing `at`.
	MonthSpend(ctx context.Context, at time.Time) (spend, maxCall float64, err error)
	CallsToday(ctx context.Context, provider string, at time.Time) (int, error)
}

// GuardFn decides whether a call may start (coach.GuardDecision in production; injected to keep this package free of coach).
type GuardFn func(intent string, spend, cap, maxCall float64) (ok bool, level, reason string)

type Attempt struct {
	Provider string `json:"provider"`
	OK       bool   `json:"ok"`
	Error    string `json:"error,omitempty"`
	Status   int    `json:"status,omitempty"`
	Skipped  string `json:"skipped,omitempty"`
}

type Router struct {
	Providers      map[string]Provider
	Routes         map[string][]string // intent → provider names, in order; "default" is the fallback entry
	Ledger         Ledger
	CapCNY         float64
	Guard          GuardFn
	MaxCallsPerDay map[string]int // per provider: a safety cap for providers whose cost is unknown
	Now            func() time.Time
}

func (r *Router) now() time.Time {
	if r.Now != nil {
		return r.Now()
	}
	return time.Now()
}

func (r *Router) chain(intent string) []string {
	if c, ok := r.Routes[intent]; ok && len(c) > 0 {
		return c
	}
	return r.Routes["default"]
}

// ErrBudget: the monthly cap (or its 80 % rule) stopped the call; no provider was contacted.
type ErrBudget struct{ Level, Reason string }

func (e *ErrBudget) Error() string { return e.Reason }

// Chain: the providers that serve an intent, in order.
func (r *Router) Chain(intent string) []string { return r.chain(intent) }

// CompleteOn makes one call on one named provider with the same budget guard, daily cap and ledger entry as Complete. A rejected answer (accept
// returns an error) is recorded as a failed call that still cost money. It never falls back.
func (r *Router) CompleteOn(ctx context.Context, name, intent string, req Request, accept func(Response) error, runID int64) (Response, Attempt, error) {
	p, ok := r.Providers[name]
	if !ok {
		return Response{}, Attempt{Provider: name, Skipped: "unknown provider"}, &APIError{Status: 503, Msg: "unknown provider " + name, Permanent: true}
	}
	spend, maxCall, err := r.Ledger.MonthSpend(ctx, r.now())
	if err != nil {
		return Response{}, Attempt{Provider: name, Error: err.Error()}, err
	}
	if r.Guard != nil {
		if ok, level, reason := r.Guard(intent, spend, r.CapCNY, maxCall); !ok {
			return Response{}, Attempt{Provider: name, Skipped: reason}, &ErrBudget{Level: level, Reason: reason}
		}
	}
	if cap := r.MaxCallsPerDay[name]; cap > 0 {
		if n, err := r.Ledger.CallsToday(ctx, name, r.now()); err == nil && n >= cap {
			msg := fmt.Sprintf("daily call cap %d reached", cap)
			return Response{}, Attempt{Provider: name, Skipped: msg}, &APIError{Status: 429, Msg: name + ": " + msg, Permanent: true}
		}
	}
	req.Intent = intent
	t0 := time.Now()
	resp, err := p.Complete(ctx, req)
	call := Call{At: r.now(), RunID: runID, Intent: intent, Provider: name, Effort: req.Effort, Model: resp.Model, LatencyMs: int(time.Since(t0) / time.Millisecond)}
	if err != nil {
		ae, isAPI := err.(*APIError)
		call.Error = jsSlice(err.Error(), 300)
		if isAPI {
			call.Status, call.CostCNY = ae.Status, ae.CostCNY
		}
		_ = r.Ledger.Record(ctx, call)
		return Response{}, Attempt{Provider: name, Error: call.Error, Status: call.Status}, err
	}
	call.Model, call.Effort, call.Tokens, call.CostCNY, call.RetriedLow, call.OK = resp.Model, resp.Effort, resp.Tokens, resp.CostCNY, resp.RetriedLow, true
	if accept != nil {
		if aerr := accept(resp); aerr != nil {
			call.OK, call.Error, call.Note = false, jsSlice(aerr.Error(), 300), "answer rejected"
			_ = r.Ledger.Record(ctx, call)
			return resp, Attempt{Provider: name, Error: "answer rejected: " + call.Error}, aerr
		}
	}
	_ = r.Ledger.Record(ctx, call)
	return resp, Attempt{Provider: name, OK: true}, nil
}

// Complete runs one logical call down the chain. accept (optional) judges the answer; a rejected answer counts as a failed attempt and the next
// provider is tried. A budget stop ends the whole call (no provider is contacted).
func (r *Router) Complete(ctx context.Context, intent string, req Request, accept func(Response) error, runID int64) (Response, []Attempt, error) {
	var attempts []Attempt
	names := r.chain(intent)
	if len(names) == 0 {
		return Response{}, nil, &APIError{Status: 503, Msg: "no provider configured for " + intent}
	}
	var errs []string
	lastStatus := 0
	for _, name := range names {
		resp, att, err := r.CompleteOn(ctx, name, intent, req, accept, runID)
		attempts = append(attempts, att)
		if err == nil {
			return resp, attempts, nil
		}
		var eb *ErrBudget
		if errors.As(err, &eb) {
			return Response{}, attempts[:len(attempts)-1], err
		}
		if att.Skipped != "" && att.Skipped == "unknown provider" {
			continue
		}
		msg := att.Error
		if msg == "" {
			msg = err.Error()
		}
		errs = append(errs, name+": "+msg)
		if att.Status != 0 {
			lastStatus = att.Status
		}
	}
	status := lastStatus
	if status == 0 {
		status = 502
	}
	return Response{}, attempts, &APIError{Status: status, Msg: "all providers failed — " + strings.Join(errs, "; ")}
}
