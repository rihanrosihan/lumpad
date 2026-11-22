package graph

import (
	"math"
	"regexp"
	"sort"
	"strings"
	"unicode"
)

// Memory↔memory similarity without an embedding model: TF-IDF over unigrams + bigrams, cosine similarity, computed locally (no external call, no cost).
// Deterministic: same memories → same links. Used for RELATED_TO edges ("this note is close to that one") and, later, as a retrieval signal.

var stop = map[string]bool{}

func init() {
	for _, w := range strings.Fields(`the and for with that this from are was were has have had not but you your they them their will would can could should may might its into over than then also more most less very per via out off any all one two use used using when what which while who how why because about after before between during within without only just like such each both other some many much been being does did done get got set sit yang dan untuk dengan dari pada itu ini adalah akan atau juga karena saat jika sudah belum tidak bisa dalam oleh para saja lebih sangat hanya setelah sebelum antara tanpa dapat harus bukan kamu`) {
		stop[w] = true
	}
}

func stem(w string) string {
	if len(w) > 5 && strings.HasSuffix(w, "ing") {
		return w[:len(w)-3]
	}
	if len(w) > 4 && strings.HasSuffix(w, "es") {
		return w[:len(w)-2]
	}
	if len(w) > 3 && strings.HasSuffix(w, "s") && !strings.HasSuffix(w, "ss") {
		return w[:len(w)-1]
	}
	return w
}

// tokens → stemmed unigrams and bigrams of adjacent content words
var urlRe = regexp.MustCompile(`https?://\S+|www\.\S+|utm_\w+=\S*`)

func terms(text string) []string {
	var words []string
	for _, f := range strings.FieldsFunc(strings.ToLower(urlRe.ReplaceAllString(text, " ")), func(r rune) bool { return !unicode.IsLetter(r) && !unicode.IsDigit(r) }) {
		if len(f) >= 3 && !stop[f] && !isNumeric(f) {
			words = append(words, stem(f))
		}
	}
	out := make([]string, 0, len(words)*2)
	out = append(out, words...)
	for i := 1; i < len(words); i++ {
		out = append(out, words[i-1]+"_"+words[i])
	}
	return out
}

func isNumeric(s string) bool {
	for _, r := range s {
		if !unicode.IsDigit(r) {
			return false
		}
	}
	return true
}

type sparse struct {
	idx []int
	val []float64
}

// MemDoc is one memory prepared for comparison.
type MemDoc struct {
	ID      int64
	Group   string // same group = trivially similar (adjacent chunks of one document), never linked
	Curated bool   // a coach finding or rule; a pair needs at least one curated side (knowledge-base boilerplate pairs up with itself otherwise)
	Text    string
}

// SimPair is an undirected link (A < B) with its cosine and the terms that drive it.
type SimPair struct {
	A, B int64
	Sim  float64
	Via  []string
}

// SimilarMemories returns up to k neighbours per memory with cosine ≥ min, de-duplicated as undirected pairs.
func SimilarMemories(docs []MemDoc, k int, min float64) []SimPair {
	n := len(docs)
	if n < 2 {
		return nil
	}
	vocab := map[string]int{}
	var names []string
	df := []int{}
	tfs := make([]map[int]int, n)
	for i, d := range docs {
		tf := map[int]int{}
		for _, t := range terms(d.Text) {
			id, ok := vocab[t]
			if !ok {
				id = len(names)
				vocab[t] = id
				names = append(names, t)
				df = append(df, 0)
			}
			tf[id]++
		}
		for id := range tf {
			df[id]++
		}
		tfs[i] = tf
	}
	vecs := make([]sparse, n)
	for i, tf := range tfs {
		ids := make([]int, 0, len(tf))
		for id := range tf {
			// terms in more than 30 % of documents (but never fewer than 10 documents) carry no signal. Terms seen once cannot match, but they STAY in the vector so they count in its length (dropping them inflates every cosine)
			if float64(df[id]) <= math.Max(0.3*float64(n), 10) {
				ids = append(ids, id)
			}
		}
		sort.Ints(ids)
		v := sparse{idx: ids, val: make([]float64, len(ids))}
		norm := 0.0
		for j, id := range ids {
			w := (1 + math.Log(float64(tf[id]))) * (math.Log(float64(n+1)/float64(df[id]+1)) + 1)
			v.val[j] = w
			norm += w * w
		}
		if norm > 0 {
			norm = math.Sqrt(norm)
			for j := range v.val {
				v.val[j] /= norm
			}
		}
		vecs[i] = v
	}
	type cand struct {
		j   int
		sim float64
	}
	best := make([][]cand, n)
	for i := 0; i < n; i++ {
		for j := i + 1; j < n; j++ {
			if (docs[i].Group != "" && docs[i].Group == docs[j].Group) || (!docs[i].Curated && !docs[j].Curated) {
				continue
			}
			s, common := dotCount(vecs[i], vecs[j])
			if s >= min && common >= 2 { // one shared word is a coincidence, not a relation
				best[i] = append(best[i], cand{j, s})
				best[j] = append(best[j], cand{i, s})
			}
		}
	}
	seen := map[[2]int]bool{}
	var out []SimPair
	for i := 0; i < n; i++ {
		sort.SliceStable(best[i], func(a, b int) bool { return best[i][a].sim > best[i][b].sim })
		for r := 0; r < len(best[i]) && r < k; r++ {
			j := best[i][r].j
			key := [2]int{min2(i, j), max2(i, j)}
			if seen[key] {
				continue
			}
			seen[key] = true
			a, b := docs[key[0]].ID, docs[key[1]].ID
			out = append(out, SimPair{A: a, B: b, Sim: math.Round(best[i][r].sim*1000) / 1000, Via: shared(vecs[key[0]], vecs[key[1]], names, 3)})
		}
	}
	sort.SliceStable(out, func(a, b int) bool {
		if out[a].A != out[b].A {
			return out[a].A < out[b].A
		}
		return out[a].B < out[b].B
	})
	return out
}

func dotCount(a, b sparse) (float64, int) {
	s, i, j, c := 0.0, 0, 0, 0
	for i < len(a.idx) && j < len(b.idx) {
		switch {
		case a.idx[i] == b.idx[j]:
			s += a.val[i] * b.val[j]
			c++
			i++
			j++
		case a.idx[i] < b.idx[j]:
			i++
		default:
			j++
		}
	}
	return s, c
}

// the highest-weighted terms both memories share (readable terms only: bigrams first), for the edge's explanation
func shared(a, b sparse, names []string, top int) []string {
	type tw struct {
		t string
		w float64
	}
	var ts []tw
	i, j := 0, 0
	for i < len(a.idx) && j < len(b.idx) {
		switch {
		case a.idx[i] == b.idx[j]:
			ts = append(ts, tw{names[a.idx[i]], a.val[i] * b.val[j]})
			i++
			j++
		case a.idx[i] < b.idx[j]:
			i++
		default:
			j++
		}
	}
	sort.SliceStable(ts, func(x, y int) bool { return ts[x].w > ts[y].w })
	var out []string
	for _, t := range ts {
		if len(out) == top {
			break
		}
		out = append(out, strings.ReplaceAll(t.t, "_", " "))
	}
	return out
}

func min2(a, b int) int {
	if a < b {
		return a
	}
	return b
}
func max2(a, b int) int {
	if a > b {
		return a
	}
	return b
}
