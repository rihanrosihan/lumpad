package llm

import (
	"context"
	"math"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// WIB (UTC+7): the athlete's calendar; the monthly cap and the daily call cap reset on WIB boundaries, as in the Node app.
var wib = time.FixedZone("WIB", 7*3600)

func monthBounds(at time.Time) (time.Time, time.Time) {
	t := at.In(wib)
	s := time.Date(t.Year(), t.Month(), 1, 0, 0, 0, 0, wib)
	return s, s.AddDate(0, 1, 0)
}
func dayBounds(at time.Time) (time.Time, time.Time) {
	t := at.In(wib)
	s := time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, wib)
	return s, s.AddDate(0, 0, 1)
}

// MemLedger: in-memory ledger for tests and dry runs.
type MemLedger struct {
	mu    sync.Mutex
	Calls []Call
}

func (m *MemLedger) Record(_ context.Context, c Call) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.Calls = append(m.Calls, c)
	return nil
}
func (m *MemLedger) MonthSpend(_ context.Context, at time.Time) (float64, float64, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	s, e := monthBounds(at)
	spend, maxCall := 0.0, 0.0
	for _, c := range m.Calls {
		if c.CostCNY != nil && !c.At.Before(s) && c.At.Before(e) {
			spend += *c.CostCNY
			maxCall = math.Max(maxCall, *c.CostCNY)
		}
	}
	return math.Round(spend*1e4) / 1e4, maxCall, nil
}
func (m *MemLedger) CallsToday(_ context.Context, provider string, at time.Time) (int, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	s, e := dayBounds(at)
	n := 0
	for _, c := range m.Calls {
		if c.Provider == provider && !c.At.Before(s) && c.At.Before(e) {
			n++
		}
	}
	return n, nil
}

// PGLedger: coach.llm_call in PostgreSQL.
type PGLedger struct{ Pool *pgxpool.Pool }

func (l PGLedger) Record(ctx context.Context, c Call) error {
	currency := any(nil)
	if c.CostCNY != nil {
		currency = "CNY"
	}
	_, err := l.Pool.Exec(ctx, `INSERT INTO coach.llm_call (at, run_id, intent, provider, model, effort, ok, error, status, tokens_in, tokens_out, tokens_reasoning, tokens_cached, cost, currency, latency_ms, retried_low, note)
		VALUES ($1, NULLIF($2::bigint, 0), $3, $4, $5, NULLIF($6, ''), $7, NULLIF($8, ''), NULLIF($9::int, 0), $10, $11, $12, $13, $14, $15, $16, $17, NULLIF($18, ''))`,
		c.At, c.RunID, c.Intent, c.Provider, c.Model, c.Effort, c.OK, c.Error, c.Status, c.Tokens.Prompt, c.Tokens.Completion, c.Tokens.Reasoning, c.Tokens.CachedPrompt, c.CostCNY, currency, c.LatencyMs, c.RetriedLow, c.Note)
	return err
}
func (l PGLedger) MonthSpend(ctx context.Context, at time.Time) (float64, float64, error) {
	s, e := monthBounds(at)
	var spend, maxCall float64
	err := l.Pool.QueryRow(ctx, `SELECT COALESCE(SUM(cost), 0)::float8, COALESCE(MAX(cost), 0)::float8 FROM coach.llm_call WHERE currency = 'CNY' AND at >= $1 AND at < $2`, s, e).Scan(&spend, &maxCall)
	return math.Round(spend*1e4) / 1e4, maxCall, err
}
func (l PGLedger) CallsToday(ctx context.Context, provider string, at time.Time) (int, error) {
	s, e := dayBounds(at)
	var n int
	err := l.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM coach.llm_call WHERE provider = $1 AND at >= $2 AND at < $3`, provider, s, e).Scan(&n)
	return n, err
}
