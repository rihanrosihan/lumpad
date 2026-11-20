package coach

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"reflect"
	"sort"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/rihanrosihan/lumpad/lumpadd/internal/db"
)

// Golden: the Go context builder (PostgreSQL) against the Node builder (SQLite) on the same data snapshot.
//   GOLDEN_DATABASE_URL=… GOLDEN_DIR=../tools/golden/out go test ./internal/coach -run ContextsMatch -v
// Everything deterministic must be identical; the text-match picks depend on the full-text ranking and are compared by overlap.

type goldCase struct {
	Name       string
	Intent     string
	Question   string
	ActivityID any `json:"activityId"`
	Error      string
	Ctx        struct {
		Stable struct {
			Rules []Rule `json:"rules"`
		} `json:"stable"`
		Volatile struct {
			Query     json.RawMessage `json:"query"`
			Twin      json.RawMessage `json:"twin"`
			Episodes  []CtxItem       `json:"episodes"`
			Facts     []CtxItem       `json:"facts"`
			Edges     json.RawMessage `json:"correlation_edges"`
			Telemetry json.RawMessage `json:"telemetry"`
			Focus     *string         `json:"focus_label"`
			Question  string          `json:"question"`
		} `json:"volatile"`
		ItemIDs   []int64 `json:"item_ids"`
		TokensEst int     `json:"tokens_est"`
	}
}

func goldenPool(t *testing.T) (*pgxpool.Pool, []goldCase) {
	url, dir := os.Getenv("GOLDEN_DATABASE_URL"), os.Getenv("GOLDEN_DIR")
	if url == "" || dir == "" {
		t.Skip("GOLDEN_DATABASE_URL / GOLDEN_DIR not set")
	}
	b, err := os.ReadFile(dir + "/contexts.json")
	if err != nil {
		t.Skip("contexts.json missing: run node tools/export_contexts.mjs")
	}
	var cases []goldCase
	if err := json.Unmarshal(b, &cases); err != nil {
		t.Fatal(err)
	}
	pool, err := db.Connect(context.Background(), url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	return pool, cases
}

func idsWhy(items []CtxItem, why string) []int64 {
	out := []int64{}
	for _, it := range items {
		if it.Why == why {
			out = append(out, it.ID)
		}
	}
	return out
}
func overlap(a, b []int64) (inter int, union int) {
	m := map[int64]bool{}
	for _, x := range a {
		m[x] = true
	}
	n := map[int64]bool{}
	for _, x := range b {
		n[x] = true
		if m[x] {
			inter++
		}
	}
	for x := range m {
		n[x] = true
	}
	return inter, len(n)
}

func TestContextsMatchNodeOnTheSnapshot(t *testing.T) {
	pool, cases := goldenPool(t)
	r := &PGRetriever{Pool: pool}
	ctx := context.Background()
	var sumInter, sumUnion int
	for _, c := range cases {
		t.Run(c.Name, func(t *testing.T) {
			if c.Error != "" {
				t.Skip("node error: " + c.Error)
			}
			act := ""
			if s, ok := c.ActivityID.(string); ok {
				act = s
			}
			got, err := r.Retrieve(ctx, RunInput{Intent: c.Intent, Question: c.Question, Date: "2026-11-18", ActivityID: act})
			if err != nil {
				t.Fatal(err)
			}
			// deterministic parts: identical
			if !reflect.DeepEqual(rt(got.Ctx.Rules), rt(c.Ctx.Stable.Rules)) {
				t.Errorf("rules differ:\n  go %.300s\n  js %.300s", js(got.Ctx.Rules), js(c.Ctx.Stable.Rules))
			}
			for name, pair := range map[string][2]json.RawMessage{"twin": {got.Ctx.Volatile.Twin, c.Ctx.Volatile.Twin}, "query": {got.Ctx.Volatile.Query, c.Ctx.Volatile.Query}, "edges": {got.Ctx.Volatile.CorrelationEdges, c.Ctx.Volatile.Edges}, "telemetry": {got.Ctx.Volatile.Telemetry, c.Ctx.Volatile.Telemetry}} {
				var a, b any
				_ = json.Unmarshal(pair[0], &a)
				_ = json.Unmarshal(pair[1], &b)
				if !reflect.DeepEqual(a, b) {
					t.Errorf("%s differs:\n  go %.400s\n  js %.400s", name, pair[0], pair[1])
				}
			}
			if got.Ctx.Volatile.Question != c.Ctx.Volatile.Question || (got.Focus != "") != (c.Ctx.Volatile.Focus != nil) {
				t.Errorf("question/focus: %q %q / %q %v", got.Ctx.Volatile.Question, got.Focus, c.Ctx.Volatile.Question, c.Ctx.Volatile.Focus)
			}
			all := append(append([]CtxItem{}, c.Ctx.Volatile.Episodes...), c.Ctx.Volatile.Facts...)
			for _, why := range []string{"recent", "focus/similar", "sql filter", "named race"} {
				g, w := idsWhy(got.Items, why), idsWhy(all, why)
				sort.Slice(g, func(i, j int) bool { return g[i] < g[j] })
				sort.Slice(w, func(i, j int) bool { return w[i] < w[j] })
				if !reflect.DeepEqual(g, w) && !(len(g) == 0 && len(w) == 0) {
					t.Errorf("items '%s' differ: go %v js %v", why, g, w)
				}
			}
			// the items themselves (title, body, tag, date) are identical wherever both sides picked the same id
			byID := map[int64]CtxItem{}
			for _, it := range all {
				byID[it.ID] = it
			}
			for _, it := range got.Items {
				if w, ok := byID[it.ID]; ok {
					if it.Title != w.Title || it.Body != w.Body || it.Tier != w.Tier || it.Kind != w.Kind || it.Tag != w.Tag || !reflect.DeepEqual(it.Date, w.Date) {
						t.Errorf("item %d content differs:\n  go %+v\n  js %+v", it.ID, it, w)
					}
				}
			}
			// text matches: depend on the ranking function
			gt, wt := idsWhy(got.Items, "text match"), idsWhy(all, "text match")
			in, un := overlap(gt, wt)
			sumInter += in
			sumUnion += un
			t.Logf("text matches: go %d, node %d, shared %d of %d (%.0f %%) · tokens go %d node %d", len(gt), len(wt), in, un, 100*float64(in)/float64(max(un, 1)), got.TokensEst, c.Ctx.TokensEst)
		})
	}
	t.Logf("TEXT-MATCH OVERLAP over %d cases: %d shared of %d distinct (%.0f %%)", len(cases), sumInter, sumUnion, 100*float64(sumInter)/float64(max(sumUnion, 1)))
	_ = fmt.Sprint
	_ = strings.TrimSpace
}
