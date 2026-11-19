package coros

import (
	"errors"
	"math"
	"regexp"
	"strconv"
	"unicode/utf16"
)

// Ingest validation: port of server/ingest.js ingestOps. Strict whitelist; an invalid value rejects that one record (reported), never the
// batch; null / missing fields are skipped (never overwrite with null); pace-like fields out of range are dropped, the record is kept.

type spec struct {
	key  string
	kind byte // 'n' number (reject when invalid), 'p' soft number (drop when invalid), 's' string (max length in UTF-16 units)
	lo   float64
	hi   float64
}

var (
	specHealth = []spec{{"sleep_hr_avg", 'n', 25, 200}, {"sleep_hr_min", 'n', 25, 200}, {"sleep_hr_max", 'n', 25, 250}, {"hrv_avg", 'n', 3, 400}, {"hrv_status", 's', 40, 0},
		{"hrv_range_lo", 'n', 0, 400}, {"hrv_range_hi", 'n', 0, 400}, {"hrv_baseline", 'n', 0, 400}, {"resting_hr", 'n', 25, 150}, {"stress_avg", 'n', 0, 100},
		{"load_ratio", 'n', 0, 20}, {"load_comment", 's', 30, 0}, {"sleep_score", 'n', 0, 100}, {"sleep_awake_count", 'n', 0, 50}, {"recovery_level", 's', 30, 0}, {"recovery_hours", 'n', 0, 240},
		{"steps", 'n', 0, 200000}, {"sleep_total_min", 'n', 0, 1500}, {"sleep_deep_min", 'n', 0, 1500}, {"sleep_light_min", 'n', 0, 1500},
		{"sleep_rem_min", 'n', 0, 1500}, {"sleep_awake_min", 'n', 0, 1500}, {"recovery_pct", 'n', 0, 100}, {"load_short", 'n', 0, 5000}, {"load_long", 'n', 0, 5000}}
	specActivity = []spec{{"start_ts", 'n', 1e9, 4e9}, {"sport", 's', 40, 0}, {"name", 's', 200, 0}, {"distance_m", 'n', 0, 1e6}, {"duration_s", 'n', 0, 2e5}, {"avg_hr", 'n', 25, 250},
		{"avg_pace_s_km", 'p', 60, 5000}, {"cadence", 'n', 0, 300}, {"power", 'n', 0, 2000}, {"elevation_m", 'n', -500, 9000}, {"calories", 'n', 0, 20000},
		{"temp_c", 'n', -50, 60}, {"humidity", 'n', 0, 100}, {"gear_id", 's', 64, 0}, {"location", 's', 120, 0},
		{"training_load", 'n', 0, 3000}, {"adjusted_pace_s_km", 'p', 60, 5000}, {"max_hr", 'n', 40, 250}, {"aerobic_te", 'n', 0, 6}, {"anaerobic_te", 'n', 0, 6}, {"training_focus", 's', 40, 0}, {"performance", 's', 40, 0}}
	specLap = []spec{{"distance_m", 'n', 0, 1e6}, {"duration_s", 'n', 0, 2e5}, {"avg_pace_s_km", 'p', 60, 5000}, {"avg_hr", 'n', 25, 250}, {"cadence", 'n', 0, 300}, {"power", 'n', 0, 2000},
		{"gct_ms", 'n', 50, 2000}, {"max_hr", 'n', 40, 250}, {"stride_m", 'n', 0.2, 3}, {"vo_cm", 'n', 1, 30}, {"vratio_pct", 'n', 1, 30}}
	specFitness = []spec{{"vo2max", 'n', 10, 100}, {"running_level", 'n', 0, 200}, {"threshold_pace_s_km", 'n', 120, 900}, {"pred_5k_s", 'n', 600, 7200}, {"pred_10k_s", 'n', 1200, 14400},
		{"pred_hm_s", 'n', 2400, 28800}, {"pred_m_s", 'n', 5000, 50000}}
	specGear = []spec{{"name", 's', 120, 0}, {"brand", 's', 80, 0}, {"model", 's', 80, 0}, {"distance_m", 'n', 0, 1e8}}

	reDate = regexp.MustCompile(`^20[2-3]\d-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$`)
	reID   = regexp.MustCompile(`^[A-Za-z0-9_.-]{1,64}$`)
	reGear = regexp.MustCompile(`^g\d+$`)
	Limits = map[string]int{"health": 800, "activities": 400, "laps": 600, "gear": 60, "fitness": 400}
)

func isNullish(v any, ok bool) bool {
	if !ok || v == nil {
		return true
	}
	_, n := v.(jsonNull)
	return n
}

// pick returns the valid whitelisted fields, or the reason the record is rejected
func pick(o Row, sp []spec) (Row, string) {
	out := Row{}
	for _, s := range sp {
		x, ok := o[s.key]
		if isNullish(x, ok) {
			continue
		}
		switch s.kind {
		case 'p':
			if f, isNum := x.(float64); isNum && !math.IsInf(f, 0) && !math.IsNaN(f) && f >= s.lo && f <= s.hi {
				out[s.key] = f
			}
		case 'n':
			f, isNum := x.(float64)
			if !isNum || math.IsInf(f, 0) || math.IsNaN(f) || f < s.lo || f > s.hi {
				return nil, s.key + " invalid"
			}
			out[s.key] = f
		default:
			str, isStr := x.(string)
			if !isStr || len(utf16.Encode([]rune(str))) > int(s.lo) {
				return nil, s.key + " invalid"
			}
			out[s.key] = str
		}
	}
	return out, ""
}

// GearKey: Strava-prefixed ids ("g123") map to the COROS/plain id ("123")
func GearKey(id string) string {
	if reGear.MatchString(id) {
		return id[1:]
	}
	return id
}

type Op struct {
	Op    string `json:"op"` // "upsert" | "delete_laps"
	Table string `json:"table,omitempty"`
	Keys  Row    `json:"keys,omitempty"`
	Vals  Row    `json:"vals,omitempty"`
	ID    string `json:"id,omitempty"`
}
type Rejected = Row
type Payload struct {
	Health, Activities, Gear, Fitness []Row
}
type OpsResult struct {
	Ops      []Op           `json:"ops"`
	Counts   map[string]int `json:"counts"`
	Rejected []Rejected     `json:"rejected"`
}

var ErrTooMany = errors.New("too many items")

func str(v any) (string, bool) { s, ok := v.(string); return s, ok }

// IngestOps turns a payload into the exact writes (same order as Node: health, activities + laps, gear, fitness).
func IngestOps(p Payload, now string) (OpsResult, error) {
	for k, n := range map[string]int{"health": len(p.Health), "activities": len(p.Activities), "gear": len(p.Gear), "fitness": len(p.Fitness)} {
		if n > Limits[k] {
			return OpsResult{}, errors.New(k + ": too many items (max " + strconv.Itoa(Limits[k]) + ")")
		}
	}
	res := OpsResult{Ops: []Op{}, Counts: map[string]int{"health": 0, "activities": 0, "laps": 0, "gear": 0}, Rejected: []Rejected{}}
	dateOK := func(r Row) (string, bool) { d, ok := str(r["date"]); return d, ok && reDate.MatchString(d) }
	with := func(v Row, k string, x any) Row { v[k] = x; return v }
	for _, h := range p.Health {
		d, ok := dateOK(h)
		if !ok {
			res.Rejected = append(res.Rejected, Row{"kind": "health", "date": h["date"], "why": "bad date"})
			continue
		}
		v, why := pick(h, specHealth)
		if why != "" {
			res.Rejected = append(res.Rejected, Row{"kind": "health", "date": d, "why": why})
			continue
		}
		res.Ops = append(res.Ops, Op{Op: "upsert", Table: "health_daily", Keys: Row{"date": d}, Vals: with(v, "pulled_at", now)})
		res.Counts["health"]++
	}
	for _, a := range p.Activities {
		src, _ := str(a["source"])
		sid, sidOK := str(a["source_id"])
		d, dOK := dateOK(a)
		var v Row
		why := "bad source/id/date"
		if (src == "coros" || src == "strava") && sidOK && reID.MatchString(sid) && dOK {
			v, why = pick(a, specActivity)
		}
		if why != "" {
			res.Rejected = append(res.Rejected, Row{"kind": "activity", "id": a["source_id"], "why": why})
			continue
		}
		id := src + ":" + sid
		body := Row{"source": src, "source_id": sid, "date": d}
		for k, x := range v {
			body[k] = x
		}
		if g, ok := v["gear_id"].(string); ok && g != "" {
			body["gear_id"] = GearKey(g)
		}
		res.Ops = append(res.Ops, Op{Op: "upsert", Table: "activities", Keys: Row{"id": id}, Vals: with(body, "pulled_at", now)})
		res.Counts["activities"]++
		laps, isArr := a["laps"].([]Row)
		if !isArr {
			continue
		}
		if len(laps) > Limits["laps"] {
			res.Rejected = append(res.Rejected, Row{"kind": "laps", "id": id, "why": "too many laps"})
			continue
		}
		res.Ops = append(res.Ops, Op{Op: "delete_laps", ID: id})
		for i, l := range laps {
			lv, why := pick(l, specLap)
			if why != "" {
				res.Rejected = append(res.Rejected, Row{"kind": "lap", "id": id, "idx": i, "why": why})
				continue
			}
			res.Ops = append(res.Ops, Op{Op: "upsert", Table: "laps", Keys: Row{"activity_id": id, "idx": i + 1}, Vals: lv})
			res.Counts["laps"]++
		}
	}
	for _, g := range p.Gear {
		gid, ok := str(g["id"])
		var v Row
		why := "bad id"
		if ok && reID.MatchString(gid) {
			v, why = pick(g, specGear)
		}
		if why != "" {
			res.Rejected = append(res.Rejected, Row{"kind": "gear", "id": g["id"], "why": why})
			continue
		}
		if r, isBool := g["retired"].(bool); isBool {
			v["retired"] = map[bool]float64{true: 1, false: 0}[r]
		}
		res.Ops = append(res.Ops, Op{Op: "upsert", Table: "gear", Keys: Row{"id": GearKey(gid)}, Vals: with(v, "pulled_at", now)})
		res.Counts["gear"]++
	}
	for _, f := range p.Fitness {
		d, ok := dateOK(f)
		if !ok {
			res.Rejected = append(res.Rejected, Row{"kind": "fitness", "date": f["date"], "why": "bad date"})
			continue
		}
		v, why := pick(f, specFitness)
		if why != "" {
			res.Rejected = append(res.Rejected, Row{"kind": "fitness", "date": d, "why": why})
			continue
		}
		res.Ops = append(res.Ops, Op{Op: "upsert", Table: "fitness_daily", Keys: Row{"date": d}, Vals: with(v, "pulled_at", now)})
		res.Counts["fitness"]++
	}
	return res, nil
}
