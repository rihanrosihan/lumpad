package graph

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"os"
	"sort"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Idempotent, PII-redacted PostgreSQL 16 -> Neo4j AuraDB Knowledge Graph projector.
// Never syncs raw GPS coordinates (lat1/lon1) or unredacted PII strings.

type SyncStats struct {
	Days           int `json:"days"`
	Sessions       int `json:"sessions"`
	Shoes          int `json:"shoes"`
	Races          int `json:"races"`
	PainLinks      int `json:"pain_links"`
	Rules          int `json:"rules"`
	Memories       int `json:"memories"`
	Decisions      int `json:"decisions"`
	PlanDays       int `json:"plan_days"`
	SimilarEdges   int `json:"similar_edges"`
	ConflictEdges  int `json:"conflict_edges"`
	TopicLinks     int `json:"topic_links"`
	Workouts       int `json:"workouts"`
	Chains         int `json:"strength_chains"`
	CoachRuns      int `json:"coach_runs"`
	TraceEdges     int `json:"trace_edges"`
	PlanDaysWindow int `json:"plan_days_window"`
}

type OverviewStats struct {
	Nodes map[string]int64 `json:"nodes"`
	Edges map[string]int64 `json:"edges"`
}

// WBGTBand maps WBGT °C to the official JRF 2026 Flag Protocol bands.
func WBGTBand(wbgt float64) string {
	switch {
	case wbgt >= 32.3:
		return "BLACK"
	case wbgt >= 27.9:
		return "RED"
	case wbgt >= 25.7:
		return "ORANGE"
	case wbgt >= 22.3:
		return "YELLOW"
	default:
		return "GREEN"
	}
}

var canonicalRaces = []map[string]any{
	{"race_id": "milo-2024", "date": "2024-12-08", "name": "Milo ACTIV 2024", "class": "HISTORY", "dist_km": 10.0, "status": "Finish"},
	{"race_id": "soekarno-2025", "date": "2025-01-12", "name": "Soekarno Run 10K", "class": "HISTORY", "dist_km": 10.0, "status": "Finish"},
	{"race_id": "lps-hm-2025", "date": "2025-06-15", "name": "LPS Monas HM 2025", "class": "HISTORY", "dist_km": 21.1, "status": "Finish"},
	{"race_id": "jrf-hm-2025", "date": "2025-10-25", "name": "JRF HM 2025", "class": "HISTORY", "dist_km": 21.1, "status": "Finish"},
	{"race_id": "milo-2025", "date": "2025-12-07", "name": "Milo Active Race 10K 2025", "class": "HISTORY", "dist_km": 10.0, "status": "Finish"},
	{"race_id": "jakim-fm-2026", "date": "2026-06-14", "name": "BTN Jakim FM 2026", "class": "HISTORY", "dist_km": 42.195, "status": "Finish", "bib": "44708", "net_s": 24783},
	{"race_id": "hs-10k-2026", "date": "2026-07-26", "name": "Head & Shoulders 10K PB", "class": "HISTORY", "dist_km": 10.0, "status": "PB", "net_s": 3655},
	{"race_id": "milo-2026", "date": "2026-09-13", "name": "MILO ACTIV 10K 2026", "class": "HISTORY", "dist_km": 10.0, "status": "Finish"},
	{"race_id": "jrf-hm-2026", "date": "2026-10-24", "name": "myBCA JRF HM 2026", "class": "HISTORY", "dist_km": 21.1, "status": "Finish", "bib": "B24456", "net_s": 11232},
	{"race_id": "jrf-fm-2026", "date": "2026-10-25", "name": "myBCA JRF FM 2026", "class": "HISTORY", "dist_km": 42.195, "status": "DNF", "bib": "B13144"},
	{"race_id": "borobudur-2026", "date": "2026-11-15", "name": "Bank Jateng Borobudur FM 2026", "class": "HISTORY", "dist_km": 42.195, "status": "QRY (Black Flag)", "bib": "B13718"},
	{"race_id": "jakim-fm-2027", "date": "2027-06-13", "name": "Jakim FM 2027", "class": "B-RACE", "dist_km": 42.195, "status": "Registered"},
	{"race_id": "mjm-fm-2027", "date": "2027-06-20", "name": "Mandiri Jogja Marathon 2027", "class": "C-RACE", "dist_km": 42.195, "status": "Planned (Gated)"},
	{"race_id": "jrf-fm-2027", "date": "2027-10-24", "name": "myBCA JRF 2027 (Sub-4 A-Race)", "class": "A-RACE", "dist_km": 42.195, "status": "Target Sub-4:00"},
	{"race_id": "bormar-2027", "date": "2027-11-14", "name": "Borobudur FM 2027", "class": "PLAN", "dist_km": 42.195, "status": "Planned"},
}

func runBatches(ctx context.Context, aura *Client, rows []map[string]any, batchSize int, cypher string) error {
	for i := 0; i < len(rows); i += batchSize {
		end := i + batchSize
		if end > len(rows) {
			end = len(rows)
		}
		if _, err := aura.Query(ctx, cypher, map[string]any{"rows": rows[i:end]}); err != nil {
			return err
		}
	}
	return nil
}

// SyncAll projects all core Lumpad PostgreSQL 16 entities and relationships into AuraDB idempotently.
func SyncAll(ctx context.Context, pool *pgxpool.Pool, aura *Client, redact func(string) string) (SyncStats, error) {
	var st SyncStats
	if redact == nil {
		redact = func(s string) string { return s }
	}

	// 1. Constraints (idempotent)
	constraints := []string{
		"CREATE CONSTRAINT day_date IF NOT EXISTS FOR (d:Day) REQUIRE d.date IS UNIQUE",
		"CREATE CONSTRAINT session_lid IF NOT EXISTS FOR (s:Session) REQUIRE s.label_id IS UNIQUE",
		"CREATE CONSTRAINT shoe_id IF NOT EXISTS FOR (sh:Shoe) REQUIRE sh.gear_id IS UNIQUE",
		"CREATE CONSTRAINT pain_site IF NOT EXISTS FOR (p:PainSite) REQUIRE p.site IS UNIQUE",
		"CREATE CONSTRAINT race_id IF NOT EXISTS FOR (r:Race) REQUIRE r.race_id IS UNIQUE",
		"CREATE CONSTRAINT memory_id IF NOT EXISTS FOR (m:Memory) REQUIRE m.id IS UNIQUE",
		"CREATE CONSTRAINT rule_id IF NOT EXISTS FOR (r:Rule) REQUIRE r.id IS UNIQUE",
		"CREATE CONSTRAINT decision_id IF NOT EXISTS FOR (d:Decision) REQUIRE d.id IS UNIQUE",
		"CREATE CONSTRAINT planday_date IF NOT EXISTS FOR (p:PlanDay) REQUIRE p.date IS UNIQUE",
	}
	for _, c := range constraints {
		if _, err := aura.Query(ctx, c, nil); err != nil {
			return st, fmt.Errorf("constraint: %w", err)
		}
	}

	// 2. Shoes (train.gear)
	var shoeRows []map[string]any
	if rows, err := pool.Query(ctx, `SELECT id, COALESCE(name,''), COALESCE(distance_m,0), COALESCE(retired,0) FROM train.gear`); err == nil {
		for rows.Next() {
			var id, name string
			var distM float64
			var ret int64
			if rows.Scan(&id, &name, &distM, &ret) == nil {
				shoeRows = append(shoeRows, map[string]any{"gear_id": id, "model": redact(name), "km_total": distM / 1000.0, "retired": ret != 0})
			}
		}
		rows.Close()
	}
	if err := runBatches(ctx, aura, shoeRows, 100, `
		UNWIND $rows AS r
		MERGE (sh:Shoe {gear_id: r.gear_id})
		SET sh.model = r.model, sh.km_total = r.km_total, sh.retired = r.retired`); err != nil {
		return st, fmt.Errorf("shoes: %w", err)
	}
	st.Shoes = len(shoeRows)

	// Health data (sleep, HRV, resting HR, pain, how you feel) is personal medical data and goes to the third-party cloud graph only when the
	// owner opts in with NEO4J_SYNC_HEALTH=1. Off (default): those properties and the pain links are removed from the graph below.
	withHealth := os.Getenv("NEO4J_SYNC_HEALTH") == "1"

	// 3. Days (analytics.daily_feat + temporal NEXT_DAY chain)
	var dayRows []map[string]any
	if rows, err := pool.Query(ctx, `
		SELECT to_char(date,'YYYY-MM-DD'), COALESCE(run_km,0), COALESCE(tl,0), COALESCE(strength_lower,0),
		       sleep_min, sleep_hr, hrv, rhr, wbgt, pain_max, feel
		FROM analytics.daily_feat ORDER BY date ASC`); err == nil {
		for rows.Next() {
			var dt string
			var rkm, tl float64
			var sLow int64
			var sleepMin, sleepHR, hrv, rhr, wbgt, painMax, feel *float64
			if rows.Scan(&dt, &rkm, &tl, &sLow, &sleepMin, &sleepHR, &hrv, &rhr, &wbgt, &painMax, &feel) == nil {
				row := map[string]any{"date": dt, "run_km": rkm, "tl": tl, "strength_lower": sLow, "wbgt": wbgt}
				if withHealth {
					row["sleep_min"], row["sleep_hr"], row["hrv"], row["rhr"], row["pain_max"], row["feel"] = sleepMin, sleepHR, hrv, rhr, painMax, feel
				}
				dayRows = append(dayRows, row)
			}
		}
		rows.Close()
	}
	daySet := `d.run_km = r.run_km, d.tl = r.tl, d.strength_lower = r.strength_lower, d.wbgt = r.wbgt`
	if withHealth {
		daySet += `, d.sleep_min = r.sleep_min, d.sleep_hr = r.sleep_hr, d.hrv = r.hrv, d.rhr = r.rhr, d.pain_max = r.pain_max, d.feel = r.feel`
	}
	if err := runBatches(ctx, aura, dayRows, 150, "UNWIND $rows AS r MERGE (d:Day {date: r.date}) SET "+daySet); err != nil {
		return st, fmt.Errorf("days: %w", err)
	}
	if !withHealth { // remove what an earlier sync may have put there
		if _, err := aura.Query(ctx, `MATCH (d:Day) REMOVE d.sleep_min, d.sleep_hr, d.hrv, d.rhr, d.pain_max, d.feel`, nil); err != nil {
			return st, fmt.Errorf("purge health props: %w", err)
		}
	}
	st.Days = len(dayRows)
	// Link consecutive Day nodes
	if len(dayRows) > 1 {
		var links []map[string]any
		for i := 1; i < len(dayRows); i++ {
			links = append(links, map[string]any{"a": dayRows[i-1]["date"], "b": dayRows[i]["date"]})
		}
		if err := runBatches(ctx, aura, links, 200, `
			UNWIND $rows AS r
			MATCH (a:Day {date: r.a}), (b:Day {date: r.b})
			MERGE (a)-[:NEXT_DAY]->(b)`); err != nil {
			return st, fmt.Errorf("next_day: %w", err)
		}
	}

	// 4. Sessions + Weather + Shoe links (NO GPS coordinates)
	var sessRows []map[string]any
	if rows, err := pool.Query(ctx, `
		SELECT s.label_id, COALESCE(to_char(s.date,'YYYY-MM-DD'),''), COALESCE(s.sport,'run'),
		       COALESCE(s.distance_m,0), COALESCE(s.elapsed_s,0), s.run_share, s.ef, s.run_hr,
		       s.drift_pahr, s.gct_fade, s.stride_fade, s.hr800, s.onset_km, s.tl, COALESCE(s.shoe_id,''),
		       COALESCE(w.indoor,0), w.temp_c, w.rh, w.wbgt
		FROM train.session_metric s
		LEFT JOIN train.run_weather w ON w.label_id = s.label_id`); err == nil {
		for rows.Next() {
			var lid, dt, sport, shoeID string
			var distM, elapS float64
			var indoor int64
			var runShare, ef, runHR, drift, gctFade, strFade, hr800, onsetKm, tl, tempC, rh, wbgt *float64
			if rows.Scan(&lid, &dt, &sport, &distM, &elapS, &runShare, &ef, &runHR, &drift, &gctFade, &strFade, &hr800, &onsetKm, &tl, &shoeID, &indoor, &tempC, &rh, &wbgt) == nil {
				band := ""
				if wbgt != nil && indoor == 0 {
					band = WBGTBand(*wbgt)
				}
				sessRows = append(sessRows, map[string]any{
					"label_id": lid, "date": dt, "sport": sport, "distance_m": distM, "elapsed_s": elapS,
					"run_share": runShare, "ef": ef, "run_hr": runHR, "drift_pahr": drift, "gct_fade": gctFade,
					"stride_fade": strFade, "hr800": hr800, "onset_km": onsetKm, "tl": tl, "shoe_id": shoeID,
					"indoor": indoor != 0, "temp_c": tempC, "rh": rh, "wbgt": wbgt, "flag_band": band,
				})
			}
		}
		rows.Close()
	}
	if err := runBatches(ctx, aura, sessRows, 100, `
		UNWIND $rows AS r
		MERGE (s:Session {label_id: r.label_id})
		SET s.date = r.date, s.sport = r.sport, s.distance_m = r.distance_m, s.elapsed_s = r.elapsed_s,
		    s.run_share = r.run_share, s.ef = r.ef, s.run_hr = r.run_hr, s.drift_pahr = r.drift_pahr,
		    s.gct_fade = r.gct_fade, s.stride_fade = r.stride_fade, s.hr800 = r.hr800,
		    s.onset_km = r.onset_km, s.tl = r.tl
		WITH s, r
		FOREACH (_ IN CASE WHEN r.date <> '' THEN [1] ELSE [] END |
			MERGE (d:Day {date: r.date})
			MERGE (d)-[:HAS_SESSION]->(s)
		)
		FOREACH (_ IN CASE WHEN r.shoe_id <> '' THEN [1] ELSE [] END |
			MERGE (sh:Shoe {gear_id: r.shoe_id})
			MERGE (s)-[:WORE]->(sh)
		)
		FOREACH (_ IN CASE WHEN r.wbgt IS NOT NULL OR r.indoor THEN [1] ELSE [] END |
			MERGE (w:Weather {label_id: r.label_id})
			SET w.indoor = r.indoor, w.temp_c = r.temp_c, w.rh = r.rh, w.wbgt = r.wbgt, w.flag_band = r.flag_band
			MERGE (s)-[:IN_WEATHER]->(w)
		)`); err != nil {
		return st, fmt.Errorf("sessions: %w", err)
	}
	st.Sessions = len(sessRows)

	// 5. PainSites from health.checkin (opt-in only; otherwise any earlier pain links are deleted)
	var painRows []map[string]any
	if !withHealth {
		if _, err := aura.Query(ctx, `MATCH ()-[r:LOGGED_PAIN]->() DELETE r`, nil); err != nil {
			return st, fmt.Errorf("purge pain links: %w", err)
		}
		if _, err := aura.Query(ctx, `MATCH (p:PainSite) WHERE NOT (p)--() DELETE p`, nil); err != nil {
			return st, fmt.Errorf("purge pain sites: %w", err)
		}
	} else if rows, err := pool.Query(ctx, `SELECT to_char(date,'YYYY-MM-DD'), COALESCE(pain,'{}') FROM health.checkin WHERE pain IS NOT NULL`); err == nil {
		for rows.Next() {
			var dt, pjson string
			if rows.Scan(&dt, &pjson) == nil {
				pm := map[string]float64{}
				if json.Unmarshal([]byte(pjson), &pm) == nil {
					for site, sc := range pm {
						if sc > 0 {
							painRows = append(painRows, map[string]any{"date": dt, "site": strings.ToLower(strings.TrimSpace(site)), "score": sc})
						}
					}
				}
			}
		}
		rows.Close()
	}
	if err := runBatches(ctx, aura, painRows, 100, `
		UNWIND $rows AS r
		MERGE (d:Day {date: r.date})
		MERGE (p:PainSite {site: r.site})
		MERGE (d)-[rel:LOGGED_PAIN]->(p)
		SET rel.score = r.score`); err != nil {
		return st, fmt.Errorf("pain: %w", err)
	}
	st.PainLinks = len(painRows)

	// 6. Canonical Races + ATTEMPT_OF links by date
	if err := runBatches(ctx, aura, canonicalRaces, 50, `
		UNWIND $rows AS r
		MERGE (rc:Race {race_id: r.race_id})
		SET rc.date = r.date, rc.name = r.name, rc.class = r.class, rc.dist_km = r.dist_km,
		    rc.status = r.status, rc.bib = r.bib, rc.net_s = r.net_s
		WITH rc, r
		OPTIONAL MATCH (s:Session {date: r.date})
		FOREACH (_ IN CASE WHEN s IS NOT NULL THEN [1] ELSE [] END |
			MERGE (s)-[:ATTEMPT_OF]->(rc)
		)`); err != nil {
		return st, fmt.Errorf("races: %w", err)
	}
	st.Races = len(canonicalRaces)

	// 7. Rules & Memories (redacted, with PRODUCED and SUPERSEDES links)
	var ruleRows, memRows []map[string]any
	if rows, err := pool.Query(ctx, `
		SELECT id, COALESCE(tier,''), COALESCE(kind,''), COALESCE(title,''), COALESCE(body,''),
		       COALESCE(evidence_tag,''), COALESCE(status,''), COALESCE(locked,0), supersedes,
		       valid_from, valid_to, COALESCE(source,''), COALESCE(source_ref,'')
		FROM memory.item WHERE status = 'active' OR (tier = 'procedural' AND status = 'proposal')`); err == nil {
		for rows.Next() {
			var id, locked int64
			var tier, kind, title, body, tag, status, src, ref string
			var sup *int64
			var vf, vt *string
			if rows.Scan(&id, &tier, &kind, &title, &body, &tag, &status, &locked, &sup, &vf, &vt, &src, &ref) == nil {
				row := map[string]any{
					"id": id, "tier": tier, "kind": kind, "title": redact(title), "body": redact(body),
					"evidence_tag": tag, "status": status, "locked": locked != 0, "supersedes": sup,
					"valid_from": vf, "valid_to": vt, "source": src, "source_ref": ref,
				}
				if tier == "procedural" {
					ruleRows = append(ruleRows, row)
				} else {
					memRows = append(memRows, row)
				}
			}
		}
		rows.Close()
	}
	if err := runBatches(ctx, aura, ruleRows, 50, `
		UNWIND $rows AS r
		MERGE (rl:Rule {id: r.id})
		SET rl.title = r.title, rl.body = r.body, rl.evidence_tag = r.evidence_tag, rl.locked = r.locked, rl.status = r.status`); err != nil {
		return st, fmt.Errorf("rules: %w", err)
	}
	st.Rules = len(ruleRows)

	if err := runBatches(ctx, aura, memRows, 100, `
		UNWIND $rows AS r
		MERGE (m:Memory {id: r.id})
		SET m.tier = r.tier, m.kind = r.kind, m.title = r.title, m.evidence_tag = r.evidence_tag,
		    m.status = r.status, m.valid_from = r.valid_from, m.valid_to = r.valid_to, m.source = r.source
		WITH m, r
		FOREACH (_ IN CASE WHEN r.source = 'fit' AND r.source_ref <> '' THEN [1] ELSE [] END |
			MERGE (s:Session {label_id: r.source_ref})
			MERGE (s)-[:PRODUCED]->(m)
		)
		FOREACH (_ IN CASE WHEN r.supersedes IS NOT NULL THEN [1] ELSE [] END |
			MERGE (old:Memory {id: r.supersedes})
			MERGE (m)-[:SUPERSEDES]->(old)
		)`); err != nil {
		return st, fmt.Errorf("memories: %w", err)
	}
	st.Memories = len(memRows)
	// prune: a memory or rule that is no longer active in PostgreSQL must not stay in the graph (graph hops could return retracted knowledge)
	memIDs, ruleIDs := make([]int64, 0, len(memRows)), make([]int64, 0, len(ruleRows))
	for _, r := range memRows {
		if id, ok := r["id"].(int64); ok {
			memIDs = append(memIDs, id)
		}
	}
	for _, r := range ruleRows {
		if id, ok := r["id"].(int64); ok {
			ruleIDs = append(ruleIDs, id)
		}
	}
	if _, err := aura.Query(ctx, `MATCH (m:Memory) WHERE NOT m.id IN $ids DETACH DELETE m`, map[string]any{"ids": memIDs}); err != nil {
		return st, fmt.Errorf("prune memories: %w", err)
	}
	if _, err := aura.Query(ctx, `MATCH (r:Rule) WHERE NOT r.id IN $ids DETACH DELETE r`, map[string]any{"ids": ruleIDs}); err != nil {
		return st, fmt.Errorf("prune rules: %w", err)
	}

	// 8. Decisions (coach.decision) — graceful no-op when empty
	var decRows []map[string]any
	if rows, err := pool.Query(ctx, `
		SELECT id, source, COALESCE(to_char(scope_from,'YYYY-MM-DD'),''), COALESCE(reason,''), status, COALESCE(verdict,'')
		FROM coach.decision`); err == nil {
		for rows.Next() {
			var id int64
			var src, sf, reason, status, verdict string
			if rows.Scan(&id, &src, &sf, &reason, &status, &verdict) == nil {
				decRows = append(decRows, map[string]any{"id": id, "source": src, "scope_from": sf, "reason": redact(reason), "status": status, "verdict": verdict})
			}
		}
		rows.Close()
	}
	if err := runBatches(ctx, aura, decRows, 100, `
		UNWIND $rows AS r
		MERGE (d:Decision {id: r.id})
		SET d.source = r.source, d.scope_from = r.scope_from, d.reason = r.reason, d.status = r.status, d.verdict = r.verdict`); err != nil {
		return st, fmt.Errorf("decisions: %w", err)
	}
	st.Decisions = len(decRows)

	// 9. PlanDays (plan.day + plan.adherence) — graceful no-op when empty
	var pdRows []map[string]any
	if rows, err := pool.Query(ctx, `
		SELECT to_char(p.date,'YYYY-MM-DD'), COALESCE(p.phase,''), COALESCE(p.kind,''), COALESCE(p.km,0), a.score
		FROM plan.day p LEFT JOIN plan.adherence a ON a.date = p.date`); err == nil {
		for rows.Next() {
			var dt, phase, kind string
			var km float64
			var score *float64
			if rows.Scan(&dt, &phase, &kind, &km, &score) == nil {
				pdRows = append(pdRows, map[string]any{"date": dt, "phase": phase, "kind": kind, "planned_km": km, "adherence_score": score})
			}
		}
		rows.Close()
	}
	if err := runBatches(ctx, aura, pdRows, 150, `
		UNWIND $rows AS r
		MERGE (p:PlanDay {date: r.date})
		SET p.phase = r.phase, p.kind = r.kind, p.planned_km = r.planned_km, p.adherence_score = r.adherence_score`); err != nil {
		return st, fmt.Errorf("plan_days: %w", err)
	}
	st.PlanDays = len(pdRows)

	// 10. SIMILAR_TO edges (top-3 14-D z-scored kNN earlier runs > 3 km)
	knnKeys := []string{"log_dist", "log_dur", "run_pace", "run_hr", "ef", "run_share", "drift", "gct_fade", "stride_fade", "vr_fade", "temp", "gain_km", "tl_min", "hrv_dev"}
	type sFeat struct {
		lid, dt string
		distM   float64
		f       map[string]*float64
	}
	var sFeats []sFeat
	if rows, err := pool.Query(ctx, `SELECT label_id, COALESCE(to_char(date,'YYYY-MM-DD'),''), COALESCE(distance_m,0), COALESCE(features,'{}') FROM train.session_metric WHERE distance_m > 3000`); err == nil {
		for rows.Next() {
			var lid, dt, fj string
			var dm float64
			if rows.Scan(&lid, &dt, &dm, &fj) == nil {
				fm := map[string]*float64{}
				_ = json.Unmarshal([]byte(fj), &fm)
				sFeats = append(sFeats, sFeat{lid, dt, dm, fm})
			}
		}
		rows.Close()
	}
	if len(sFeats) > 1 {
		mean := make([]float64, len(knnKeys))
		sd := make([]float64, len(knnKeys))
		for ki, k := range knnKeys {
			var vs []float64
			for _, sf := range sFeats {
				if p := sf.f[k]; p != nil && !math.IsNaN(*p) && !math.IsInf(*p, 0) {
					vs = append(vs, *p)
				}
			}
			if len(vs) == 0 {
				sd[ki] = 1
				continue
			}
			sum := 0.0
			for _, v := range vs {
				sum += v
			}
			m := sum / float64(len(vs))
			mean[ki] = m
			sq := 0.0
			for _, v := range vs {
				d := v - m
				sq += d * d
			}
			s := math.Sqrt(sq / float64(max(1, len(vs)-1)))
			if s == 0 {
				s = 1
			}
			sd[ki] = s
		}
		zvecs := make([][]float64, len(sFeats))
		for i, sf := range sFeats {
			v := make([]float64, len(knnKeys))
			for ki, k := range knnKeys {
				if p := sf.f[k]; p != nil && !math.IsNaN(*p) && !math.IsInf(*p, 0) {
					v[ki] = (*p - mean[ki]) / sd[ki]
				}
			}
			zvecs[i] = v
		}
		cosSim := func(a, b []float64) float64 {
			d, na, nb := 0.0, 0.0, 0.0
			for i := range a {
				d += a[i] * b[i]
				na += a[i] * a[i]
				nb += b[i] * b[i]
			}
			if na == 0 || nb == 0 {
				return 0
			}
			return d / math.Sqrt(na*nb)
		}
		if _, err := aura.Query(ctx, `MATCH ()-[r:SIMILAR_TO]->() DELETE r`, nil); err != nil {
			return st, fmt.Errorf("similar_to reset: %w", err)
		}
		var simRows []map[string]any
		for i := range sFeats {
			type pair struct {
				lid string
				sim float64
			}
			var cands []pair
			for j := range sFeats {
				if i == j || sFeats[j].dt >= sFeats[i].dt {
					continue
				}
				cands = append(cands, pair{sFeats[j].lid, cosSim(zvecs[i], zvecs[j])})
			}
			sort.Slice(cands, func(a, b int) bool { return cands[a].sim > cands[b].sim })
			for k := 0; k < len(cands) && k < 3; k++ {
				if cands[k].sim >= 0.45 {
					simRows = append(simRows, map[string]any{
						"a": sFeats[i].lid, "b": cands[k].lid, "sim": math.Round(cands[k].sim*1000) / 1000,
					})
				}
			}
		}
		if err := runBatches(ctx, aura, simRows, 200, `
			UNWIND $rows AS r
			MATCH (a:Session {label_id: r.a}), (b:Session {label_id: r.b})
			MERGE (a)-[rel:SIMILAR_TO]->(b)
			SET rel.sim = r.sim`); err != nil {
			return st, fmt.Errorf("similar_to: %w", err)
		}
		st.SimilarEdges = len(simRows)
	}

	// 11. CONTRADICTS edges between semantic memories sharing topic tokens with opposite polarity
	posW := []string{"improv", "better", "faster", "stable", "controlled", "optimal", "dropped", "lower"}
	negW := []string{"worsen", "worse", "slower", "fade", "drift", "spike", "higher", "creep", "pain"}
	polarity := func(txt string) int {
		lo := strings.ToLower(txt)
		p, n := 0, 0
		for _, w := range posW {
			if strings.Contains(lo, w) {
				p++
			}
		}
		for _, w := range negW {
			if strings.Contains(lo, w) {
				n++
			}
		}
		if p > n {
			return 1
		}
		if n > p {
			return -1
		}
		return 0
	}
	var semMems []struct {
		id  int64
		pol int
		tok map[string]bool
	}
	for _, m := range memRows {
		if m["tier"] != "semantic" || m["status"] != "active" {
			continue
		}
		txt, _ := m["title"].(string)
		body, _ := m["body"].(string)
		pol := polarity(txt + " " + body)
		if pol == 0 {
			continue
		}
		toks := map[string]bool{}
		for _, w := range strings.Fields(strings.ToLower(txt)) {
			w = strings.Trim(w, ".,:;!?()[]\"'")
			if len(w) >= 5 {
				toks[w] = true
			}
		}
		id, _ := m["id"].(int64)
		if len(toks) > 0 && id > 0 {
			semMems = append(semMems, struct {
				id  int64
				pol int
				tok map[string]bool
			}{id, pol, toks})
		}
	}
	if _, err := aura.Query(ctx, `MATCH ()-[r:CONTRADICTS]-() DELETE r`, nil); err != nil {
		return st, fmt.Errorf("contradicts reset: %w", err)
	}
	var confRows []map[string]any
	for i := 0; i < len(semMems); i++ {
		for j := i + 1; j < len(semMems); j++ {
			if semMems[i].pol == semMems[j].pol {
				continue
			}
			shared := 0
			for w := range semMems[i].tok {
				if semMems[j].tok[w] {
					shared++
				}
			}
			if shared >= 2 {
				confRows = append(confRows, map[string]any{"a": semMems[i].id, "b": semMems[j].id})
				if len(confRows) >= 40 {
					break
				}
			}
		}
		if len(confRows) >= 40 {
			break
		}
	}
	if err := runBatches(ctx, aura, confRows, 100, `
		UNWIND $rows AS r
		MATCH (a:Memory {id: r.a}), (b:Memory {id: r.b})
		MERGE (a)-[:CONTRADICTS]-(b)`); err != nil {
		return st, fmt.Errorf("contradicts: %w", err)
	}
	st.ConflictEdges = len(confRows)

	if err := SyncEnrich(ctx, pool, aura, redact, memRows, sessRows, &st); err != nil {
		return st, err
	}
	return st, nil
}

// Overview returns live node and relationship counts by label from AuraDB.
func Overview(ctx context.Context, aura *Client) (OverviewStats, error) {
	out := OverviewStats{Nodes: map[string]int64{}, Edges: map[string]int64{}}
	resN, err := aura.Query(ctx, `MATCH (n) RETURN labels(n)[0] AS lbl, count(n) AS cnt`, nil)
	if err != nil {
		return out, err
	}
	for _, row := range resN.Values {
		if len(row) == 2 {
			lbl, _ := row[0].(string)
			cnt, _ := row[1].(float64)
			if lbl != "" {
				out.Nodes[lbl] = int64(cnt)
			}
		}
	}
	resE, err := aura.Query(ctx, `MATCH ()-[r]->() RETURN type(r) AS rel, count(r) AS cnt`, nil)
	if err != nil {
		return out, err
	}
	for _, row := range resE.Values {
		if len(row) == 2 {
			rel, _ := row[0].(string)
			cnt, _ := row[1].(float64)
			if rel != "" {
				out.Edges[rel] = int64(cnt)
			}
		}
	}
	return out, nil
}
