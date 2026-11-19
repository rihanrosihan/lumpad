package graph

import (
	"context"
	"time"
)

// Hybrid RAG multi-hop Cypher expansion for AI Coach retrieval (Priority #1 RAG + #2 Knowledge Graph + #5 Sub-4).
// Enforces a strict 1.5s read timeout and skips daily_brief so the 6k token budget is never blown.

type GraphHits struct {
	MemoryIDs     []int64
	SessionLabels []string
}

func hasAny(topics []string, wants ...string) bool {
	for _, t := range topics {
		for _, w := range wants {
			if t == w {
				return true
			}
		}
	}
	return false
}

// ExpandContext queries AuraDB for multi-hop linked Memory IDs and Session labels relevant to the intent/topics.
func ExpandContext(ctx context.Context, aura *Client, intent string, topics []string, focusLabel string) (GraphHits, error) {
	var hits GraphHits
	if aura == nil || intent == "daily_brief" {
		return hits, nil
	}
	c, cancel := context.WithTimeout(ctx, 1500*time.Millisecond)
	defer cancel()

	memSeen := map[int64]bool{}
	sessSeen := map[string]bool{}
	addMem := func(id int64) {
		if id > 0 && !memSeen[id] {
			memSeen[id] = true
			hits.MemoryIDs = append(hits.MemoryIDs, id)
		}
	}
	addSess := func(lid string) {
		if lid != "" && !sessSeen[lid] {
			sessSeen[lid] = true
			hits.SessionLabels = append(hits.SessionLabels, lid)
		}
	}

	collect := func(res *QueryResult) {
		if res == nil {
			return
		}
		for _, row := range res.Values {
			if len(row) >= 1 {
				if lid, ok := row[0].(string); ok {
					addSess(lid)
				}
			}
			if len(row) >= 2 {
				if mid, ok := row[1].(float64); ok {
					addMem(int64(mid))
				}
			}
		}
	}

	// 1. Focus session neighborhood (same shoe or same weather band + produced memories)
	if focusLabel != "" {
		res, err := aura.Query(c, `
			MATCH (s:Session {label_id: $lid})-[:WORE]->(sh:Shoe)<-[:WORE]-(other:Session)
			WHERE other.label_id <> $lid AND other.distance_m >= 10000
			OPTIONAL MATCH (other)-[:PRODUCED]->(m:Memory)
			RETURN other.label_id, m.id ORDER BY other.date DESC LIMIT 5`,
			map[string]any{"lid": focusLabel})
		if err != nil {
			return hits, err
		}
		collect(res)
	}

	// 2. Race plan / Sub-4 lineage (past FM/HM attempts -> produced memories)
	if intent == "race_plan" || hasAny(topics, "run_share_long", "heat") {
		res, err := aura.Query(c, `
			MATCH (r:Race)<-[:ATTEMPT_OF]-(s:Session)-[:PRODUCED]->(m:Memory)
			WHERE r.dist_km >= 21
			RETURN s.label_id, m.id ORDER BY r.date DESC LIMIT 6`, nil)
		if err != nil {
			return hits, err
		}
		collect(res)
	}

	// 3. Pain / Gym 72h root-cause chain
	if hasAny(topics, "strength_lower", "gct_fade", "stride_fade") {
		res, err := aura.Query(c, `
			MATCH (d1:Day)-[:NEXT_DAY*1..3]->(d2:Day)-[:LOGGED_PAIN]->(p:PainSite)
			WHERE d1.strength_lower > 0
			OPTIONAL MATCH (d2)-[:HAS_SESSION]->(s:Session)-[:PRODUCED]->(m:Memory)
			RETURN s.label_id, m.id ORDER BY d2.date DESC LIMIT 5`, nil)
		if err != nil {
			return hits, err
		}
		collect(res)
	}

	// 4. Shoe x Heat durability long runs
	if hasAny(topics, "shoes", "heat") {
		res, err := aura.Query(c, `
			MATCH (s:Session)-[:IN_WEATHER]->(w:Weather)
			WHERE s.distance_m >= 16000 AND w.wbgt >= 26.0
			OPTIONAL MATCH (s)-[:PRODUCED]->(m:Memory)
			RETURN s.label_id, m.id ORDER BY s.date DESC LIMIT 5`, nil)
		if err != nil {
			return hits, err
		}
		collect(res)
	}

	return hits, nil
}
