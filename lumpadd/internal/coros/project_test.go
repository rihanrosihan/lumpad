package coros

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"reflect"
	"sort"
	"testing"

	"github.com/rihanrosihan/lumpad/lumpadd/internal/db"
)

// Golden: Go archive projection + ingest validation vs Node's on the same snapshot (load it into Postgres with `lumpadd load` first).
//
//	GOLDEN_DATABASE_URL=… GOLDEN_DIR=../tools/golden/out go test ./internal/coros
func TestProjectionGolden(t *testing.T) {
	url, dir := os.Getenv("GOLDEN_DATABASE_URL"), os.Getenv("GOLDEN_DIR")
	if url == "" || dir == "" {
		t.Skip("GOLDEN_DATABASE_URL / GOLDEN_DIR not set")
	}
	b, err := os.ReadFile(dir + "/projection.json")
	if err != nil {
		t.Skip("projection.json missing: run node tools/export_projection.mjs")
	}
	var want struct {
		Projection struct{ Health, Fitness, Acts []any }
		Ops        []any
	}
	if err := json.Unmarshal(b, &want); err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	pool, err := db.Connect(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	arch, err := LoadArchive(ctx, pool, "2025-01-01")
	if err != nil {
		t.Fatal(err)
	}
	p := BuildProjection(arch, "2025-01-01")
	// activities: compare keyed by source_id (SQLite left same-day order to rowid)
	byID := func(list []any) map[string]any {
		m := map[string]any{}
		for _, x := range list {
			r := x.(map[string]any)
			m[fmt.Sprint(r["source_id"])] = r
		}
		return m
	}
	check := func(name string, got, want any) {
		g := norm(got)
		if !reflect.DeepEqual(g, want) {
			gj, _ := json.Marshal(g)
			wj, _ := json.Marshal(want)
			t.Errorf("%s differs:\n  go %.600s\n  js %.600s", name, gj, wj)
		}
	}
	check("health", p.Health, want.Projection.Health)
	check("fitness", p.Fitness, want.Projection.Fitness)
	gotActs := byID(norm(p.Activities).([]any))
	wantActs := byID(want.Projection.Acts)
	if len(gotActs) != len(wantActs) {
		t.Errorf("activities: go %d, js %d", len(gotActs), len(wantActs))
	}
	n := 0
	for id, w := range wantActs {
		if !reflect.DeepEqual(gotActs[id], w) {
			if n < 3 {
				gj, _ := json.Marshal(gotActs[id])
				wj, _ := json.Marshal(w)
				t.Errorf("activity %s:\n  go %.600s\n  js %.600s", id, gj, wj)
			}
			n++
		}
	}
	if n > 0 {
		t.Errorf("%d of %d activities differ", n, len(wantActs))
	}
	// ingest ops, batched as projectAll batches them; activities ordered by id within a batch for the same reason
	var batches []Payload
	for i := 0; i < len(p.Health); i += 700 {
		batches = append(batches, Payload{Health: p.Health[i:min(i+700, len(p.Health))]})
	}
	for i := 0; i < len(p.Fitness); i += 300 {
		batches = append(batches, Payload{Fitness: p.Fitness[i:min(i+300, len(p.Fitness))]})
	}
	acts := byOrder(p.Activities, want.Projection.Acts)
	for i := 0; i < len(acts); i += 300 {
		batches = append(batches, Payload{Activities: acts[i:min(i+300, len(acts))]})
	}
	if len(batches) != len(want.Ops) {
		t.Fatalf("batches: go %d js %d", len(batches), len(want.Ops))
	}
	for i, bt := range batches {
		r, err := IngestOps(bt, "NOW")
		if err != nil {
			t.Fatal(err)
		}
		check(fmt.Sprintf("ops batch %d", i), r, want.Ops[i])
	}
}

// byOrder puts the Go activities in the order Node produced them (same-date order in SQLite follows rowid)
func byOrder(got []Row, want []any) []Row {
	pos := map[string]int{}
	for i, x := range want {
		pos[fmt.Sprint(x.(map[string]any)["source_id"])] = i
	}
	out := append([]Row(nil), got...)
	sort.SliceStable(out, func(a, b int) bool {
		return pos[fmt.Sprint(out[a]["source_id"])] < pos[fmt.Sprint(out[b]["source_id"])]
	})
	return out
}

func TestIngestOpsMatchJS(t *testing.T) {
	b, err := os.ReadFile("testdata/ingest_vectors.json")
	if err != nil {
		t.Fatal(err)
	}
	var cases []struct {
		Payload map[string][]map[string]any
		Out     any
	}
	if err := json.Unmarshal(b, &cases); err != nil {
		t.Fatal(err)
	}
	conv := func(list []map[string]any) []Row {
		out := make([]Row, len(list))
		for i, m := range list {
			r := Row{}
			for k, v := range m {
				switch x := v.(type) {
				case nil:
					r[k] = jsonNull{}
				case []any:
					laps := make([]Row, len(x))
					for j, l := range x {
						laps[j] = Row(l.(map[string]any))
					}
					r[k] = laps
				default:
					r[k] = v
				}
			}
			out[i] = r
		}
		return out
	}
	for i, c := range cases {
		got, err := IngestOps(Payload{Health: conv(c.Payload["health"]), Activities: conv(c.Payload["activities"]), Gear: conv(c.Payload["gear"]), Fitness: conv(c.Payload["fitness"])}, "NOW")
		if err != nil {
			t.Fatal(err)
		}
		if g := norm(got); !reflect.DeepEqual(g, c.Out) {
			gj, _ := json.Marshal(g)
			wj, _ := json.Marshal(c.Out)
			t.Errorf("case %d:\n  go %s\n  js %s", i, gj, wj)
		}
	}
}
