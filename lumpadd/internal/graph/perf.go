package graph

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"sort"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Performance layer — the main focus of the graph. Lumpad exists to raise performance, so every measurable performance quantity is a node, every observation a :PerfPoint
// (one per session / day / metric) that belongs to a :PerfDomain hub, and the personal bests are :PB nodes pointing at the session that set them.
// Domains: vdot · vo2max/COROS running fitness · cardiovascular (EF, drift, HR at pace, cost per km) · durability (run share, fade onset, mechanical fade) · speed · load.
// Derived on every sync (deleted and rebuilt). Training load is included; sleep, HRV and pain are not (health data stays out unless the owner opts in).

type perfDomain struct{ ID, Name, Unit, About string }

var perfDomains = []perfDomain{
	{"vdot", "VDOT (race-equivalent fitness)", "VDOT", "Daniels–Gilbert fitness index: what an effort or a race is worth, against the planned line to the goal"},
	{"running_fitness", "COROS running fitness", "mixed", "VO2max, running level, threshold pace and the watch's race predictions"},
	{"cardio", "Cardiovascular efficiency", "mixed", "Efficiency factor, cardiac drift, heart rate at a given pace and the heart-beat cost of a km"},
	{"durability", "Durability", "mixed", "How long form holds: run share, where the fade starts, mechanical fade late in a run"},
	{"speed", "Speed & personal bests", "s/km", "Run pace and the fastest 1, 3, 5, 10, 15 and 20 km efforts"},
	{"load", "Training load", "mixed", "Short and long training load and their ratio"},
}

type perfMetric struct{ Key, Domain, Unit string }

var sessionMetrics = []perfMetric{
	{"ef", "cardio", "EF"}, {"drift_pahr", "cardio", "%"}, {"hr800", "cardio", "bpm"}, {"pace_hr150", "cardio", "s/km"}, {"beats_km", "cardio", "beats/km"}, {"economy_jm", "cardio", "J/kg/m"},
	{"run_share", "durability", "ratio"}, {"onset_km", "durability", "km"}, {"gct_fade", "durability", "%"}, {"stride_fade", "durability", "%"},
	{"run_pace", "speed", "s/km"},
}

func vdotFromRace(meters, seconds float64) float64 {
	t := seconds / 60
	v := meters / t
	vo2 := -4.6 + 0.182258*v + 0.000104*v*v
	pct := 0.8 + 0.1894393*math.Exp(-0.012778*t) + 0.2989558*math.Exp(-0.1932605*t)
	return vo2 / pct
}

type effort struct {
	label string
	date  string
	secs  float64
}

func round(x float64, n int) float64 { p := math.Pow(10, float64(n)); return math.Round(x*p) / p }

func SyncPerf(ctx context.Context, pool *pgxpool.Pool, aura *Client, st *SyncStats) error {
	for _, c := range []string{
		"CREATE CONSTRAINT perfdomain_id IF NOT EXISTS FOR (d:PerfDomain) REQUIRE d.id IS UNIQUE",
		"CREATE CONSTRAINT perfpoint_id IF NOT EXISTS FOR (p:PerfPoint) REQUIRE p.id IS UNIQUE",
		"CREATE CONSTRAINT pb_id IF NOT EXISTS FOR (b:PB) REQUIRE b.id IS UNIQUE",
	} {
		if _, err := aura.Query(ctx, c, nil); err != nil {
			return fmt.Errorf("perf constraint: %w", err)
		}
	}
	for _, q := range []string{`MATCH (p:PerfPoint) DETACH DELETE p`, `MATCH (b:PB) DETACH DELETE b`, `MATCH (d:PerfDomain) DETACH DELETE d`} {
		if _, err := aura.Query(ctx, q, nil); err != nil {
			return fmt.Errorf("perf reset: %w", err)
		}
	}
	var dRows []map[string]any
	for _, d := range perfDomains {
		dRows = append(dRows, map[string]any{"id": d.ID, "name": d.Name, "unit": d.Unit, "about": d.About})
	}
	if err := runBatches(ctx, aura, dRows, 20, `UNWIND $rows AS r CREATE (d:PerfDomain {id: r.id, name: r.name, unit: r.unit, about: r.about})`); err != nil {
		return fmt.Errorf("perf domains: %w", err)
	}

	// ---- session-level performance points + best efforts
	var pts []map[string]any
	best := map[int][]effort{} // window km -> efforts
	windows := []int{1, 3, 5, 10, 15, 20}
	var longest []effort
	rows, err := pool.Query(ctx, `SELECT label_id, COALESCE(to_char(date,'YYYY-MM-DD'),''), COALESCE(distance_m,0), COALESCE(elapsed_s,0), ef, drift_pahr, hr800, pace_hr150, beats_km, economy_jm, run_share, onset_km, gct_fade, stride_fade, run_pace, COALESCE(km,'[]')
		FROM train.session_metric ORDER BY date`)
	if err == nil {
		for rows.Next() {
			var lid, dt, kmRaw string
			var dist, elapsed float64
			var ef, drift, hr800, ph150, beats, econ, share, onset, gct, stride, pace *float64
			if rows.Scan(&lid, &dt, &dist, &elapsed, &ef, &drift, &hr800, &ph150, &beats, &econ, &share, &onset, &gct, &stride, &pace, &kmRaw) != nil || dt == "" {
				continue
			}
			vals := map[string]*float64{"ef": ef, "drift_pahr": drift, "hr800": hr800, "pace_hr150": ph150, "beats_km": beats, "economy_jm": econ, "run_share": share, "onset_km": onset, "gct_fade": gct, "stride_fade": stride, "run_pace": pace}
			for _, m := range sessionMetrics {
				if v := vals[m.Key]; v != nil && !math.IsNaN(*v) {
					pts = append(pts, map[string]any{"id": lid + ":" + m.Key, "metric": m.Key, "domain": m.Domain, "unit": m.Unit, "date": dt, "value": round(*v, 3), "s": lid, "src": "fit"})
				}
			}
			var ks []kmRow
			_ = json.Unmarshal([]byte(kmRaw), &ks)
			// only complete kilometres with a plausible time (the last row of a run is a partial km)
			full := int(dist / 1000)
			kept := ks[:0]
			for _, k := range ks {
				if k.Km <= full && k.Sec >= 150 && k.Sec <= 1500 {
					kept = append(kept, k)
				}
			}
			ks = kept
			sort.Slice(ks, func(i, j int) bool { return ks[i].Km < ks[j].Km })
			bestV := 0.0
			for _, w := range windows {
				if len(ks) < w {
					continue
				}
				min := math.MaxFloat64
				for i := 0; i+w <= len(ks); i++ {
					if ks[i+w-1].Km-ks[i].Km != w-1 {
						continue // a gap in the km series
					}
					sum := 0.0
					for j := i; j < i+w; j++ {
						sum += ks[j].Sec
					}
					if sum > 0 && sum < min {
						min = sum
					}
				}
				if min < math.MaxFloat64 {
					best[w] = append(best[w], effort{lid, dt, min})
					if (w == 5 || w == 10) && min > 0 {
						if v := vdotFromRace(float64(w)*1000, min); v > bestV {
							bestV = v
						}
					}
				}
			}
			if dist >= 8000 && elapsed > 0 && share != nil && *share >= 0.85 {
				if v := vdotFromRace(dist, elapsed); v > bestV {
					bestV = v
				}
			}
			if bestV > 25 && bestV < 75 {
				pts = append(pts, map[string]any{"id": lid + ":vdot_effort", "metric": "vdot_effort", "domain": "vdot", "unit": "VDOT", "date": dt, "value": round(bestV, 1), "s": lid, "src": "fit"})
			}
			longest = append(longest, effort{lid, dt, dist})
		}
		rows.Close()
	}

	// ---- COROS running fitness (daily) and training load (daily); both keyed by day
	var dayPts []map[string]any
	if rs, err := pool.Query(ctx, `SELECT to_char(date,'YYYY-MM-DD'), vo2max, running_level, threshold_pace_s_km, pred_5k_s, pred_10k_s, pred_hm_s, pred_m_s FROM health.fitness_daily ORDER BY date`); err == nil {
		names := []struct{ k, unit string }{{"vo2max", "ml/kg/min"}, {"running_level", "score"}, {"threshold_pace", "s/km"}, {"pred_5k", "s"}, {"pred_10k", "s"}, {"pred_hm", "s"}, {"pred_marathon", "s"}}
		for rs.Next() {
			var dt string
			var v [7]*float64
			if rs.Scan(&dt, &v[0], &v[1], &v[2], &v[3], &v[4], &v[5], &v[6]) != nil {
				continue
			}
			for i, n := range names {
				if v[i] != nil && *v[i] > 0 {
					dayPts = append(dayPts, map[string]any{"id": "coros:" + n.k + ":" + dt, "metric": n.k, "domain": "running_fitness", "unit": n.unit, "date": dt, "value": round(*v[i], 1), "src": "coros"})
				}
			}
		}
		rs.Close()
	}
	if rs, err := pool.Query(ctx, `SELECT to_char(date,'YYYY-MM-DD'), load_short, load_long, load_ratio FROM health.daily WHERE load_short IS NOT NULL OR load_long IS NOT NULL ORDER BY date`); err == nil {
		for rs.Next() {
			var dt string
			var a, b, c *float64
			if rs.Scan(&dt, &a, &b, &c) != nil {
				continue
			}
			for k, v := range map[string]*float64{"load_short": a, "load_long": b, "load_ratio": c} {
				if v != nil {
					dayPts = append(dayPts, map[string]any{"id": "load:" + k + ":" + dt, "metric": k, "domain": "load", "unit": map[string]string{"load_ratio": "ratio"}[k], "date": dt, "value": round(*v, 2), "src": "coros"})
				}
			}
		}
		rs.Close()
	}

	all := append(append([]map[string]any{}, pts...), dayPts...)
	if err := runBatches(ctx, aura, all, 300, `UNWIND $rows AS r CREATE (p:PerfPoint {id: r.id, metric: r.metric, domain: r.domain, unit: r.unit, date: r.date, value: r.value, source: r.src})
		WITH p, r MATCH (d:PerfDomain {id: r.domain}) MERGE (p)-[:OF_DOMAIN]->(d)`); err != nil {
		return fmt.Errorf("perf points: %w", err)
	}
	if err := runBatches(ctx, aura, pts, 300, `UNWIND $rows AS r MATCH (p:PerfPoint {id: r.id}), (s:Session {label_id: r.s}) MERGE (s)-[:MEASURED]->(p)`); err != nil {
		return fmt.Errorf("perf session links: %w", err)
	}
	if err := runBatches(ctx, aura, dayPts, 300, `UNWIND $rows AS r MATCH (p:PerfPoint {id: r.id}), (d:Day {date: r.date}) MERGE (d)-[:MEASURED]->(p)`); err != nil {
		return fmt.Errorf("perf day links: %w", err)
	}

	// ---- personal bests: the three fastest efforts per distance (one per session), the three longest runs
	var pbs []map[string]any
	for _, w := range windows {
		es := best[w]
		sort.Slice(es, func(i, j int) bool { return es[i].secs < es[j].secs })
		for r := 0; r < 3 && r < len(es); r++ {
			pbs = append(pbs, map[string]any{"id": fmt.Sprintf("pb:%dk:%d", w, r+1), "kind": "fastest", "km": w, "rank": r + 1, "time_s": round(es[r].secs, 0), "pace_s": round(es[r].secs/float64(w), 1), "date": es[r].date, "s": es[r].label, "vdot": round(vdotFromRace(float64(w)*1000, es[r].secs), 1)})
		}
	}
	sort.Slice(longest, func(i, j int) bool { return longest[i].secs > longest[j].secs })
	for r := 0; r < 3 && r < len(longest); r++ {
		pbs = append(pbs, map[string]any{"id": fmt.Sprintf("pb:longest:%d", r+1), "kind": "longest", "km": round(longest[r].secs/1000, 1), "rank": r + 1, "time_s": nil, "pace_s": nil, "date": longest[r].date, "s": longest[r].label, "vdot": nil})
	}
	if err := runBatches(ctx, aura, pbs, 60, `UNWIND $rows AS r CREATE (b:PB {id: r.id, kind: r.kind, distance_km: r.km, rank: r.rank, time_s: r.time_s, pace_s: r.pace_s, date: r.date, vdot: r.vdot})
		WITH b, r MATCH (d:PerfDomain {id: CASE WHEN r.kind = 'longest' THEN 'durability' ELSE 'speed' END}) MERGE (b)-[:OF_DOMAIN]->(d)
		WITH b, r MATCH (s:Session {label_id: r.s}) MERGE (b)-[:ACHIEVED_IN]->(s)`); err != nil {
		return fmt.Errorf("perf pbs: %w", err)
	}

	// ---- derived links (all deleted with their nodes on the next sync)
	for _, q := range []string{
		// chain every metric through time
		`MATCH (p:PerfPoint) WITH p.metric AS m, p ORDER BY p.date WITH m, collect(p) AS ps WHERE size(ps) > 1 UNWIND range(0, size(ps) - 2) AS i WITH ps[i] AS a, ps[i+1] AS b MERGE (a)-[:NEXT_POINT]->(b)`,
		// the planned VDOT line (checkpoints of the 2027 plan) as points of the same metric family, so planned and observed sit side by side
		`MATCH (c:Checkpoint) WHERE c.date IS NOT NULL AND c.line IS NOT NULL AND toFloat(c.line) > 0 MATCH (d:PerfDomain {id:'vdot'}) MERGE (p:PerfPoint {id: 'plan:' + c.id}) SET p.metric = 'vdot_line', p.domain = 'vdot', p.unit = 'VDOT', p.date = c.date, p.value = toFloat(c.line), p.source = 'plan' MERGE (p)-[:OF_DOMAIN]->(d) MERGE (c)-[:PLANS_VDOT]->(p)`,
		// races: the race-day effort is the race's performance
		`MATCH (r:Race)<-[:ATTEMPT_OF]-(s:Session)-[:MEASURED]->(p:PerfPoint {metric: 'vdot_effort'}) SET p.race = true MERGE (r)-[:IMPLIES]->(p)`,
		`MATCH (r:Race)<-[:ATTEMPT_OF]-(s:Session)-[:MEASURED]->(p:PerfPoint) WHERE p.metric IN ['onset_km','run_share','ef'] MERGE (r)-[:SHOWED]->(p)`,
		// domains to goals and topics
		`MATCH (d:PerfDomain {id:'vdot'}), (g:Entity {id:'Goal:sub4'}) MERGE (d)-[:TARGETS]->(g)`,
		`MATCH (d:PerfDomain {id:'durability'}), (t:Topic {id:'durability'}) MERGE (d)-[:ABOUT]->(t)`,
		`MATCH (d:PerfDomain {id:'load'}), (t:Topic {id:'load'}) MERGE (d)-[:ABOUT]->(t)`,
		`MATCH (d:PerfDomain {id:'vdot'}), (m:Entity {id:'Metric:vdot'}) MERGE (d)-[:MEASURED_BY]->(m)`,
		`MATCH (d:PerfDomain {id:'cardio'}), (m:Entity {id:'Metric:hrpace'}) MERGE (d)-[:MEASURED_BY]->(m)`,
		// the domains hang off a single hub so the picture is one connected performance graph
		`MERGE (h:PerfDomain {id:'performance'}) SET h.name = 'PERFORMANCE', h.unit = '', h.about = 'The aim of Lumpad: raise race performance' WITH h MATCH (d:PerfDomain) WHERE d.id <> 'performance' MERGE (d)-[:PART_OF]->(h)`,
		// documents that define the performance targets
		`MATCH (c:Checkpoint {id:'CP1'})-[:DEFINED_IN]->(d:Document) MATCH (x:PerfDomain {id:'vdot'}) MERGE (x)-[:DEFINED_IN]->(d)`,
	} {
		if _, err := aura.Query(ctx, q, nil); err != nil {
			return fmt.Errorf("perf links: %w", err)
		}
	}
	st.PerfPoints, st.PBs = len(all), len(pbs)
	return nil
}
