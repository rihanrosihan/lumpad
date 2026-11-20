package coach

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
	"time"
	"unicode"
)

// Long-term memory as the coach sees it: a small store interface (PostgreSQL memory.item at cutover; the mirror tables are rewritten by the shadow
// pass until then) and an in-memory implementation for tests and dry runs.

type Memory struct {
	ID         int64
	Tier       string // episodic | semantic | procedural
	Kind       string
	Title      string
	Body       string
	Payload    string // JSON text, "" = none
	Evidence   string // evidence tag
	N          int
	Confidence *float64
	Status     string // candidate | active | proposal | …
	ValidFrom  string // date the item is valid from (YYYY-MM-DD); "" = none
	Locked     bool
	Source     string
	CreatedBy  string
	Hash       string
	CreatedAt  time.Time
	UpdatedAt  time.Time
}

type MemoryStore interface {
	Get(ctx context.Context, id int64) (*Memory, error)
	// Similar: items of the given tiers and statuses ranked by text relevance to `text`, best first (BM25 in SQLite, ts_rank in PostgreSQL).
	Similar(ctx context.Context, text string, tiers, statuses []string, limit int) ([]Memory, error)
	// Add inserts unless an item with the same hash exists; created reports which happened.
	Add(ctx context.Context, m Memory, runID int64) (id int64, created bool, err error)
	Bump(ctx context.Context, id int64, n int, status string) error
	Audit(ctx context.Context, action string, memoryID *int64, detail map[string]any, runID int64) error
}

// MemoryHash is the dedupe key: sha256 of tier|kind|title|body.
func MemoryHash(tier, kind, title, body string) string {
	h := sha256.Sum256([]byte(fmt.Sprintf("%s|%s|%s|%s", tier, kind, title, body)))
	return hex.EncodeToString(h[:])
}

// ---- in-memory store
type AuditRow struct {
	Action   string
	MemoryID *int64
	Detail   map[string]any
	RunID    int64
}
type MemMemory struct {
	Items  []Memory
	Audits []AuditRow
	next   int64
	Now    func() time.Time
}

func (m *MemMemory) now() time.Time {
	if m.Now != nil {
		return m.Now()
	}
	return time.Now()
}
func (m *MemMemory) Get(_ context.Context, id int64) (*Memory, error) {
	for i := range m.Items {
		if m.Items[i].ID == id {
			c := m.Items[i]
			return &c, nil
		}
	}
	return nil, nil
}

var reFTSWord = regexp.MustCompile(`[\p{L}\p{N}][\p{L}\p{N}_.-]{2,}`)

// ftsTerms: the query terms of memory.js ftsQuery (distinct lower-case words of 3+ characters, at most 24), each split into FTS5 tokens
func ftsTerms(text string) [][]string {
	seen, out := map[string]bool{}, [][]string{}
	for _, w := range reFTSWord.FindAllString(jsLower(text), -1) {
		if seen[w] || len(seen) >= 24 {
			continue
		}
		seen[w] = true
		out = append(out, fts5Tokens(w)) // FTS5 runs the query through the same tokenizer as the documents
	}
	return out
}
func splitTokens(s string) []string {
	return strings.FieldsFunc(s, func(r rune) bool { return !unicode.IsLetter(r) && !unicode.IsNumber(r) })
}
func hasPhrase(doc, phrase []string) bool {
	if len(phrase) == 0 {
		return false
	}
	for i := 0; i+len(phrase) <= len(doc); i++ {
		ok := true
		for j := range phrase {
			if doc[i+j] != phrase[j] {
				ok = false
				break
			}
		}
		if ok {
			return true
		}
	}
	return false
}

// Similar: BM25 over every item (corpus statistics as in FTS5), filtered by tier and status, best first.
func (m *MemMemory) Similar(_ context.Context, text string, tiers, statuses []string, limit int) ([]Memory, error) {
	var out []Memory
	for _, h := range NewBM25Index(m.Items).Search(text, BM25Filter{Tiers: tiers, Statuses: statuses, Limit: limit}) {
		out = append(out, h.Mem)
	}
	return out, nil
}
func (m *MemMemory) Add(ctx context.Context, it Memory, runID int64) (int64, bool, error) {
	it.Hash = MemoryHash(it.Tier, it.Kind, it.Title, it.Body)
	for _, x := range m.Items {
		if x.Hash == it.Hash {
			return x.ID, false, nil
		}
	}
	if it.ID == 0 { // SQLite AUTOINCREMENT: one more than the highest id ever used here
		for _, x := range m.Items {
			if x.ID > m.next {
				m.next = x.ID
			}
		}
		m.next++
		it.ID = m.next
	}
	if it.N == 0 {
		it.N = 1
	}
	if it.Evidence == "" {
		it.Evidence = "HYPOTHESIS"
	}
	if it.Status == "" {
		it.Status = "candidate"
	}
	if it.CreatedBy == "" {
		it.CreatedBy = "system"
	}
	it.CreatedAt, it.UpdatedAt = m.now(), m.now()
	m.Items = append(m.Items, it)
	_ = m.Audit(ctx, "add", &it.ID, map[string]any{"tier": it.Tier, "status": it.Status, "by": it.CreatedBy}, runID)
	return it.ID, true, nil
}
func (m *MemMemory) Bump(_ context.Context, id int64, n int, status string) error {
	for i := range m.Items {
		if m.Items[i].ID == id {
			m.Items[i].N, m.Items[i].Status, m.Items[i].UpdatedAt = n, status, m.now()
		}
	}
	return nil
}
func (m *MemMemory) Audit(_ context.Context, action string, id *int64, detail map[string]any, runID int64) error {
	m.Audits = append(m.Audits, AuditRow{action, id, detail, runID})
	return nil
}

func jsonUnmarshal(b []byte, v any) error { return json.Unmarshal(b, v) }
