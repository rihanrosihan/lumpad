package coach

import (
	"encoding/json"
	"os"
	"testing"
)

type probeCase struct {
	Intent, Lang, Task string
	Rules              []Rule
	Volatile           struct {
		Intent   string
		AsOf     string `json:"as_of"`
		Question string
		Raw      struct { // the JSON pieces as text exactly as JSON.stringify wrote them
			Query            string
			Twin             string
			CorrelationEdges string `json:"correlation_edges"`
			Episodes         string
			Facts            string
			Telemetry        string
		}
	}
	Out Prompt
}

// The sentinel probe is rendered by the CURRENT Node renderer (tools/sync_go_data.mjs); the Go renderer must reproduce it byte for byte.
func TestPromptMatchesNodeByteForByte(t *testing.T) {
	b, err := os.ReadFile("data/prompt_probe.json")
	if err != nil {
		t.Fatal(err)
	}
	var cases []probeCase
	if err := json.Unmarshal(b, &cases); err != nil {
		t.Fatal(err)
	}
	if len(cases) < 10 {
		t.Fatalf("probe too small: %d cases", len(cases))
	}
	for i, c := range cases {
		task := StableData.Tasks[c.Intent]
		if task != c.Task {
			t.Fatalf("case %d: embedded task text differs from the probe", i)
		}
		got := RenderPrompt(Context{Rules: c.Rules, Volatile: Volatile{Intent: c.Volatile.Intent, AsOf: c.Volatile.AsOf, Question: c.Volatile.Question,
			Query: json.RawMessage(c.Volatile.Raw.Query), Twin: json.RawMessage(c.Volatile.Raw.Twin), CorrelationEdges: json.RawMessage(c.Volatile.Raw.CorrelationEdges), Episodes: json.RawMessage(c.Volatile.Raw.Episodes), Facts: json.RawMessage(c.Volatile.Raw.Facts), Telemetry: json.RawMessage(c.Volatile.Raw.Telemetry)}}, c.Task, c.Lang)
		if got.System != c.Out.System {
			t.Errorf("case %d (%s/%s) system differs at byte %d:\n  go  …%.160s\n  js  …%.160s", i, c.Intent, c.Lang, firstDiff(got.System, c.Out.System), tail(got.System, firstDiff(got.System, c.Out.System)), tail(c.Out.System, firstDiff(got.System, c.Out.System)))
		}
		if got.User != c.Out.User {
			d := firstDiff(got.User, c.Out.User)
			t.Errorf("case %d (%s/%s) user differs at byte %d:\n  go  …%.200s\n  js  …%.200s", i, c.Intent, c.Lang, d, tail(got.User, d), tail(c.Out.User, d))
		}
	}
}
func firstDiff(a, b string) int {
	n := min(len(a), len(b))
	for i := 0; i < n; i++ {
		if a[i] != b[i] {
			return i
		}
	}
	return n
}
func tail(s string, from int) string { return s[max(0, from-40):] }
