package coros

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"io"
	"sort"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Archive projection: port of server/coros/project.js buildProjection. Pure local work over the archived responses (raw.response,
// raw.coros_activity in Postgres): no COROS calls. Returns the payload the app tables are rebuilt from.

type Response struct{ Key, Tool, Day, Text string }

func gunzip(b []byte) (string, error) {
	r, err := gzip.NewReader(bytes.NewReader(b))
	if err != nil {
		return "", err
	}
	out, err := io.ReadAll(r)
	return string(out), err
}

type Archive struct {
	byTool map[string][]Response // ORDER BY day, key (archive.js responsesOf)
	byKey  map[string]string
	acts   []archAct
}
type archAct struct {
	LabelID   string
	SportType int
	Date, Rec string
}

func LoadArchive(ctx context.Context, db *pgxpool.Pool, from string) (*Archive, error) {
	a := &Archive{byTool: map[string][]Response{}, byKey: map[string]string{}}
	rows, err := db.Query(ctx, `SELECT key, tool, COALESCE(to_char(day, 'YYYY-MM-DD'), ''), body FROM raw.response ORDER BY day, key`)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var r Response
		var body []byte
		if err := rows.Scan(&r.Key, &r.Tool, &r.Day, &body); err != nil {
			rows.Close()
			return nil, err
		}
		if r.Text, err = gunzip(body); err != nil {
			rows.Close()
			return nil, err
		}
		a.byTool[r.Tool] = append(a.byTool[r.Tool], r)
		a.byKey[r.Key] = r.Text
	}
	rows.Close()
	acts, err := db.Query(ctx, `SELECT label_id, COALESCE(sport_type, 0), to_char(date, 'YYYY-MM-DD'), rec FROM raw.coros_activity WHERE date >= $1 ORDER BY date, label_id`, from)
	if err != nil {
		return nil, err
	}
	defer acts.Close()
	for acts.Next() {
		var x archAct
		if err := acts.Scan(&x.LabelID, &x.SportType, &x.Date, &x.Rec); err != nil {
			return nil, err
		}
		a.acts = append(a.acts, x)
	}
	return a, acts.Err()
}

// decodeRow: JSON object → Row with JS-like values (numbers float64, null kept as jsonNull)
func decodeRow(s string) Row {
	var m map[string]any
	_ = json.Unmarshal([]byte(s), &m)
	r := Row{}
	for k, v := range m {
		if v == nil {
			r[k] = jsonNull{}
		} else {
			r[k] = v
		}
	}
	return r
}

func BuildProjection(a *Archive, from string) Payload {
	rows, order := map[string]Row{}, []string{}
	get := func(d string) Row {
		r, ok := rows[d]
		if !ok {
			r = Row{"date": d}
			rows[d] = r
			order = append(order, d)
		}
		return r
	}
	put := func(list []Row) {
		for _, r := range list {
			if d, _ := r["date"].(string); d >= from {
				g := get(d)
				for k, v := range r {
					g[k] = v
				}
			}
		}
	}
	for _, r := range a.byTool["queryDailyHealthData"] {
		var keep []Row
		for _, h := range ParseDailyHealth(r.Text) {
			other := false
			for k := range h {
				if k != "date" && k != "steps" {
					other = true
				}
			}
			if st, ok := h["steps"].(float64); other || (ok && st > 0) {
				keep = append(keep, h)
			}
		}
		put(keep)
	}
	for _, r := range a.byTool["queryRestingHeartRate"] {
		put(ParseResting(r.Text))
	}
	for _, r := range a.byTool["queryTrainingLoadAssessment"] {
		put(ParseTrainingLoad(r.Text))
	}
	for _, r := range a.byTool["querySleepHrv"] {
		put(ParseSleepHrv(r.Text))
	}
	for _, r := range a.byTool["querySleepOverview"] {
		put(ParseSleepOverview(r.Text))
	}
	for _, r := range a.byTool["queryRecoveryStatus"] { // snapshot → its pull day
		if v := ParseRecovery(r.Text); len(v) > 0 {
			g := get(r.Day)
			for k, x := range v {
				g[k] = x
			}
		}
	}
	p := Payload{Health: []Row{}, Fitness: []Row{}, Activities: []Row{}}
	for _, r := range a.byTool["queryFitnessAssessmentOverview"] {
		f := ParseFitness(r.Text)
		f["date"] = r.Day
		if len(f) > 1 {
			p.Fitness = append(p.Fitness, f)
		}
	}
	sort.Strings(order)
	for _, d := range order {
		if len(rows[d]) > 1 {
			p.Health = append(p.Health, rows[d])
		}
	}
	for _, x := range a.acts {
		r := decodeRow(x.Rec)
		delete(r, "sport_code")
		delete(r, "end_ts")
		if d, ok := a.byKey["detail:"+x.LabelID]; ok && d != "" {
			for k, v := range ParseActivityDetail(d) {
				r[k] = v
			}
		}
		if RunCodes[x.SportType] {
			if l, ok := a.byKey["laps:"+x.LabelID]; ok && l != "" {
				if lp := ParseLaps(l); lp != nil && len(lp.Laps) > 0 {
					r["laps"] = lp.Laps
					for k, v := range map[string]any{"cadence": lp.Cadence, "power": lp.Power, "max_hr": lp.MaxHR} {
						if isNullish(r[k], r[k] != nil) && v != nil { // a.x ??= p.x
							r[k] = v
						}
					}
				}
			}
		}
		p.Activities = append(p.Activities, r)
	}
	return p
}
