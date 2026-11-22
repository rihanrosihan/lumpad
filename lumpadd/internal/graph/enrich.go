package graph

import (
	"context"
	"encoding/json"
	"fmt"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/rihanrosihan/lumpad/lumpadd/internal/athlete"
)

// Enrichment of the knowledge graph (audit follow-up): topics that tie the knowledge base to training, strength→run chains, heat bands,
// coach-run provenance and plan-vs-actual. Everything here is DERIVED, so each sync deletes the old derived edges and rebuilds them (nothing goes stale).
// No health data: pain, sleep and HRV stay out unless the owner opts in elsewhere.

type topicDef struct {
	ID, Name string
	re       *regexp.Regexp
}

var topicDefs = []topicDef{
	{"heat", "Heat & humidity", regexp.MustCompile(`(?i)\b(heat|panas|wbgt|humid\w*|hot|dehydrat\w*|acclimat\w*|flag protocol)\b`)},
	{"fueling", "Fuelling & hydration", regexp.MustCompile(`(?i)\b(fuel\w*|gel|gels|carb\w*|nutrition|caffeine|hydrat\w*|salt|electrolyte\w*|stomach|breakfast|gi flush)\b`)},
	{"recovery", "Sleep, HRV & recovery", regexp.MustCompile(`(?i)\b(hrv|sleep|recovery|readiness|resting heart|rhr)\b`)},
	{"durability", "Durability & fade", regexp.MustCompile(`(?i)\b(durab\w*|fade|run.?share|walk\w*|cadence|gct|stride|late.run|long run)\b`)},
	{"pacing", "Pacing & race strategy", regexp.MustCompile(`(?i)\b(pacing|opening|negative split|marathon pace|run-walk|cut-?off|go/no-go)\b`)},
	{"strength", "Strength & gym", regexp.MustCompile(`(?i)\b(gym|strength|squat\w*|calf|leg day|lower body|plyo\w*|unilateral)\b`)},
	{"injury", "Injury & pain history", regexp.MustCompile(`(?i)\b(tibia\w*|mtss|plantar|achilles|vmo|injur\w*|pain)\b`)},
	{"shoes", "Shoes & mileage", regexp.MustCompile(`(?i)\b(shoe\w*|sepatu|foam|plated)\b`)},
	{"load", "Training load & volume", regexp.MustCompile(`(?i)\b(training load|ctl|atl|tsb|volume|mileage|weekly km|load guard|taper)\b`)},
	{"race", "Races & targets", regexp.MustCompile(`(?i)\b(race|marathon|jakim|jrf|borobudur|bib|sub-?4|checkpoint)\b`)},
}

// topicsOf returns up to three topic ids for a text, strongest (most keyword hits) first; ties keep the list order, so it is deterministic.
func topicsOf(text string) []string {
	type hit struct {
		id string
		n  int
		i  int
	}
	var hits []hit
	for i, t := range topicDefs {
		if n := len(t.re.FindAllStringIndex(text, -1)); n > 0 {
			hits = append(hits, hit{t.ID, n, i})
		}
	}
	sort.SliceStable(hits, func(a, b int) bool { return hits[a].n > hits[b].n })
	out := []string{}
	for _, h := range hits {
		if len(out) == 3 {
			break
		}
		out = append(out, h.id)
	}
	return out
}

var lowerBody = regexp.MustCompile(`(?i)lower|leg|squat|deadlift|kaki|glute`)

// SyncEnrich runs after the core projection (memRows = the projected memories, sessRows = the projected sessions).
func SyncEnrich(ctx context.Context, pool *pgxpool.Pool, aura *Client, redact func(string) string, memRows, sessRows []map[string]any, st *SyncStats) error {
	for _, c := range []string{
		"CREATE CONSTRAINT topic_id IF NOT EXISTS FOR (t:Topic) REQUIRE t.id IS UNIQUE",
		"CREATE CONSTRAINT workout_id IF NOT EXISTS FOR (w:Workout) REQUIRE w.id IS UNIQUE",
		"CREATE CONSTRAINT heatband_name IF NOT EXISTS FOR (b:HeatBand) REQUIRE b.name IS UNIQUE",
		"CREATE CONSTRAINT coachrun_id IF NOT EXISTS FOR (c:CoachRun) REQUIRE c.id IS UNIQUE",
	} {
		if _, err := aura.Query(ctx, c, nil); err != nil {
			return fmt.Errorf("enrich constraint: %w", err)
		}
	}
	// derived edges are rebuilt from scratch
	for _, q := range []string{
		`MATCH ()-[r:ABOUT]->() DELETE r`, `MATCH ()-[r:PRECEDED]->() DELETE r`, `MATCH ()-[r:IN_BAND]->() DELETE r`,
		`MATCH ()-[r:RETRIEVED]->() DELETE r`, `MATCH ()-[r:CITED]->() DELETE r`, `MATCH ()-[r:WRITTEN_BY]->() DELETE r`,
		`MATCH ()-[r:REVIEWED]->() DELETE r`, `MATCH ()-[r:EXECUTED_AS]->() DELETE r`,
	} {
		if _, err := aura.Query(ctx, q, nil); err != nil {
			return fmt.Errorf("enrich reset: %w", err)
		}
	}

	// 1. Topics: tie memories (knowledge base, findings, rules) and sessions to the same vocabulary
	var tRows []map[string]any
	for _, t := range topicDefs {
		tRows = append(tRows, map[string]any{"id": t.ID, "name": t.Name})
	}
	if err := runBatches(ctx, aura, tRows, 50, `UNWIND $rows AS r MERGE (t:Topic {id: r.id}) SET t.name = r.name`); err != nil {
		return fmt.Errorf("topics: %w", err)
	}
	var links []map[string]any
	for _, m := range memRows {
		title, _ := m["title"].(string)
		body, _ := m["body"].(string)
		id, _ := m["id"].(int64)
		for _, tid := range topicsOf(title + " " + body) {
			links = append(links, map[string]any{"id": id, "topic": tid})
		}
	}
	if err := runBatches(ctx, aura, links, 300, `UNWIND $rows AS r MATCH (m:Memory {id: r.id}), (t:Topic {id: r.topic}) MERGE (m)-[:ABOUT]->(t)`); err != nil {
		return fmt.Errorf("memory topics: %w", err)
	}
	st.TopicLinks = len(links)
	var sl []map[string]any
	for _, s := range sessRows {
		lid, _ := s["label_id"].(string)
		if b, _ := s["flag_band"].(string); b == "ORANGE" || b == "RED" || b == "BLACK" {
			sl = append(sl, map[string]any{"id": lid, "topic": "heat"})
		}
		if d, _ := s["distance_m"].(float64); d >= 16000 {
			sl = append(sl, map[string]any{"id": lid, "topic": "durability"})
		}
	}
	if err := runBatches(ctx, aura, sl, 300, `UNWIND $rows AS r MATCH (s:Session {label_id: r.id}), (t:Topic {id: r.topic}) MERGE (s)-[:ABOUT]->(t)`); err != nil {
		return fmt.Errorf("session topics: %w", err)
	}
	st.TopicLinks += len(sl)
	if _, err := aura.Query(ctx, `MATCH (s:Session)-[:ATTEMPT_OF]->(:Race) MATCH (t:Topic {id:'race'}) MERGE (s)-[:ABOUT]->(t)`, nil); err != nil {
		return fmt.Errorf("race topic: %w", err)
	}

	// 2. Workouts (everything that is not a run) and heat bands
	var wRows []map[string]any
	if rows, err := pool.Query(ctx, `SELECT id, COALESCE(sport,''), COALESCE(to_char(date,'YYYY-MM-DD'),''), COALESCE(name,''), COALESCE(duration_s,0), training_load FROM train.activity WHERE source='coros' AND sport <> 'Run'`); err == nil {
		for rows.Next() {
			var id, sport, dt, name string
			var dur float64
			var tl *float64
			if rows.Scan(&id, &sport, &dt, &name, &dur, &tl) == nil && dt != "" {
				wRows = append(wRows, map[string]any{"id": id, "sport": sport, "date": dt, "name": redact(name), "minutes": int(dur / 60), "tl": tl,
					"strength": sport == "Strength" || sport == "WeightTraining", "lower": lowerBody.MatchString(name)})
			}
		}
		rows.Close()
	}
	if err := runBatches(ctx, aura, wRows, 150, `
		UNWIND $rows AS r
		MERGE (w:Workout {id: r.id})
		SET w.sport = r.sport, w.date = r.date, w.name = r.name, w.minutes = r.minutes, w.tl = r.tl, w.strength = r.strength, w.lower = r.lower
		MERGE (d:Day {date: r.date})
		MERGE (d)-[:HAS_WORKOUT]->(w)`); err != nil {
		return fmt.Errorf("workouts: %w", err)
	}
	st.Workouts = len(wRows)
	// strength within the 72 h BEFORE a run: the cause→effect chain the coach reasons about (hours = gap)
	var chain []map[string]any
	if rows, err := pool.Query(ctx, `
		SELECT a.id, s.label_id, ROUND(((s.start_ms/1000.0 - a.start_ts)/3600.0)::numeric, 1)::float8
		FROM train.activity a JOIN train.session_metric s ON s.start_ms/1000.0 > a.start_ts AND s.start_ms/1000.0 - a.start_ts <= 259200
		WHERE a.source='coros' AND a.sport IN ('Strength','WeightTraining') AND a.start_ts IS NOT NULL`); err == nil {
		for rows.Next() {
			var wid, lid string
			var hrs float64
			if rows.Scan(&wid, &lid, &hrs) == nil {
				chain = append(chain, map[string]any{"w": wid, "s": lid, "hours": hrs})
			}
		}
		rows.Close()
	}
	if err := runBatches(ctx, aura, chain, 200, `UNWIND $rows AS r MATCH (w:Workout {id: r.w}), (s:Session {label_id: r.s}) MERGE (w)-[p:PRECEDED]->(s) SET p.hours = r.hours`); err != nil {
		return fmt.Errorf("strength chain: %w", err)
	}
	st.Chains = len(chain)
	if _, err := aura.Query(ctx, `MATCH (:Workout {strength: true})-[:PRECEDED]->(s:Session) MATCH (t:Topic {id:'strength'}) MERGE (s)-[:ABOUT]->(t)`, nil); err != nil {
		return fmt.Errorf("strength topic: %w", err)
	}
	if _, err := aura.Query(ctx, `MATCH (w:Weather) WHERE w.flag_band IS NOT NULL AND w.flag_band <> '' MERGE (b:HeatBand {name: w.flag_band}) MERGE (w)-[:IN_BAND]->(b)`, nil); err != nil {
		return fmt.Errorf("heat bands: %w", err)
	}

	// 3. Coach provenance: which run retrieved / cited / wrote which memory, and which session it reviewed
	type runRow struct {
		id                   int64
		intent, at, model, q string
		ctx, parsed          string
		cost                 *float64
	}
	var runs []runRow
	if rows, err := pool.Query(ctx, `SELECT id, COALESCE(intent,''), COALESCE(created_at,''), COALESCE(model,''), COALESCE(question,''), COALESCE(context_ids,'[]'), COALESCE(parsed,''), cost_cny FROM coach.run WHERE ok = 1 AND provider <> 'safety'`); err == nil {
		for rows.Next() {
			var r runRow
			if rows.Scan(&r.id, &r.intent, &r.at, &r.model, &r.q, &r.ctx, &r.parsed, &r.cost) == nil {
				runs = append(runs, r)
			}
		}
		rows.Close()
	}
	var cRows, retr, cited, rev []map[string]any
	var ids []int64
	for _, r := range runs {
		day := r.at
		if len(day) >= 10 {
			day = day[:10]
		}
		cRows = append(cRows, map[string]any{"id": r.id, "intent": r.intent, "day": day, "model": r.model, "cost": r.cost})
		ids = append(ids, r.id)
		var cx []int64
		_ = json.Unmarshal([]byte(r.ctx), &cx)
		for _, m := range cx {
			retr = append(retr, map[string]any{"run": r.id, "mem": m})
		}
		var p struct {
			Cited []int64 `json:"cited_ids"`
		}
		_ = json.Unmarshal([]byte(r.parsed), &p)
		for _, m := range p.Cited {
			cited = append(cited, map[string]any{"run": r.id, "mem": m})
		}
		if strings.HasPrefix(r.q, "session ") {
			rev = append(rev, map[string]any{"run": r.id, "s": strings.TrimSpace(strings.TrimPrefix(r.q, "session "))})
		}
	}
	if err := runBatches(ctx, aura, cRows, 100, `UNWIND $rows AS r MERGE (c:CoachRun {id: r.id}) SET c.intent = r.intent, c.day = r.day, c.model = r.model, c.cost_cny = r.cost`); err != nil {
		return fmt.Errorf("coach runs: %w", err)
	}
	if _, err := aura.Query(ctx, `MATCH (c:CoachRun) WHERE NOT c.id IN $ids DETACH DELETE c`, map[string]any{"ids": ids}); err != nil {
		return fmt.Errorf("prune coach runs: %w", err)
	}
	for _, q := range []struct {
		rows   []map[string]any
		cypher string
	}{
		{retr, `UNWIND $rows AS r MATCH (c:CoachRun {id: r.run}), (m:Memory {id: r.mem}) MERGE (c)-[:RETRIEVED]->(m)`},
		{cited, `UNWIND $rows AS r MATCH (c:CoachRun {id: r.run}), (m:Memory {id: r.mem}) MERGE (c)-[:CITED]->(m)`},
		{rev, `UNWIND $rows AS r MATCH (c:CoachRun {id: r.run}), (s:Session {label_id: r.s}) MERGE (c)-[:REVIEWED]->(s)`},
	} {
		if err := runBatches(ctx, aura, q.rows, 300, q.cypher); err != nil {
			return fmt.Errorf("coach trace: %w", err)
		}
	}
	var wb []map[string]any
	if rows, err := pool.Query(ctx, `SELECT id, COALESCE(payload,'') FROM memory.item WHERE source='coach' AND status IN ('active','candidate','proposal')`); err == nil {
		for rows.Next() {
			var id int64
			var payload string
			var p struct {
				Run int64 `json:"run"`
			}
			if rows.Scan(&id, &payload) == nil && json.Unmarshal([]byte(payload), &p) == nil && p.Run > 0 {
				wb = append(wb, map[string]any{"run": p.Run, "mem": id})
			}
		}
		rows.Close()
	}
	if err := runBatches(ctx, aura, wb, 200, `UNWIND $rows AS r MATCH (c:CoachRun {id: r.run}), (m:Memory {id: r.mem}) MERGE (m)-[:WRITTEN_BY]->(c)`); err != nil {
		return fmt.Errorf("written by: %w", err)
	}
	st.CoachRuns = len(cRows)
	st.TraceEdges = len(retr) + len(cited) + len(rev) + len(wb)

	// 4. Plan vs actual: the season plan (embedded) for a rolling window, linked to the sessions actually done that day
	wib := time.Now().In(time.FixedZone("WIB", 7*3600))
	lo, hi := wib.AddDate(0, 0, -14).Format("2006-01-02"), wib.AddDate(0, 0, 35).Format("2006-01-02")
	var pRows []map[string]any
	var dates []string
	for _, d := range athlete.Plan {
		if d.Date >= lo && d.Date <= hi {
			pRows = append(pRows, map[string]any{"date": d.Date, "week": d.Week, "phase": d.Phase, "kind": d.Kind, "label": d.Label, "km": d.Km, "tl": d.TL})
			dates = append(dates, d.Date)
		}
	}
	if err := runBatches(ctx, aura, pRows, 100, `UNWIND $rows AS r MERGE (p:PlanDay {date: r.date}) SET p.src = 'plan', p.week = r.week, p.phase = r.phase, p.kind = r.kind, p.label = r.label, p.planned_km = r.km, p.planned_tl = r.tl MERGE (d:Day {date: r.date}) MERGE (p)-[:PLANS]->(d)`); err != nil {
		return fmt.Errorf("plan window: %w", err)
	}
	if _, err := aura.Query(ctx, `MATCH (p:PlanDay {src:'plan'}) WHERE NOT p.date IN $dates DETACH DELETE p`, map[string]any{"dates": dates}); err != nil {
		return fmt.Errorf("prune plan: %w", err)
	}
	if _, err := aura.Query(ctx, `MATCH (p:PlanDay {src:'plan'}), (s:Session) WHERE s.date = p.date AND p.kind <> 'rest' MERGE (p)-[:EXECUTED_AS]->(s)`, nil); err != nil {
		return fmt.Errorf("executed as: %w", err)
	}
	st.PlanDaysWindow = len(pRows)
	return nil
}
