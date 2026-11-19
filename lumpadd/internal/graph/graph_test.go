package graph

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestQueryURL(t *testing.T) {
	got, err := QueryURL("neo4j+s://98fece36.databases.neo4j.io", "neo4j")
	if err != nil {
		t.Fatal(err)
	}
	want := "https://98fece36.databases.neo4j.io/db/neo4j/query/v2"
	if got != want {
		t.Fatalf("got %q want %q", got, want)
	}
}

func TestWBGTBand(t *testing.T) {
	cases := []struct {
		v    float64
		want string
	}{
		{21.0, "GREEN"}, {23.0, "YELLOW"}, {26.5, "ORANGE"}, {29.0, "RED"}, {32.3, "BLACK"},
	}
	for _, tc := range cases {
		if got := WBGTBand(tc.v); got != tc.want {
			t.Fatalf("WBGTBand(%.1f) = %s, want %s", tc.v, got, tc.want)
		}
	}
}

func TestClientQueryAndExpandContext(t *testing.T) {
	var authSeen, pathSeen string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		authSeen = r.Header.Get("Authorization")
		pathSeen = r.URL.Path
		w.Header().Set("content-type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"data": map[string]any{
				"fields": []string{"s.label_id", "m.id"},
				"values": [][]any{{"coros-123", 42}, {"coros-456", 99}},
			},
		})
	}))
	defer srv.Close()

	c, err := New(srv.URL, "u", "p", "neo4j")
	if err != nil {
		t.Fatal(err)
	}
	// daily_brief must skip AuraDB completely
	h0, err := ExpandContext(context.Background(), c, "daily_brief", []string{"heat"}, "")
	if err != nil || len(h0.MemoryIDs) != 0 {
		t.Fatalf("daily_brief should skip graph expansion, got %+v err=%v", h0, err)
	}
	// race_plan queries AuraDB and collects linked sessions & memory IDs
	h1, err := ExpandContext(context.Background(), c, "race_plan", []string{"heat"}, "")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(authSeen, "Basic ") || pathSeen != "/db/neo4j/query/v2" {
		t.Fatalf("unexpected auth=%q path=%q", authSeen, pathSeen)
	}
	if len(h1.MemoryIDs) != 2 || h1.MemoryIDs[0] != 42 || len(h1.SessionLabels) != 2 {
		t.Fatalf("unexpected graph hits: %+v", h1)
	}
}
