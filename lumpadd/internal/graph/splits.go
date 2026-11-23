package graph

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Detail layer: every kilometre of the longer sessions (pace, heart rate, cadence, ground contact, climb, walking) as :Km nodes chained in order, with the fade onset pointing at the
// km where it began, and one :TrainWeek per ISO week (distance, runs, longest run, load) chained and linked to its sessions. Lets the graph answer "where in the run did it go wrong"
// and "how did volume build" without the model re-reading raw files. Derived, so each sync deletes and rebuilds these nodes. No health data (no sleep, HRV or pain).

type kmRow struct {
	Km      int     `json:"km"`
	Sec     float64 `json:"sec"`
	Run     float64 `json:"run"`
	Walk    float64 `json:"walk"`
	Stop    float64 `json:"stop"`
	Share   float64 `json:"runShare"`
	Pace    float64 `json:"pace"`
	RunPace float64 `json:"runPace"`
	HR      float64 `json:"hr"`
	Cad     float64 `json:"cad"`
	GCT     float64 `json:"gct"`
	Gain    float64 `json:"gain"`
}

const splitMinDistM = 5000.0

func SyncSplits(ctx context.Context, pool *pgxpool.Pool, aura *Client, sessRows []map[string]any, st *SyncStats) error {
	for _, c := range []string{
		"CREATE CONSTRAINT km_id IF NOT EXISTS FOR (k:Km) REQUIRE k.id IS UNIQUE",
		"CREATE CONSTRAINT trainweek_id IF NOT EXISTS FOR (w:TrainWeek) REQUIRE w.id IS UNIQUE",
		"CREATE CONSTRAINT lap_id IF NOT EXISTS FOR (l:Lap) REQUIRE l.id IS UNIQUE",
		"CREATE CONSTRAINT weatherhour_id IF NOT EXISTS FOR (h:WeatherHour) REQUIRE h.id IS UNIQUE",
	} {
		if _, err := aura.Query(ctx, c, nil); err != nil {
			return fmt.Errorf("splits constraint: %w", err)
		}
	}
	for _, q := range []string{`MATCH (k:Km) DETACH DELETE k`, `MATCH (w:TrainWeek) DETACH DELETE w`, `MATCH (l:Lap) DETACH DELETE l`, `MATCH (h:WeatherHour) DETACH DELETE h`, `MATCH ()-[r:COMPARED_TO]->() DELETE r`} {
		if _, err := aura.Query(ctx, q, nil); err != nil {
			return fmt.Errorf("splits reset: %w", err)
		}
	}

	// kilometres
	var km, next []map[string]any
	rows, err := pool.Query(ctx, `SELECT label_id, COALESCE(distance_m,0), COALESCE(km,'[]') FROM train.session_metric WHERE distance_m >= $1`, splitMinDistM)
	if err == nil {
		for rows.Next() {
			var lid, raw string
			var dist float64
			if rows.Scan(&lid, &dist, &raw) != nil {
				continue
			}
			var ks []kmRow
			if json.Unmarshal([]byte(raw), &ks) != nil || len(ks) == 0 {
				continue
			}
			n := len(ks)
			for i, k := range ks {
				third := "first"
				if i*3 >= 2*n {
					third = "last"
				} else if i*3 >= n {
					third = "middle"
				}
				id := fmt.Sprintf("%s:%d", lid, k.Km)
				km = append(km, map[string]any{"id": id, "s": lid, "km": k.Km, "third": third, "pace": k.Pace, "run_pace": k.RunPace, "hr": k.HR, "cad": k.Cad, "gct": k.GCT, "gain": k.Gain,
					"walk_s": k.Walk, "stop_s": k.Stop, "run_share": k.Share})
				if i > 0 {
					next = append(next, map[string]any{"a": fmt.Sprintf("%s:%d", lid, ks[i-1].Km), "b": id})
				}
			}
		}
		rows.Close()
	}
	if err := runBatches(ctx, aura, km, 250, `UNWIND $rows AS r CREATE (k:Km {id: r.id, km: r.km, third: r.third, pace_s: r.pace, run_pace_s: r.run_pace, hr: r.hr, cadence: r.cad, gct_ms: r.gct, gain_m: r.gain, walk_s: r.walk_s, stop_s: r.stop_s, run_share: r.run_share})
		WITH k, r MATCH (s:Session {label_id: r.s}) MERGE (s)-[:HAS_KM]->(k)`); err != nil {
		return fmt.Errorf("km nodes: %w", err)
	}
	if err := runBatches(ctx, aura, next, 400, `UNWIND $rows AS r MATCH (a:Km {id: r.a}), (b:Km {id: r.b}) MERGE (a)-[:NEXT_KM]->(b)`); err != nil {
		return fmt.Errorf("km chain: %w", err)
	}
	// where the fade began (the session's onset_km, rounded down to a split)
	if _, err := aura.Query(ctx, `MATCH (s:Session)-[:HAS_KM]->(k:Km) WHERE s.onset_km IS NOT NULL AND k.km = toInteger(floor(s.onset_km)) + 1 MERGE (s)-[:ONSET_AT]->(k)`, nil); err != nil {
		return fmt.Errorf("onset links: %w", err)
	}

	// km-level comparison across races of the same class (full vs full, half vs half): the same km of the older race points at the newer one with the pace / heart-rate difference
	if _, err := aura.Query(ctx, `
		MATCH (r1:RaceEntry)-[:DONE_AS]->(s1:Session), (r2:RaceEntry)-[:DONE_AS]->(s2:Session)
		WHERE r1.date < r2.date AND s1.distance_m >= 15000 AND s2.distance_m >= 15000
		  AND ((s1.distance_m >= 30000 AND s2.distance_m >= 30000) OR (s1.distance_m < 30000 AND s2.distance_m < 30000))
		MATCH (s1)-[:HAS_KM]->(a:Km), (s2)-[:HAS_KM]->(b:Km) WHERE a.km = b.km
		MERGE (a)-[c:COMPARED_TO]->(b) SET c.d_pace_s = b.pace_s - a.pace_s, c.d_hr = b.hr - a.hr, c.from_race = r1.name, c.to_race = r2.name`, nil); err != nil {
		return fmt.Errorf("km compare: %w", err)
	}

	// laps (manual and auto laps: intervals, time trials, race splits as the watch recorded them)
	var laps, lapNext []map[string]any
	if rs, err := pool.Query(ctx, `SELECT s.label_id, l.activity_id, l.idx, l.distance_m, l.duration_s, l.avg_pace_s_km, l.avg_hr, l.max_hr, l.cadence, l.power, l.gct_ms, l.stride_m
		FROM train.lap l JOIN train.session_metric s ON s.activity_id = l.activity_id ORDER BY l.activity_id, l.idx`); err == nil {
		prev, prevAct := "", ""
		for rs.Next() {
			var lid, act string
			var idx int64
			var dist, dur, pace, hr, mx, cad, pw, gct, stride *float64
			if rs.Scan(&lid, &act, &idx, &dist, &dur, &pace, &hr, &mx, &cad, &pw, &gct, &stride) != nil {
				continue
			}
			id := fmt.Sprintf("%s:L%d", lid, idx)
			laps = append(laps, map[string]any{"id": id, "s": lid, "idx": idx, "dist": dist, "dur": dur, "pace": pace, "hr": hr, "max_hr": mx, "cad": cad, "power": pw, "gct": gct, "stride": stride})
			if prevAct == act && prev != "" {
				lapNext = append(lapNext, map[string]any{"a": prev, "b": id})
			}
			prev, prevAct = id, act
		}
		rs.Close()
	}
	if err := runBatches(ctx, aura, laps, 250, `UNWIND $rows AS r CREATE (l:Lap {id: r.id, idx: r.idx, distance_m: r.dist, duration_s: r.dur, pace_s: r.pace, hr: r.hr, max_hr: r.max_hr, cadence: r.cad, power: r.power, gct_ms: r.gct, stride_m: r.stride})
		WITH l, r MATCH (s:Session {label_id: r.s}) MERGE (s)-[:HAS_LAP]->(l)`); err != nil {
		return fmt.Errorf("laps: %w", err)
	}
	if err := runBatches(ctx, aura, lapNext, 400, `UNWIND $rows AS r MATCH (a:Lap {id: r.a}), (b:Lap {id: r.b}) MERGE (a)-[:NEXT_LAP]->(b)`); err != nil {
		return fmt.Errorf("lap chain: %w", err)
	}

	// hourly weather of every outdoor session; the session points at the hour it started in
	var hours []map[string]any
	if rs, err := pool.Query(ctx, `SELECT w.label_id, w.hours, COALESCE(s.start_hour, -1) FROM train.run_weather w JOIN train.session_metric s ON s.label_id = w.label_id WHERE w.indoor = 0 AND w.hours IS NOT NULL AND w.hours <> ''`); err == nil {
		for rs.Next() {
			var lid, raw string
			var startH float64
			if rs.Scan(&lid, &raw, &startH) != nil {
				continue
			}
			var hs []struct {
				H    int      `json:"h"`
				Temp *float64 `json:"temp"`
				RH   *float64 `json:"rh"`
				Dew  *float64 `json:"dew"`
				Wind *float64 `json:"wind"`
				Rad  *float64 `json:"rad"`
			}
			if json.Unmarshal([]byte(raw), &hs) != nil {
				continue
			}
			for _, h := range hs {
				hours = append(hours, map[string]any{"id": fmt.Sprintf("%s:H%02d", lid, h.H), "w": lid, "h": h.H, "temp": h.Temp, "rh": h.RH, "dew": h.Dew, "wind": h.Wind, "rad": h.Rad, "start": startH >= 0 && int(startH) == h.H, "s": lid})
			}
		}
		rs.Close()
	}
	if err := runBatches(ctx, aura, hours, 250, `UNWIND $rows AS r CREATE (h:WeatherHour {id: r.id, hour: r.h, temp_c: r.temp, rh: r.rh, dew_c: r.dew, wind_ms: r.wind, rad_wm2: r.rad})
		WITH h, r MATCH (w:Weather {label_id: r.w}) MERGE (w)-[:HAS_HOUR]->(h)
		WITH h, r WHERE r.start MATCH (s:Session {label_id: r.s}) MERGE (s)-[:STARTED_IN]->(h)`); err != nil {
		return fmt.Errorf("weather hours: %w", err)
	}
	st.Laps, st.WeatherHours = len(laps), len(hours)

	// training weeks
	type wk struct {
		id           string
		start        string
		km, long, tl float64
		runs         int
		labels       []string
	}
	weeks := map[string]*wk{}
	for _, s := range sessRows {
		dt, _ := s["date"].(string)
		if sp := strings.ToLower(fmt.Sprint(s["sport"])); sp != "" && !strings.HasPrefix(sp, "run") && sp != "<nil>" {
			continue // session_metric only holds running FIT sessions today; keep the guard for other sports
		}
		t, err := time.Parse("2006-01-02", dt)
		if err != nil {
			continue
		}
		y, w := t.ISOWeek()
		id := fmt.Sprintf("%d-W%02d", y, w)
		x := weeks[id]
		if x == nil {
			x = &wk{id: id, start: t.AddDate(0, 0, -((int(t.Weekday()) + 6) % 7)).Format("2006-01-02")}
			weeks[id] = x
		}
		d, _ := s["distance_m"].(float64)
		x.km += d / 1000
		if d/1000 > x.long {
			x.long = d / 1000
		}
		if tl, ok := s["tl"].(*float64); ok && tl != nil {
			x.tl += *tl
		}
		x.runs++
		if lid, _ := s["label_id"].(string); lid != "" {
			x.labels = append(x.labels, lid)
		}
	}
	ids := make([]string, 0, len(weeks))
	for id := range weeks {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	var wRows, inc, chain []map[string]any
	for i, id := range ids {
		x := weeks[id]
		wRows = append(wRows, map[string]any{"id": id, "start": x.start, "km": float64(int(x.km*10+0.5)) / 10, "runs": x.runs, "long_km": float64(int(x.long*10+0.5)) / 10, "tl": int(x.tl + 0.5)})
		for _, l := range x.labels {
			inc = append(inc, map[string]any{"w": id, "s": l})
		}
		if i > 0 {
			chain = append(chain, map[string]any{"a": ids[i-1], "b": id})
		}
	}
	if err := runBatches(ctx, aura, wRows, 100, `UNWIND $rows AS r CREATE (w:TrainWeek {id: r.id, start: r.start, km: r.km, runs: r.runs, long_km: r.long_km, tl: r.tl})`); err != nil {
		return fmt.Errorf("train weeks: %w", err)
	}
	if err := runBatches(ctx, aura, inc, 300, `UNWIND $rows AS r MATCH (w:TrainWeek {id: r.w}), (s:Session {label_id: r.s}) MERGE (w)-[:INCLUDES]->(s)`); err != nil {
		return fmt.Errorf("week sessions: %w", err)
	}
	if err := runBatches(ctx, aura, chain, 200, `UNWIND $rows AS r MATCH (a:TrainWeek {id: r.a}), (b:TrainWeek {id: r.b}) MERGE (a)-[:NEXT_TRAIN_WEEK]->(b)`); err != nil {
		return fmt.Errorf("week chain: %w", err)
	}
	st.KmNodes, st.TrainWeeks = len(km), len(wRows)
	return nil
}
