package coach

import (
	"math"
	"regexp"
	"sort"
	"strings"
	"unicode/utf16"
)

// Ranking helpers of the context builder: reciprocal rank fusion, maximal marginal relevance, evidence ordering, privacy redaction, the
// fingerprint maths for "runs like this one", the twin compaction and the token estimate. Ports of server/intel/{memory,context,card}.js.

type Scored struct {
	ID    int64
	Score float64
}

// RRF: reciprocal rank fusion over ranked id lists (k = 60), best first; ties keep first-seen order (JS Map insertion + stable sort).
func RRF(lists [][]int64, k float64) []Scored {
	score, order := map[int64]float64{}, []int64{}
	for _, l := range lists {
		for i, id := range l {
			if _, ok := score[id]; !ok {
				order = append(order, id)
			}
			score[id] += 1 / (k + float64(i) + 1)
		}
	}
	out := make([]Scored, len(order))
	for i, id := range order {
		out[i] = Scored{id, score[id]}
	}
	sort.SliceStable(out, func(a, b int) bool { return out[a].Score > out[b].Score })
	return out
}

var EvidenceOrder = []string{"VALIDATED", "MEASURED", "CALCULATED", "CLINICIAN", "KB", "REPORTED", "LITERATURE", "HYPOTHESIS"}

func EvidenceRank(tag string) int {
	for i, t := range EvidenceOrder {
		if t == tag {
			return i
		}
	}
	return len(EvidenceOrder)
}

type Candidate struct {
	ID       int64
	Title    string
	Body     string
	Evidence string
	Fused    float64
}

var reMMRTok = regexp.MustCompile(`[\p{L}\p{N}]{4,}`)

func mmrTokens(c Candidate) map[string]bool {
	out := map[string]bool{}
	for _, m := range reMMRTok.FindAllString(jsLower(c.Title+" "+c.Body), -1) {
		out[m] = true
	}
	return out
}

// MMR: maximal marginal relevance over text overlap (no vectors): avoids returning five near-identical cards.
func MMR(items []Candidate, k int, lambda float64) []Candidate {
	T := make([]map[string]bool, len(items))
	for i, c := range items {
		T[i] = mmrTokens(c)
	}
	jac := func(a, b map[string]bool) float64 {
		n := 0
		for x := range a {
			if b[x] {
				n++
			}
		}
		d := len(a) + len(b) - n
		if d == 0 {
			d = 1
		}
		return float64(n) / float64(d)
	}
	var out, rest []int
	for i := range items {
		rest = append(rest, i)
	}
	for len(out) < k && len(rest) > 0 {
		best, bs := -1, -1e9
		for _, i := range rest {
			div := 0.0
			for _, j := range out {
				div = math.Max(div, jac(T[i], T[j]))
			}
			first := items[0].Fused
			if first == 0 {
				first = 1
			}
			sc := lambda*items[i].Fused - (1-lambda)*div*first
			if sc > bs {
				bs, best = sc, i
			}
		}
		out = append(out, best)
		for p, v := range rest {
			if v == best {
				rest = append(rest[:p], rest[p+1:]...)
				break
			}
		}
	}
	res := make([]Candidate, len(out))
	for i, ix := range out {
		res[i] = items[ix]
	}
	return res
}

// SortByEvidence: stable, strongest evidence first.
func SortByEvidence(items []Candidate) {
	sort.SliceStable(items, func(a, b int) bool { return EvidenceRank(items[a].Evidence) < EvidenceRank(items[b].Evidence) })
}

// ---- privacy: nothing that identifies the athlete leaves the VPS
var redactions = []struct {
	re *regexp.Regexp
	to string
}{
	{regexp.MustCompile(`(?i)\bRihan(?:\s+Rosihan)?\b`), "the athlete"},
	{regexp.MustCompile(`(?i)\bRosihan\b`), "the athlete"},
	{regexp.MustCompile(`(?i)Pizza Hut(?: Indonesia)?`), "the employer"},
	{regexp.MustCompile(`[\w.+-]+@[\w-]+\.[\w.-]+`), "[email]"},
	{regexp.MustCompile(`https?://\S+`), "[url]"},
	{regexp.MustCompile(`\b(?:sk|pk)-[A-Za-z0-9]{16,}\b`), "[secret]"},
	{regexp.MustCompile(`(?i)\b[0-9a-f]{32,}\b`), "[secret]"},
	{regexp.MustCompile(`\b(?:\+?62|0)8\d{8,11}\b`), "[phone]"},
}

func Redact(t string) string {
	for _, r := range redactions {
		t = r.re.ReplaceAllString(t, r.to)
	}
	return t
}

// ---- fingerprint of a session: 14 numeric features, z-scored over all sessions; cosine similarity finds "runs like this one"
var Features = []string{"log_dist", "log_dur", "run_pace", "run_hr", "ef", "run_share", "drift", "gct_fade", "stride_fade", "vr_fade", "temp", "gain_km", "tl_min", "hrv_dev"}

type FeatureRow map[string]*float64

type ZMatrix struct{ Mean, SD map[string]float64 }

func NewZMatrix(rows []FeatureRow) ZMatrix {
	z := ZMatrix{map[string]float64{}, map[string]float64{}}
	for _, k := range Features {
		var v []float64
		for _, r := range rows {
			if x := r[k]; x != nil && !math.IsNaN(*x) && !math.IsInf(*x, 0) {
				v = append(v, *x)
			}
		}
		s := 0.0
		for _, x := range v {
			s += x
		}
		n := float64(len(v))
		if n == 0 {
			n = 1
		}
		m := s / n
		ss := 0.0
		for _, x := range v {
			ss += (x - m) * (x - m)
		}
		sd := math.Sqrt(ss / math.Max(1, float64(len(v)-1)))
		if sd == 0 || math.IsNaN(sd) {
			sd = 1
		}
		z.Mean[k], z.SD[k] = m, sd
	}
	return z
}
func (z ZMatrix) Z(r FeatureRow) []float64 {
	out := make([]float64, len(Features))
	for i, k := range Features {
		if x := r[k]; x != nil && !math.IsNaN(*x) && !math.IsInf(*x, 0) {
			out[i] = (*x - z.Mean[k]) / z.SD[k]
		}
	}
	return out
}
func Cosine(a, b []float64) float64 {
	d, x, y := 0.0, 0.0, 0.0
	for i := range a {
		d += a[i] * b[i]
		x += a[i] * a[i]
		y += b[i] * b[i]
	}
	if x == 0 || y == 0 {
		return 0
	}
	return d / math.Sqrt(x*y)
}

// ---- twin compaction: what the coach sees of the twin (the fade curves and per-km run share are dropped, last 3 marathon attempts, 6 shoes)
func CompactTwin(state map[string]any) map[string]any {
	b, _ := marshalNoEscape(state)
	var t map[string]any
	_ = jsonUnmarshal([]byte(b), &t)
	delete(t, "fade_curves")
	if d, ok := t["durability"].(map[string]any); ok {
		delete(d, "run_share_by_km")
	}
	if r, ok := t["races"].(map[string]any); ok {
		att, _ := r["fm_attempts"].([]any)
		if len(att) > 3 {
			att = att[len(att)-3:]
		}
		if att == nil {
			att = []any{}
		}
		r["fm_attempts"] = att
	}
	shoes, _ := t["shoes"].([]any)
	kept := []any{}
	for _, sv := range shoes {
		s, _ := sv.(map[string]any)
		n, _ := s["n"].(float64)
		retired, _ := s["retired"].(bool)
		if n > 0 || !retired {
			kept = append(kept, sv)
		}
	}
	if len(kept) > 6 {
		kept = kept[:6]
	}
	t["shoes"] = kept
	return t
}

// EstTokens: the rough token count the budget loop uses — the JSON length in UTF-16 units divided by 3.6, rounded up.
func EstTokens(jsonText string) int {
	return int(math.Ceil(float64(len(utf16.Encode([]rune(jsonText)))) / 3.6))
}

var _ = strings.TrimSpace
