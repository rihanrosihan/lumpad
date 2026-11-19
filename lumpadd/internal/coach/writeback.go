package coach

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"strings"
)

// Post-analysis memory write-back: port of applyWriteback in server/intel/writeback.js. The model's memory_writes are UNTRUSTED: schema-checked,
// citation-checked, number-checked, de-duplicated, and stored as unconfirmed candidates. Locked rules and measured data are never touched;
// procedural writes become proposals for the athlete.

type WBStored struct {
	ID     int64  `json:"id"`
	Status string `json:"status"`
}
type WBMerged struct {
	ID       int64 `json:"id"`
	N        int   `json:"n"`
	Promoted bool  `json:"promoted"`
}
type WBRejected struct {
	Title any      `json:"title"`
	Why   []string `json:"why"`
}
type WBResult struct {
	Stored   []WBStored   `json:"stored"`
	Merged   []WBMerged   `json:"merged"`
	Rejected []WBRejected `json:"rejected"`
}

func str(v any) string {
	if s, ok := v.(string); ok {
		return s
	}
	if v == nil {
		return ""
	}
	return fmt.Sprint(v)
}

// ApplyWriteback: provider names the model that wrote the answer ("claude-code" marks the CLI path).
func ApplyWriteback(ctx context.Context, st MemoryStore, parsed map[string]any, runID int64, itemIDs []int64, corpus, provider string) (WBResult, error) {
	return ApplyWritebackOpt(ctx, st, parsed, runID, itemIDs, corpus, provider, false)
}

// ApplyWritebackOpt: strict = numbers are checked against the cited items only (UnverifiedStrict) instead of the whole prompt.
func ApplyWritebackOpt(ctx context.Context, st MemoryStore, parsed map[string]any, runID int64, itemIDs []int64, corpus, provider string, strict bool) (WBResult, error) {
	out := WBResult{Stored: []WBStored{}, Merged: []WBMerged{}, Rejected: []WBRejected{}}
	allowed := map[float64]bool{}
	for _, id := range itemIDs {
		allowed[float64(id)] = true
	}
	writes, _ := parsed["memory_writes"].([]any)
	for _, wv := range writes {
		w, _ := wv.(map[string]any)
		why := []string{}
		tier := str(w["tier"])
		if tier != "episodic" && tier != "semantic" && tier != "procedural" {
			why = append(why, "bad tier")
		}
		cites, isArr := w["cites"].([]any)
		if !isArr || len(cites) == 0 {
			why = append(why, "no citation")
		} else {
			all := true
			for _, c := range cites {
				f, ok := c.(float64)
				if !ok || !allowed[f] {
					all = false
				}
			}
			if !all {
				why = append(why, "cites an id that was not in the context")
			}
		}
		evidence := []string{corpus}
		for _, c := range cites {
			if f, ok := c.(float64); ok && f == math.Trunc(f) {
				if m, _ := st.Get(ctx, int64(f)); m != nil {
					evidence = append(evidence, m.Body)
					continue
				}
			}
			evidence = append(evidence, "")
		}
		title, body := str(w["title"]), str(w["body"])
		check := Unverified(title+"\n"+body, strings.Join(evidence, "\n"))
		if strict {
			check = UnverifiedStrict(title+"\n"+body, strings.Join(evidence[1:], "\n"))
		}
		if bad := check; len(bad) > 0 {
			seen, uniq := map[string]bool{}, []string{}
			for _, b := range bad {
				if !seen[b] {
					seen[b] = true
					uniq = append(uniq, b)
				}
			}
			if len(uniq) > 6 {
				uniq = uniq[:6]
			}
			why = append(why, "unverified numbers: "+strings.Join(uniq, ", "))
		}
		if len(why) > 0 {
			out.Rejected = append(out.Rejected, WBRejected{w["title"], why})
			_ = st.Audit(ctx, "writeback:rejected", nil, map[string]any{"title": w["title"], "why": why, "provider": provider}, runID)
			continue
		}
		status := "candidate"
		if tier == "procedural" {
			status = "proposal"
		}
		// dedupe: a near-identical existing memory (same tier) counts as another observation instead of a new row
		cand, err := st.Similar(ctx, title+" "+body, []string{tier}, []string{"candidate", "active", "proposal"}, 5)
		if err != nil {
			return out, err
		}
		var sim *Memory
		for i := range cand {
			if cand[i].Source != "kb" && !cand[i].Locked && Jaccard(Tokens(cand[i].Title+" "+cand[i].Body), Tokens(title+" "+body)) >= 0.6 {
				sim = &cand[i]
				break
			}
		}
		if sim != nil {
			m, _ := st.Get(ctx, sim.ID)
			n := m.N + 1
			promote := m.Status == "candidate" && n >= 3
			newStatus := m.Status
			if promote {
				newStatus = "active"
			}
			if err := st.Bump(ctx, m.ID, n, newStatus); err != nil {
				return out, err
			}
			action := "writeback:merged"
			if promote {
				action = "writeback:promoted"
			}
			id := m.ID
			_ = st.Audit(ctx, action, &id, map[string]any{"n": n, "provider": provider}, runID)
			out.Merged = append(out.Merged, WBMerged{m.ID, n, promote})
			continue
		}
		kind := str(w["kind"])
		if kind == "" {
			kind = "insight"
		}
		kind = jsSliceU16(kind, 0, 30)
		payload := orderedPayload{Cites: cites, Run: runID, Provider: provider}
		if tags, ok := w["tags"].([]any); ok {
			list := []string{}
			for i, t := range tags {
				if i >= 8 {
					break
				}
				list = append(list, jsSliceU16(str(t), 0, 40))
			}
			payload.Tags = list
		}
		pj, _ := marshalNoEscape(payload)
		item := Memory{Tier: tier, Kind: kind, Title: title, Body: body, Payload: pj, Evidence: "HYPOTHESIS", Status: status, Source: "coach", CreatedBy: "llm"}
		if provider == "claude-code" {
			item.CreatedBy = "claude-code"
		}
		if c, ok := w["confidence"].(float64); ok {
			v := math.Max(0, math.Min(1, c))
			item.Confidence = &v
		}
		id, _, err := st.Add(ctx, item, runID)
		if err != nil {
			return out, err
		}
		out.Stored = append(out.Stored, WBStored{id, status})
	}
	return out, nil
}

// orderedPayload keeps the key order the Node app writes: cites, run, provider, tags (tags omitted when absent)
type orderedPayload struct {
	Cites    []any  `json:"cites"`
	Run      int64  `json:"run"`
	Provider string `json:"provider"`
	Tags     any    `json:"tags,omitempty"` // nil = absent; an empty list is kept, as in JS
}

func marshalNoEscape(v any) (string, error) {
	var sb strings.Builder
	enc := json.NewEncoder(&sb)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(v); err != nil {
		return "", err
	}
	return strings.TrimRight(sb.String(), "\n"), nil
}
