package coach

import (
	"strings"
	"testing"
)

func TestDecomposeENAndID(t *testing.T) {
	gear := []Gear{
		{ID: "g1", Name: "Adidas Adizero SL2"},
		{ID: "g2", Name: "Saucony Endorphin Speed 4"},
		{ID: "g3", Name: "Hoka Clifton 10"},
	}
	dq := Decompose("Why did my GCT fade in last 14 days on Adizero above 160 bpm?", "2026-11-19", gear)
	if !dq.HasFilters {
		t.Fatal("expected filters")
	}
	if dq.Filters.From != "2026-11-05" || dq.Filters.To != "2026-11-19" {
		t.Fatalf("bad dates: %+v", dq.Filters)
	}
	if dq.Filters.HRMin == nil || *dq.Filters.HRMin != 160 {
		t.Fatalf("expected hr_min=160, got %+v", dq.Filters.HRMin)
	}
	if len(dq.Filters.Shoes) != 1 || dq.Filters.Shoes[0].ID != "g1" {
		t.Fatalf("expected Adizero shoe match, got %+v", dq.Filters.Shoes)
	}
	where, params := FilterSQL(dq.Filters)
	if !strings.Contains(where, "s.run_hr >= $") || len(params) < 4 {
		t.Fatalf("unexpected FilterSQL: %q params=%v", where, params)
	}

	// Indonesian + named race
	dqID := Decompose("Kenapa Borobudur kemarin panas dan drift tinggi?", "2026-11-19", gear)
	if dqID.Filters.Race != "Borobudur FM 2026" || dqID.Filters.RaceDate != "2026-11-15" {
		t.Fatalf("expected Borobudur race, got %+v", dqID.Filters)
	}
	if dqID.Filters.From != "2026-11-18" {
		t.Fatalf("kemarin should set 2026-11-18, got %s", dqID.Filters.From)
	}
}

func TestRedact(t *testing.T) {
	in := "Rihan Rosihan works at Pizza Hut Indonesia, email rihan@example.com, phone +6281234567890, https://secret.example/x"
	out := Redact(in)
	for _, bad := range []string{"Rihan", "Rosihan", "Pizza Hut", "rihan@example.com", "081234567890", "https://"} {
		if strings.Contains(out, bad) {
			t.Fatalf("redact leaked %q in %q", bad, out)
		}
	}
}

func TestRRFAndMMR(t *testing.T) {
	fused := RRF([][]int64{{10, 20, 30}, {20, 10, 40}}, 60)
	if len(fused) != 4 || (fused[0].ID != 10 && fused[0].ID != 20) {
		t.Fatalf("unexpected RRF: %+v", fused)
	}
	items := []RetrievedItem{
		{ID: 1, Title: "Borobudur heat durability fade", Body: "heat durability fade marathon pacing", Tag: "MEASURED", fused: 0.03},
		{ID: 2, Title: "Borobudur heat durability fade", Body: "heat durability fade marathon pacing", Tag: "KB", fused: 0.029},
		{ID: 3, Title: "Sleep debt HRV corridor", Body: "overnight sleep stages recovery metric", Tag: "VALIDATED", fused: 0.025},
	}
	picked := MMR(items, 2, 0.7)
	if len(picked) != 2 || picked[0].ID != 1 || picked[1].ID != 3 {
		t.Fatalf("MMR should diversify away from duplicate item 2, got %+v", picked)
	}
	sorted := SortByEvidence(picked)
	if sorted[0].Tag != "VALIDATED" {
		t.Fatalf("expected VALIDATED first, got %s", sorted[0].Tag)
	}
}

func TestNearestSessions(t *testing.T) {
	f := func(v float64) *float64 { return &v }
	rows := []SessionFeat{
		{LabelID: "target", Date: "2026-11-15", DistanceM: 36000, Features: map[string]*float64{"log_dist": f(10.5), "run_hr": f(165), "ef": f(1.1)}},
		{LabelID: "close", Date: "2026-06-14", DistanceM: 42000, Features: map[string]*float64{"log_dist": f(10.6), "run_hr": f(164), "ef": f(1.12)}},
		{LabelID: "far", Date: "2026-05-01", DistanceM: 5000, Features: map[string]*float64{"log_dist": f(8.5), "run_hr": f(132), "ef": f(1.5)}},
		{LabelID: "future", Date: "2026-11-20", DistanceM: 40000, Features: map[string]*float64{"log_dist": f(10.5), "run_hr": f(165), "ef": f(1.1)}},
	}
	got := NearestSessions(rows, "target", 2)
	if len(got) != 2 || got[0] != "close" {
		t.Fatalf("expected close first (excluding future), got %v", got)
	}
}
