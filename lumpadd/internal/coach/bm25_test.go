package coach

import (
	"encoding/json"
	"math"
	"os"
	"reflect"
	"testing"
)

// The Go BM25 must reproduce SQLite FTS5 bm25(memory_fts, 3.0, 1.0): same hits, same order, same scores (vectors from tools/gen_bm25_vectors.mjs).
func TestBM25MatchesFTS5(t *testing.T) {
	b, err := os.ReadFile("testdata/bm25_vectors.json")
	if err != nil {
		t.Fatal(err)
	}
	var v struct {
		Docs []struct {
			ID        int64
			Tier      string
			Kind      string
			Title     string
			Body      string
			Status    string
			ValidFrom *string `json:"valid_from"`
			Evidence  string  `json:"evidence_tag"`
			Source    string
		}
		Cases []struct {
			Q        string
			Tiers    []string
			Statuses []string
			Limit    int
			Since    *string
			IDs      []int64
			Scores   []float64
		}
	}
	if err := json.Unmarshal(b, &v); err != nil {
		t.Fatal(err)
	}
	items := make([]Memory, len(v.Docs))
	for i, d := range v.Docs {
		items[i] = Memory{ID: d.ID, Tier: d.Tier, Kind: d.Kind, Title: d.Title, Body: d.Body, Status: d.Status, Evidence: d.Evidence, Source: d.Source}
		if d.ValidFrom != nil {
			items[i].ValidFrom = *d.ValidFrom
		}
	}
	ix := NewBM25Index(items)
	withHits, ties := 0, 0
	for _, c := range v.Cases {
		f := BM25Filter{Tiers: c.Tiers, Statuses: c.Statuses, Limit: c.Limit}
		if c.Since != nil {
			f.Since = *c.Since
		}
		got := ix.Search(c.Q, f)
		ids := []int64{}
		for _, h := range got {
			ids = append(ids, h.Mem.ID)
		}
		want := c.IDs
		if want == nil {
			want = []int64{}
		}
		if !reflect.DeepEqual(ids, want) {
			t.Errorf("%q %v/%v limit %d: ids\n  go %v\n  js %v", c.Q, c.Tiers, c.Statuses, c.Limit, ids, want)
			continue
		}
		for i, h := range got {
			if math.Abs(h.Score-(-c.Scores[i])) > 1e-9*math.Max(1, math.Abs(c.Scores[i])) { // FTS5 returns the negative
				t.Errorf("%q hit %d (id %d): score go %v js %v", c.Q, i, h.Mem.ID, h.Score, -c.Scores[i])
			}
			if i > 0 && math.Abs(got[i].Score-got[i-1].Score) < 1e-12 {
				ties++
			}
		}
		if len(want) > 0 {
			withHits++
		}
	}
	if withHits < 80 {
		t.Fatalf("vectors too weak: %d searches with hits", withHits)
	}
	t.Logf("%d searches with hits, %d tied neighbours (order among ties follows id, as FTS5 does)", withHits, ties)
}

func TestFTS5TokenizerFoldsLikeUnicode61(t *testing.T) {
	for in, want := range map[string][]string{
		"Café résumé":        {"cafe", "resume"},
		"EF-0.789 run_share": {"ef", "0", "789", "run", "share"},
		"8:00/km pa:hr":      {"8", "00", "km", "pa", "hr"},
		"naïve ångström":     {"naive", "angstrom"},
	} {
		if got := fts5Tokens(in); !reflect.DeepEqual(got, want) {
			t.Errorf("%q → %v want %v", in, got, want)
		}
	}
}
