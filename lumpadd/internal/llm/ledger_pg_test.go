package llm

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/rihanrosihan/lumpad/lumpadd/internal/db"
)

// TEST_DATABASE_URL=postgres://… go test ./internal/llm   (an empty scratch database; migrations are applied)
func TestPGLedgerSpendAndCallCounts(t *testing.T) {
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL not set")
	}
	ctx := context.Background()
	pool, err := db.Connect(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	if _, err := db.Migrate(ctx, pool); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `TRUNCATE coach.llm_call`); err != nil {
		t.Fatal(err)
	}
	l := PGLedger{pool}
	at := func(s string) time.Time { x, _ := time.Parse(time.RFC3339, s); return x }
	c1, c2, c3 := 0.1234, 2.5, 0.75
	rows := []Call{
		{At: at("2026-11-30T20:00:00Z"), Provider: "deepseek", Intent: "question", Model: "m", OK: true, CostCNY: &c1, Tokens: TokenUsage{Prompt: 10, Completion: 5, Reasoning: 3, CachedPrompt: 4}, RunID: 9},
		{At: at("2026-12-01T03:00:00Z"), Provider: "deepseek", Intent: "question", OK: true, CostCNY: &c2},
		{At: at("2026-12-10T03:00:00Z"), Provider: "claude", Intent: "weekly_review", OK: false, Error: "rejected", Note: "answer rejected", CostCNY: &c3},
		{At: at("2026-12-10T04:00:00Z"), Provider: "claude", Intent: "question", OK: true}, // unknown cost
	}
	for _, c := range rows {
		if err := l.Record(ctx, c); err != nil {
			t.Fatal(err)
		}
	}
	// 30 Nov 20:00 UTC is 1 Dec 03:00 in WIB: the first call belongs to December
	spend, maxCall, err := l.MonthSpend(ctx, at("2026-12-15T00:00:00Z"))
	if err != nil || spend != 3.3734 || maxCall != 2.5 {
		t.Errorf("december spend %v max %v err %v (want 3.3734 and 2.5)", spend, maxCall, err)
	}
	if spend, _, _ := l.MonthSpend(ctx, at("2026-11-15T00:00:00Z")); spend != 0 {
		t.Errorf("november: %v", spend)
	}
	if n, _ := l.CallsToday(ctx, "claude", at("2026-12-10T05:00:00Z")); n != 2 {
		t.Errorf("claude calls on 10 Dec WIB: %d", n)
	}
	if n, _ := l.CallsToday(ctx, "claude", at("2026-12-11T05:00:00Z")); n != 0 {
		t.Errorf("claude calls on 11 Dec WIB: %d", n)
	}
	var tok, reasoning, cached int
	var run *int64
	if err := pool.QueryRow(ctx, `SELECT tokens_in, tokens_reasoning, tokens_cached, run_id FROM coach.llm_call WHERE cost = 0.1234`).Scan(&tok, &reasoning, &cached, &run); err != nil || tok != 10 || reasoning != 3 || cached != 4 || run == nil || *run != 9 {
		t.Errorf("row fields: %v %v %v %v %v", tok, reasoning, cached, run, err)
	}
}
