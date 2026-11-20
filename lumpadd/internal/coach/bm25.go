package coach

import (
	"math"
	"sort"
	"strings"
	"unicode"

	"golang.org/x/text/unicode/norm"
)

// BM25 full-text search over the memory, reproducing SQLite FTS5 bm25(memory_fts, 3.0, 1.0): the same tokenizer (unicode61, diacritics removed),
// the same corpus statistics (every row of the table counts, whatever its tier or status), the same IDF floor. The memory is a few hundred rows, so
// scoring all of them in process is cheap, and it keeps the coach's retrieval exactly what the Node app produces. (Embedding search can sit on top later.)

const (
	bm25K1 = 1.2
	bm25B  = 0.75
	wTitle = 3.0
	wBody  = 1.0
)

// foldRune: FTS5 unicode61 folding with remove_diacritics: a letter that decomposes into a base letter plus combining marks becomes the lower-cased
// base letter (é → e); anything else is only lower-cased (no other normalisation: Korean syllables and compatibility ideographs stay as they are).
func foldRune(r rune) string {
	if r < 0x80 {
		if r >= 'A' && r <= 'Z' {
			r += 'a' - 'A'
		}
		return string(r)
	}
	d := []rune(norm.NFD.String(string(r)))
	if len(d) > 1 {
		onlyMarks := true
		for _, c := range d[1:] {
			if !unicode.Is(unicode.Mn, c) {
				onlyMarks = false
			}
		}
		if onlyMarks && !unicode.Is(unicode.Mn, d[0]) {
			r = d[0]
		}
	}
	return string(unicode.ToLower(r))
}

func isFTS5TokenRune(r rune) bool {
	if r < 0x80 {
		return (r >= '0' && r <= '9') || (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z')
	}
	i := sort.Search(len(fts5TokenRanges), func(i int) bool { return fts5TokenRanges[i][1] >= r })
	return i < len(fts5TokenRanges) && fts5TokenRanges[i][0] <= r
}

// fts5Tokens: the tokens FTS5 unicode61 (remove_diacritics 2) produces; the character tables are generated from the real tokenizer.
func fts5Tokens(s string) []string {
	var out []string
	var cur strings.Builder
	flush := func() {
		if cur.Len() > 0 {
			out = append(out, cur.String())
			cur.Reset()
		}
	}
	for _, r := range s {
		if !isFTS5TokenRune(r) {
			flush()
			continue
		}
		if f, ok := fts5FoldExceptions[r]; ok {
			cur.WriteString(f)
		} else {
			cur.WriteString(foldRune(r))
		}
	}
	flush()
	return out
}

type bm25Doc struct {
	Mem   Memory
	Title []string
	Body  []string
	Len   int
}

type BM25Index struct {
	docs  []bm25Doc
	avgdl float64
}

func NewBM25Index(items []Memory) *BM25Index {
	ix := &BM25Index{docs: make([]bm25Doc, len(items))}
	total := 0
	for i, m := range items {
		d := bm25Doc{Mem: m, Title: fts5Tokens(m.Title), Body: fts5Tokens(m.Body)}
		d.Len = len(d.Title) + len(d.Body)
		total += d.Len
		ix.docs[i] = d
	}
	if len(items) > 0 {
		ix.avgdl = float64(total) / float64(len(items))
	}
	return ix
}

func countPhrase(doc, phrase []string) int {
	n := 0
	for i := 0; i+len(phrase) <= len(doc); i++ {
		ok := true
		for j := range phrase {
			if doc[i+j] != phrase[j] {
				ok = false
				break
			}
		}
		if ok {
			n++
		}
	}
	return n
}

type BM25Filter struct {
	Tiers, Statuses []string
	Since           string // valid_from must be empty or >= Since
	Limit           int
}

type BM25Hit struct {
	Mem   Memory
	Score float64 // larger = better (FTS5 returns the negative of this)
}

// Search ranks the rows that contain at least one query term. The query terms are those of the Node app's ftsQuery (words of 3+ characters, at most 24).
func (ix *BM25Index) Search(text string, f BM25Filter) []BM25Hit {
	terms := ftsTerms(text)
	if len(terms) == 0 || len(ix.docs) == 0 {
		return nil
	}
	n := float64(len(ix.docs))
	idf := make([]float64, len(terms))
	for i, t := range terms {
		hits := 0
		for _, d := range ix.docs {
			if countPhrase(d.Title, t) > 0 || countPhrase(d.Body, t) > 0 {
				hits++
			}
		}
		v := math.Log((n - float64(hits) + 0.5) / (float64(hits) + 0.5))
		if v <= 0 {
			v = 1e-6
		}
		idf[i] = v
	}
	in := func(list []string, v string) bool {
		for _, x := range list {
			if x == v {
				return true
			}
		}
		return false
	}
	var out []BM25Hit
	for _, d := range ix.docs {
		if !in(f.Tiers, d.Mem.Tier) || !in(f.Statuses, d.Mem.Status) {
			continue
		}
		if f.Since != "" && d.Mem.ValidFrom != "" && d.Mem.ValidFrom < f.Since {
			continue
		}
		score, any := 0.0, false
		for i, t := range terms {
			tf := wTitle*float64(countPhrase(d.Title, t)) + wBody*float64(countPhrase(d.Body, t))
			if tf == 0 {
				continue
			}
			any = true
			score += idf[i] * (tf * (bm25K1 + 1)) / (tf + bm25K1*(1-bm25B+bm25B*float64(d.Len)/ix.avgdl))
		}
		if any {
			out = append(out, BM25Hit{d.Mem, score})
		}
	}
	sort.SliceStable(out, func(a, b int) bool { return out[a].Score > out[b].Score })
	if f.Limit > 0 && len(out) > f.Limit {
		out = out[:f.Limit]
	}
	return out
}
