package coros

import (
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
)

// Trace: what a Node pull run recorded (server/coros/pull.js → pull_trace). Replay feeds the recorded responses to the Go pull and
// reports every difference: an unexpected or missing call, and any difference in payloads, devices or the schedule.
type Trace struct {
	V       int    `json:"v"`
	From    string `json:"from"`
	To      string `json:"to"`
	Trigger string `json:"trigger"`
	Calls   []struct {
		Tool  string         `json:"tool"`
		Args  map[string]any `json:"args"`
		Text  *string        `json:"text"`
		Error *string        `json:"error"`
	} `json:"calls"`
	Laps    map[string]bool `json:"laps"`
	TL      map[string]bool `json:"tl"`
	PlanDue *bool           `json:"planDue"`
	PlanHad bool            `json:"planHad"`
	KV      struct {
		Devices   json.RawMessage `json:"devices"`
		CorosPlan json.RawMessage `json:"coros_plan"`
	} `json:"kv"`
	Payloads json.RawMessage `json:"payloads"`
}

type traceState struct{ t *Trace }

func (s traceState) HasLaps(id string) bool { return s.t.Laps[id] }
func (s traceState) HasTL(id string) bool   { return s.t.TL[id] }
func (s traceState) PlanDue() (bool, bool) {
	return s.t.PlanDue != nil && *s.t.PlanDue, s.t.PlanHad
}

func jsonEq(a, b any) bool {
	ja, _ := json.Marshal(a)
	jb, _ := json.Marshal(b)
	var x, y any
	_ = json.Unmarshal(ja, &x)
	_ = json.Unmarshal(jb, &y)
	return reflect.DeepEqual(x, y)
}

// Replay runs the Go pull on a recorded trace; it returns the list of differences (empty = identical).
func Replay(t *Trace) []string {
	var diffs []string
	i := 0
	call := func(tool string, args map[string]any) (string, error) {
		if i >= len(t.Calls) {
			diffs = append(diffs, fmt.Sprintf("extra call %d: %s %v (Node made %d calls)", i, tool, args, len(t.Calls)))
			return "", errors.New("replay: no recorded response")
		}
		c := t.Calls[i]
		i++
		if c.Tool != tool || !jsonEq(c.Args, args) {
			diffs = append(diffs, fmt.Sprintf("call %d: Go %s %v, Node %s %v", i-1, tool, args, c.Tool, c.Args))
		}
		if c.Error != nil {
			return "", errors.New(*c.Error)
		}
		if c.Text == nil {
			return "", nil
		}
		return *c.Text, nil
	}
	res, err := PullRange(call, traceState{t}, t.From, t.To, t.Trigger, []string{})
	if err != nil {
		return append(diffs, "pull error: "+err.Error())
	}
	if i != len(t.Calls) {
		diffs = append(diffs, fmt.Sprintf("Go made %d calls, Node %d", i, len(t.Calls)))
	}
	cmp := func(name string, got any, want json.RawMessage) {
		var w any
		if len(want) > 0 {
			_ = json.Unmarshal(want, &w)
		}
		if !jsonEq(got, w) {
			gj, _ := json.Marshal(got)
			diffs = append(diffs, fmt.Sprintf("%s differs:\n  go %.500s\n  js %.500s", name, gj, want))
		}
	}
	cmp("payloads", res.Payloads, t.Payloads)
	if res.Devices != nil || len(t.KV.Devices) > 0 {
		cmp("devices", res.Devices, t.KV.Devices)
	}
	if res.PlanDone || len(t.KV.CorosPlan) > 0 {
		cmp("coros_plan", res.Plan, t.KV.CorosPlan)
	}
	return diffs
}
