package coach

import (
	"encoding/json"
	"math"
	"os"
	"reflect"
	"regexp"
	"strings"
	"testing"
)

type retVec struct {
	Today     string
	Gear      []Gear
	Decompose []struct {
		Q   string
		Out struct {
			Filters    map[string]any `json:"filters"`
			Topics     []string       `json:"topics"`
			HasFilters bool           `json:"has_filters"`
		}
		SQL struct {
			Where  string
			Params []any
		} `json:"sql"`
	}
	DecomposeToday []struct {
		Today, Q string
		Out      struct {
			Filters map[string]any `json:"filters"`
			Topics  []string       `json:"topics"`
		}
	}
	RRFCases []struct {
		Lists [][]int64
		Out   []struct {
			ID    int64
			Score float64
		}
	} `json:"rrfCases"`
	MMRCases []struct {
		Items []struct {
			ID       int64
			Title    string
			Body     string
			Fused    *float64
			Evidence *string `json:"evidence_tag"`
		}
		K      int
		Out    []int64
		Sorted []int64
	} `json:"mmrCases"`
	Redact []struct{ T, Out string }
	FP     []struct {
		Rows []FeatureRow
		Mean map[string]float64
		SD   map[string]float64
		Z    [][]float64
		Cos  float64
	}
	Compact []struct {
		In, Out map[string]any
	}
	EST []struct {
		S   string
		Out int
	}
}

func loadRet(t *testing.T) retVec {
	b, err := os.ReadFile("testdata/retrieval_vectors.json")
	if err != nil {
		t.Fatal(err)
	}
	var v retVec
	if err := json.Unmarshal(b, &v); err != nil {
		t.Fatal(err)
	}
	return v
}

func filtersMap(d Decomposed) map[string]any {
	b, _ := json.Marshal(d.Filters)
	var m map[string]any
	_ = json.Unmarshal(b, &m)
	return m
}

var reParam = regexp.MustCompile(`\$\d+(::date)?`)

func TestDecomposeMatchesNode(t *testing.T) {
	v := loadRet(t)
	with, topics := 0, 0
	for _, c := range v.Decompose {
		d := Decompose(c.Q, v.Today, v.Gear)
		if got, want := filtersMap(d), c.Out.Filters; !reflect.DeepEqual(rt(got), rt(want)) {
			t.Errorf("%q filters:\n  go %s\n  js %s", c.Q, js(got), js(want))
		}
		if !reflect.DeepEqual(nilS(d.Topics), nilS(c.Out.Topics)) || d.HasFilters != c.Out.HasFilters {
			t.Errorf("%q topics go %v js %v, has_filters %v/%v", c.Q, d.Topics, c.Out.Topics, d.HasFilters, c.Out.HasFilters)
		}
		if d.HasFilters {
			where, params := d.SQL()
			if got := reParam.ReplaceAllString(where, "?"); got != c.SQL.Where {
				t.Errorf("%q where:\n  go %s\n  js %s", c.Q, got, c.SQL.Where)
			}
			if !reflect.DeepEqual(rt(params), rt(nilA(c.SQL.Params))) {
				t.Errorf("%q params:\n  go %s\n  js %s", c.Q, js(params), js(c.SQL.Params))
			}
			with++
		}
		if len(c.Out.Topics) > 0 {
			topics++
		}
	}
	if with < 100 || topics < 60 {
		t.Fatalf("vectors too weak: %d with filters, %d with topics", with, topics)
	}
	for _, c := range v.DecomposeToday {
		d := Decompose(c.Q, c.Today, v.Gear)
		if !reflect.DeepEqual(rt(filtersMap(d)), rt(c.Out.Filters)) {
			t.Errorf("today=%s %q:\n  go %s\n  js %s", c.Today, c.Q, js(filtersMap(d)), js(c.Out.Filters))
		}
	}
}
func nilS(s []string) []string {
	if s == nil {
		return []string{}
	}
	return s
}
func nilA(s []any) []any {
	if s == nil {
		return []any{}
	}
	return s
}

func TestFilterKeyOrderMatchesNode(t *testing.T) {
	// the model reads the filters in the order the Node app wrote them
	d := Decompose("long run above 150 bpm on a treadmill in HOKA Clifton 10 on 2026-10-05", "2026-11-18", []Gear{{"29435791", "HOKA Clifton 10"}})
	b, _ := json.Marshal(d.Filters)
	if !strings.HasPrefix(string(b), `{"from":"2026-10-05","to":"2026-10-05","dist_km":[16,50],"indoor":true,"kinds":["long"],"hr_min":150,"shoes":`) {
		t.Errorf("order: %s", b)
	}
}

func TestRankHelpersMatchNode(t *testing.T) {
	v := loadRet(t)
	for i, c := range v.RRFCases {
		got := RRF(c.Lists, 60)
		if len(got) != len(c.Out) {
			t.Fatalf("rrf %d: %d vs %d", i, len(got), len(c.Out))
		}
		for j := range got {
			if got[j].ID != c.Out[j].ID || math.Abs(got[j].Score-c.Out[j].Score) > 1e-12 {
				t.Errorf("rrf %d[%d]: go %+v js %+v", i, j, got[j], c.Out[j])
			}
		}
	}
	for i, c := range v.MMRCases {
		items := make([]Candidate, len(c.Items))
		for j, it := range c.Items {
			items[j] = Candidate{ID: it.ID, Title: it.Title, Body: it.Body}
			if it.Fused != nil {
				items[j].Fused = *it.Fused
			}
			if it.Evidence != nil {
				items[j].Evidence = *it.Evidence
			}
		}
		out := MMR(items, c.K, 0.7)
		ids := []int64{}
		for _, x := range out {
			ids = append(ids, x.ID)
		}
		if !reflect.DeepEqual(ids, nilI(c.Out)) {
			t.Errorf("mmr %d: go %v js %v", i, ids, c.Out)
		}
		SortByEvidence(out)
		ids = ids[:0]
		for _, x := range out {
			ids = append(ids, x.ID)
		}
		if !reflect.DeepEqual(ids, nilI(c.Sorted)) {
			t.Errorf("sort by evidence %d: go %v js %v", i, ids, c.Sorted)
		}
	}
}
func nilI(s []int64) []int64 {
	if s == nil {
		return []int64{}
	}
	return s
}

func TestRedactMatchesNode(t *testing.T) {
	for _, c := range loadRet(t).Redact {
		if got := Redact(c.T); got != c.Out {
			t.Errorf("%q:\n  go %q\n  js %q", c.T, got, c.Out)
		}
	}
}

func TestFingerprintMatchesNode(t *testing.T) {
	for i, c := range loadRet(t).FP {
		z := NewZMatrix(c.Rows)
		for _, k := range Features {
			if math.Abs(z.Mean[k]-c.Mean[k]) > 1e-9 || math.Abs(z.SD[k]-c.SD[k]) > 1e-9 {
				t.Errorf("fp %d %s: mean %v/%v sd %v/%v", i, k, z.Mean[k], c.Mean[k], z.SD[k], c.SD[k])
			}
		}
		for r, row := range c.Rows {
			got := z.Z(row)
			for j := range got {
				if math.Abs(got[j]-c.Z[r][j]) > 1e-9 {
					t.Errorf("fp %d row %d feature %d: %v vs %v", i, r, j, got[j], c.Z[r][j])
				}
			}
		}
		if len(c.Rows) > 1 {
			if got := Cosine(z.Z(c.Rows[0]), z.Z(c.Rows[1])); math.Abs(got-c.Cos) > 1e-9 {
				t.Errorf("fp %d cosine %v vs %v", i, got, c.Cos)
			}
		}
	}
}

func TestCompactTwinAndTokenEstimateMatchNode(t *testing.T) {
	v := loadRet(t)
	for i, c := range v.Compact {
		if got := CompactTwin(c.In); !reflect.DeepEqual(rt(got), rt(c.Out)) {
			t.Errorf("compact %d:\n  go %s\n  js %s", i, js(got), js(c.Out))
		}
	}
	for _, c := range v.EST {
		if got := EstTokens(c.S); got != c.Out {
			t.Errorf("EST(%q) = %d want %d", c.S, got, c.Out)
		}
	}
}
