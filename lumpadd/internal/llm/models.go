package llm

import (
	"encoding/json"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

// Model resolution for DeepSeek: the newest "Flash" in GET /models (DEEPSEEK_MODEL=auto-flash) or a pinned id; port of server/intel/llm.js.

type ModelInfo struct {
	ID      string   `json:"id"`
	Name    string   `json:"name"`
	Context *float64 `json:"context,omitempty"`
	Efforts []string `json:"efforts,omitempty"`
	At      float64  `json:"at,omitempty"` // ms since epoch when resolved
	Changed bool     `json:"changed"`
	Stale   bool     `json:"stale,omitempty"`
	Pinned  bool     `json:"pinned,omitempty"`
}

type listedModel struct {
	ID            string   `json:"id"`
	Name          string   `json:"name"`
	ContextWindow *float64 `json:"context_window"`
	Effort        *struct {
		SupportedLevels []string `json:"supported_levels"`
	} `json:"effort"`
}

var reVer = regexp.MustCompile(`(?i)V(\d+(?:\.\d+)*)`)

func VersionOf(name string) []int {
	m := reVer.FindStringSubmatch(name)
	if m == nil {
		return []int{0}
	}
	var v []int
	for _, p := range strings.Split(m[1], ".") {
		n, _ := strconv.Atoi(p)
		v = append(v, n)
	}
	return v
}
func CmpVer(a, b []int) int {
	for i := 0; i < max(len(a), len(b)); i++ {
		var x, y int
		if i < len(a) {
			x = a[i]
		}
		if i < len(b) {
			y = b[i]
		}
		if d := x - y; d != 0 {
			return d
		}
	}
	return 0
}

var reFlash = regexp.MustCompile(`(?i)flash`)

func nameOrID(m listedModel) string {
	if m.Name != "" {
		return m.Name
	}
	return m.ID
}

// PickFlash: the highest-versioned Flash model, or nil.
func PickFlash(models []listedModel) *listedModel {
	var f []listedModel
	for _, m := range models {
		if reFlash.MatchString(nameOrID(m)) {
			f = append(f, m)
		}
	}
	sort.SliceStable(f, func(a, b int) bool { return CmpVer(VersionOf(nameOrID(f[b])), VersionOf(nameOrID(f[a]))) < 0 })
	if len(f) == 0 {
		return nil
	}
	return &f[0]
}

// KV is a small persistent key-value store (app.kv in production).
type KV interface {
	Get(key string) (json.RawMessage, bool)
	Set(key string, v any) error
}

type MemKV map[string]json.RawMessage

func (m MemKV) Get(k string) (json.RawMessage, bool) {
	v, ok := m[k]
	return v, ok && string(v) != "null"
}
func (m MemKV) Set(k string, v any) error {
	b, err := json.Marshal(v)
	if err != nil {
		return err
	}
	m[k] = b
	return nil
}

var dayMs = float64(24 * time.Hour / time.Millisecond)
