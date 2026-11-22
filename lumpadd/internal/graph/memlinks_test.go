package graph

import (
	"encoding/json"
	"fmt"
	"os"
	"sort"
	"strings"
	"testing"
)

func TestSimilarMemoriesLinksRelatedNotchunkNeighbours(t *testing.T) {
	docs := []MemDoc{
		{1, "kbA", true, "Heat acclimation: WBGT above 27 raises heart rate and slows pace on long runs; drink early and use gels"},
		{2, "kbB", true, "Long runs in hot humid weather push heart rate up late; WBGT planning and gel intake protect pacing"},
		{3, "kbA", true, "Heat acclimation: WBGT above 27 raises heart rate and slows pace on long runs; drink early and use gels"},
		{4, "", true, "Tibia pain after leg day squats: reduce plyometric volume and add calf raises"},
		{5, "", true, "Leg day squats loaded the tibia; calf raises and lower plyometric volume helped the pain"},
		{6, "", true, "Sleep heart rate above 67 means no hard running tomorrow"},
		{7, "", true, "Race registration opens in March for the marathon"},
		{8, "", true, "Weather forecast cloud cover and rain probability for the weekend"},
	}
	pairs := SimilarMemories(docs, 3, 0.15)
	has := func(a, b int64) bool {
		for _, p := range pairs {
			if p.A == a && p.B == b {
				return true
			}
		}
		return false
	}
	if !has(1, 2) || !has(4, 5) {
		t.Fatalf("expected heat pair (1,2) and tibia pair (4,5), got %+v", pairs)
	}
	if has(1, 3) {
		t.Errorf("same document group must never be linked: %+v", pairs)
	}
	if has(6, 7) || has(1, 6) || has(7, 8) {
		t.Errorf("unrelated memories linked: %+v", pairs)
	}
	for _, p := range pairs {
		if p.A >= p.B || p.Sim < 0.15 || p.Sim > 1.0001 || len(p.Via) == 0 {
			t.Errorf("bad pair %+v", p)
		}
	}
	again := SimilarMemories(docs, 3, 0.15)
	if fmt.Sprint(pairs) != fmt.Sprint(again) {
		t.Error("not deterministic")
	}
}

func TestClaimsOf(t *testing.T) {
	c := ClaimsOf("Ground contact time rises late in long runs. Cadence does not drop in the heat.")
	got := map[string]int{}
	for _, x := range c {
		got[x.Metric] = x.Dir
	}
	if got["gct"] != 1 {
		t.Errorf("gct should be up: %v", got)
	}
	if _, ok := got["cadence"]; ok {
		t.Errorf("negated claim must be discarded: %v", got)
	}
	id := ClaimsOf("Waktu kontak tanah naik setelah jam kedua")
	if len(id) == 0 || id[0].Metric != "gct" || id[0].Dir != 1 {
		t.Errorf("Indonesian claim: %+v", id)
	}
}

func TestStructuredConflicts(t *testing.T) {
	mems := []ConflictMem{
		{1, "", true, "Ground contact time rises when long runs are done in the heat on hilly courses."},
		{2, "", true, "In the heat on hilly courses the ground contact time drops during long runs."},
		{3, "", true, "Ground contact time rises in the heat on hilly long runs."},          // same direction as 1: no conflict
		{4, "kb", false, "Cadence drops when tired in the heat."},                           // KB vs curated on a DIFFERENT metric: no conflict
		{5, "", true, "Heart rate rises with sleep loss before hard quality sessions."},     // different context
		{6, "kb2", false, "Heart rate drops with sleep loss before hard quality sessions."}, // curated vs KB, same metric, same context: conflict with 5
		{7, "kb3", false, "Ground contact time rises in the heat on long runs."},            // KB vs KB with 8: never compared
		{8, "kb3", false, "Ground contact time drops in the heat on long runs."},
	}
	cs := StructuredConflicts(mems, 100)
	has := func(a, b int64, m string) bool {
		for _, c := range cs {
			if c.A == a && c.B == b && c.Metric == m && c.ADir == -c.BDir {
				return true
			}
		}
		return false
	}
	if !has(1, 2, "gct") || !has(5, 6, "heart_rate") {
		t.Fatalf("expected conflicts (1,2,gct) and (5,6,heart_rate): %+v", cs)
	}
	for _, c := range cs {
		if (c.A == 1 && c.B == 3) || (c.A == 7 && c.B == 8) || c.A == 4 || c.B == 4 {
			t.Errorf("false conflict %+v", c)
		}
	}
}

// Preview on exported real memories: PREVIEW_JSON=/path/mem.json go test ./internal/graph -run TestPreviewReal -v
func TestPreviewReal(t *testing.T) {
	path := os.Getenv("PREVIEW_JSON")
	if path == "" {
		t.Skip("set PREVIEW_JSON to preview on real data")
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var in []struct {
		ID                       int64
		Source, Ref, Title, Body string
	}
	if err := json.Unmarshal(raw, &in); err != nil {
		t.Fatal(err)
	}
	var docs []MemDoc
	var cm []ConflictMem
	title := map[int64]string{}
	for _, m := range in {
		g := ""
		if m.Source == "kb" && strings.Contains(m.Ref, "#") {
			g = m.Ref[:strings.Index(m.Ref, "#")]
		}
		docs = append(docs, MemDoc{m.ID, g, m.Source == "coach" || m.Source == "rules", m.Title + " " + m.Body})
		cm = append(cm, ConflictMem{m.ID, g, m.Source == "coach" || m.Source == "rules", m.Title + ". " + m.Body})
		title[m.ID] = m.Title
	}
	var dist []float64
	for _, p := range SimilarMemories(docs, 3, 0.05) {
		dist = append(dist, p.Sim)
	}
	sort.Float64s(dist)
	q := func(f float64) float64 { return dist[int(f*float64(len(dist)-1))] }
	fmt.Printf("memories %d | candidate pairs (top-3, sim>=0.05): %d | quantiles p10 %.2f p50 %.2f p90 %.2f max %.2f\n", len(docs), len(dist), q(.1), q(.5), q(.9), dist[len(dist)-1])
	for _, th := range []float64{0.15, 0.2, 0.25, 0.3, 0.4, 0.5} {
		n := 0
		for _, d := range dist {
			if d >= th {
				n++
			}
		}
		fmt.Printf("  threshold %.2f -> %d links\n", th, n)
	}
	th := 0.2
	if v := os.Getenv("PREVIEW_TH"); v != "" {
		fmt.Sscanf(v, "%f", &th)
	}
	ps := SimilarMemories(docs, 3, th)
	sort.SliceStable(ps, func(a, b int) bool { return ps[a].Sim > ps[b].Sim })
	step := max2(1, len(ps)/14)
	for i := 0; i < len(ps); i += step {
		p := ps[i]
		fmt.Printf("  %.2f  [%d] %.48s  ~  [%d] %.48s   via %v\n", p.Sim, p.A, title[p.A], p.B, title[p.B], p.Via)
	}
	cs := StructuredConflicts(cm, 200)
	fmt.Printf("structured conflicts: %d\n", len(cs))
	for _, c := range cs {
		fmt.Printf("  %s %+d/%+d  [%d] %.70s   vs   [%d] %.70s\n", c.Metric, c.ADir, c.BDir, c.A, title[c.A], c.B, title[c.B])
	}
}
