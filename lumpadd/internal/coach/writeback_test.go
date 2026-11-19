package coach

import (
	"context"
	"encoding/json"
	"os"
	"reflect"
	"strings"
	"testing"
	"time"
)

type wbVec struct {
	Name string
	Seed []struct {
		ID       int64
		Tier     string
		Kind     string
		Title    string
		Body     string
		Evidence string `json:"evidence_tag"`
		Status   string
		N        int
		Locked   bool
		Source   string
		By       string `json:"created_by"`
	}
	ItemIDs  []int64
	Corpus   string
	Provider string
	Parsed   map[string]any
	Result   WBResult
	Rows     []struct {
		ID         int64
		Tier, Kind string
		Title      string
		Body       string
		Payload    *string
		Evidence   string `json:"evidence_tag"`
		N          int
		Confidence *float64
		Status     string
		Locked     int
		Source     *string
		By         string `json:"created_by"`
		Hash       string
	}
	Audits []struct {
		RunID    int64 `json:"run_id"`
		Action   string
		MemoryID *int64 `json:"memory_id"`
		Detail   map[string]any
	}
}

// The Go write-back must make the same decisions, store the same rows (including the dedupe hash and the payload text) and write the same audit trail as Node.
func TestWritebackMatchesNode(t *testing.T) {
	b, err := os.ReadFile("testdata/writeback_vectors.json")
	if err != nil {
		t.Fatal(err)
	}
	var vs []wbVec
	if err := json.Unmarshal(b, &vs); err != nil {
		t.Fatal(err)
	}
	if len(vs) < 18 {
		t.Fatalf("only %d scenarios", len(vs))
	}
	ctx := context.Background()
	for _, v := range vs {
		t.Run(v.Name, func(t *testing.T) {
			st := &MemMemory{Now: func() time.Time { return time.Unix(0, 0) }}
			for _, s := range v.Seed {
				st.Items = append(st.Items, Memory{ID: s.ID, Tier: s.Tier, Kind: s.Kind, Title: s.Title, Body: s.Body, Evidence: s.Evidence, Status: s.Status, N: max(1, s.N), Locked: s.Locked, Source: s.Source, CreatedBy: s.By,
					Hash: MemoryHash(s.Tier, s.Kind, s.Title, s.Body)})
			}
			got, err := ApplyWriteback(ctx, st, v.Parsed, 17, v.ItemIDs, v.Corpus, v.Provider)
			if err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(rt(got), rt(v.Result)) {
				t.Errorf("result:\n  go %s\n  js %s", js(got), js(v.Result))
			}
			if len(st.Items) != len(v.Rows) {
				t.Fatalf("memory rows: go %d, node %d", len(st.Items), len(v.Rows))
			}
			for i, w := range v.Rows {
				g := st.Items[i]
				gp := any(nil)
				if g.Payload != "" {
					gp = g.Payload
				}
				var wp any
				if w.Payload != nil {
					wp = *w.Payload
				}
				var gsrc any
				if g.Source != "" {
					gsrc = g.Source
				}
				var wsrc any
				if w.Source != nil {
					wsrc = *w.Source
				}
				if g.ID != w.ID || g.Tier != w.Tier || g.Kind != w.Kind || g.Title != w.Title || g.Body != w.Body || !reflect.DeepEqual(gp, wp) || g.Evidence != w.Evidence || g.N != w.N ||
					!floatEq2(g.Confidence, w.Confidence) || g.Status != w.Status || g.Locked != (w.Locked == 1) || !reflect.DeepEqual(gsrc, wsrc) || g.CreatedBy != w.By || g.Hash != w.Hash {
					t.Errorf("row %d differs:\n  go %+v\n  js %+v", i, g, w)
				}
			}
			var gotAudit []any
			for _, a := range st.Audits {
				if a.Action == "add" { // Node's addMemory audits every creation, including the seed (cleared before the run); the Go store does the same
				}
				gotAudit = append(gotAudit, map[string]any{"run_id": a.RunID, "action": a.Action, "memory_id": a.MemoryID, "detail": a.Detail})
			}
			var wantAudit []any
			for _, a := range v.Audits {
				wantAudit = append(wantAudit, map[string]any{"run_id": a.RunID, "action": a.Action, "memory_id": a.MemoryID, "detail": a.Detail})
			}
			if !reflect.DeepEqual(rt(gotAudit), rt(wantAudit)) {
				t.Errorf("audit trail:\n  go %s\n  js %s", js(gotAudit), js(wantAudit))
			}
		})
	}
}

func floatEq2(a, b *float64) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return *a == *b
}

func TestWritebackToleratesBadShapes(t *testing.T) {
	st := &MemMemory{}
	out, err := ApplyWriteback(context.Background(), st, map[string]any{"memory_writes": []any{map[string]any{"tier": "semantic", "title": "t", "body": "b", "cites": 2.0}, "not an object", map[string]any{}}}, 1, []int64{2}, "", "x")
	if err != nil || len(out.Stored) != 0 || len(out.Rejected) != 3 || len(st.Items) != 0 {
		t.Errorf("bad shapes must be rejected, never crash or store: %+v %v", out, err)
	}
	if !strings.Contains(js(out.Rejected[0].Why), "no citation") {
		t.Errorf("why: %v", out.Rejected[0].Why)
	}
}
