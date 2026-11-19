package coros

import (
	"encoding/json"
	"os"
	"testing"
)

func TestReplayNodePullTraces(t *testing.T) {
	b, err := os.ReadFile("testdata/pull_traces.json")
	if err != nil {
		t.Fatal(err)
	}
	var cases []struct {
		Name  string
		Trace Trace
	}
	if err := json.Unmarshal(b, &cases); err != nil {
		t.Fatal(err)
	}
	if len(cases) == 0 {
		t.Fatal("no traces: run node tools/gen_pull_traces.mjs")
	}
	for _, c := range cases {
		for i, d := range Replay(&c.Trace) {
			if i < 5 {
				t.Errorf("%s: %s", c.Name, d)
			}
		}
	}
}
