package coach

import (
	"bytes"
	_ "embed"
	"encoding/json"
	"fmt"
	"strings"
)

// The coach prompt: port of renderPromptPure in server/intel/prompt.js. system = the stable part (identical between calls, so provider prefix
// caching works); user = the task plus everything that changes. Verified byte for byte against Node on sentinel contexts (data/prompt_probe.json).

//go:embed data/stable.json
var stableJSON []byte

type Stable struct {
	Athlete struct {
		RaceCalendar     []string `json:"race_calendar_2027"`
		RaceCalendarNote string   `json:"race_calendar_note"`
		Goal             string   `json:"goal"`
		Facts            []string `json:"facts"`
	} `json:"athlete"`
	Definitions json.RawMessage   `json:"definitions"`
	Tasks       map[string]string `json:"tasks"`
	IntentQuery map[string]string `json:"intent_query"`
}

// StableData is the embedded copy of the stable athlete block, definitions and task wording (kept current by tools/sync_go_data.mjs).
var StableData = func() Stable {
	var s Stable
	if err := json.Unmarshal(stableJSON, &s); err != nil {
		panic("stable.json: " + err.Error())
	}
	return s
}()

type Rule struct {
	ID     int    `json:"id"`
	Title  string `json:"title"`
	Rule   string `json:"rule"`
	Locked bool   `json:"locked"`
	Tag    string `json:"tag"`
}

// Volatile: what changes between calls. The JSON pieces are kept as raw text and never re-encoded, so the bytes the model sees are exactly the
// bytes the context builder produced.
type Volatile struct {
	Intent, AsOf, Question                                    string
	Query, Twin, CorrelationEdges, Episodes, Facts, Telemetry json.RawMessage
}
type Context struct {
	Rules    []Rule
	Volatile Volatile
}

type Prompt struct {
	System string `json:"system"`
	User   string `json:"user"`
}

func compact(raw json.RawMessage) string {
	var b bytes.Buffer
	if err := json.Compact(&b, raw); err != nil {
		return string(raw)
	}
	return b.String()
}

// RenderPrompt builds the system and user prompt for a task; lang is "id" (Bahasa Indonesia) or anything else (English).
func RenderPrompt(c Context, task, lang string) Prompt {
	sys := []string{sysIntro, sysEvidence, lockedHdr}
	for _, r := range c.Rules {
		if r.Locked {
			sys = append(sys, fmt.Sprintf("- [%d] %s: %s", r.ID, r.Title, r.Rule))
		}
	}
	sys = append(sys, otherHdr)
	for _, r := range c.Rules {
		if !r.Locked {
			sys = append(sys, fmt.Sprintf("- [%d] %s: %s", r.ID, r.Title, r.Rule))
		}
	}
	sys = append(sys, "ATHLETE: "+StableData.Athlete.Goal)
	for _, f := range StableData.Athlete.Facts {
		sys = append(sys, "- "+f)
	}
	sys = append(sys, "DEFINITIONS: "+compact(StableData.Definitions), sysOutput, sysAnalysis, sysCheck, sysPatch, sysMemory)
	if lang == "id" {
		sys = append(sys, langID)
	} else {
		sys = append(sys, langEN)
	}
	v := c.Volatile
	var ctx strings.Builder // JSON.stringify({ query, twin, correlation_edges, episodes, facts, telemetry }): a missing piece is left out
	ctx.WriteByte('{')
	n := 0
	for _, kv := range []struct {
		k string
		v json.RawMessage
	}{{"query", v.Query}, {"twin", v.Twin}, {"correlation_edges", v.CorrelationEdges}, {"episodes", v.Episodes}, {"facts", v.Facts}, {"telemetry", v.Telemetry}} {
		if len(kv.v) == 0 {
			continue
		}
		if n > 0 {
			ctx.WriteByte(',')
		}
		fmt.Fprintf(&ctx, "%q:%s", kv.k, compact(kv.v))
		n++
	}
	ctx.WriteByte('}')
	user := []string{fmt.Sprintf("TASK (%s, as of %s): %s", v.Intent, v.AsOf, task)}
	if v.Question != "" {
		user = append(user, "QUESTION: "+v.Question)
	}
	user = append(user, ctxHdr, ctx.String(), citeLine)
	return Prompt{strings.Join(sys, "\n"), strings.Join(user, "\n")}
}
