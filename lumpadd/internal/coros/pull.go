package coros

import (
	"encoding/json"
	"fmt"
	"math"
	"regexp"
	"sort"
	"strings"
	"time"
)

// Staged pull from COROS: port of server/coros/pull.js pullRange (+ plan.js). The COROS client and the three database facts the pull
// branches on are injected, so a recorded Node run (pull_trace) can be replayed exactly (redesign Phase 3, gate G3).

type Caller func(tool string, args map[string]any) (string, error)

// PullState answers the facts the pull branches on.
type PullState interface {
	HasLaps(sourceID string) bool // laps already stored for coros:<id>
	HasTL(sourceID string) bool   // training load already stored for coros:<id>
	PlanDue() (due, had bool)     // COROS schedule older than 6 h (or missing); whether a copy exists
}

type RunInfo struct {
	Trigger string   `json:"trigger"`
	Notes   []string `json:"notes"`
}
type PullPayload struct {
	Run        RunInfo `json:"run"`
	Health     []Row   `json:"health"`
	Fitness    []Row   `json:"fitness"`
	Activities []Row   `json:"activities"`
}
type ScheduleRow struct {
	Date string   `json:"date"`
	Code *string  `json:"code"`
	Km   *float64 `json:"km"`
	Sec  *float64 `json:"sec"`
	TL   *float64 `json:"tl"`
}
type PullResult struct {
	Payloads []PullPayload
	Devices  []string      // nil when the devices call failed
	Plan     []ScheduleRow // nil when the schedule was not due
	PlanDone bool
}

func parseDate(s string) time.Time   { t, _ := time.Parse("2006-01-02", s); return t }
func AddDays(s string, n int) string { return parseDate(s).AddDate(0, 0, n).Format("2006-01-02") }
func diffDays(a, b string) int       { return int(math.Round(parseDate(a).Sub(parseDate(b)).Hours() / 24)) }
func ymd(s string) string            { return strings.ReplaceAll(s, "-", "") }

func PullRange(call Caller, state PullState, from, to, trigger string, notes []string) (PullResult, error) {
	note := func(m string) {
		if len(notes) < 40 {
			notes = append(notes, m)
		}
	}
	retry := func(tool string, args map[string]any, tries int, what string, report bool, check func(string) error) (string, bool) {
		for i := 1; ; i++ {
			t, err := call(tool, args)
			if err == nil && check != nil {
				err = check(t)
			}
			if err == nil {
				return t, true
			}
			if i >= tries {
				if report {
					note(what + ": " + jsSlice(err.Error(), 120))
				}
				return "", false
			}
		}
	}
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
	assign := func(dst, src Row) {
		for k, v := range src {
			dst[k] = v
		}
	}
	keep := func(d string) bool { return d >= from && d <= to }
	days := int(math.Min(400, float64(diffDays(to, from)+1)))
	dateOf := func(r Row) string { d, _ := r["date"].(string); return d }

	// 1. daily health: one "last N days" call, halved on failure
	for n := max(days, 7); n >= 7; n /= 2 {
		if t, ok := retry("queryDailyHealthData", map[string]any{"days": n}, 2, fmt.Sprintf("daily health (%d days)", n), true, nil); ok {
			for _, r := range ParseDailyHealth(t) {
				if keep(dateOf(r)) {
					assign(get(dateOf(r)), r)
				}
			}
			if n < days {
				note(fmt.Sprintf("daily health only reached back %d days", n))
			}
			break
		}
	}
	window := func(step int) [][2]string {
		var w [][2]string
		for s := from; s <= to; s = AddDays(s, step) {
			e := AddDays(s, step-1)
			if e > to {
				e = to
			}
			w = append(w, [2]string{s, e})
		}
		return w
	}
	// 2. sleep HRV in 7-day windows
	for _, w := range window(7) {
		if t, ok := retry("querySleepHrv", map[string]any{"startDate": ymd(w[0]), "endDate": ymd(w[1])}, 2, "HRV "+w[0]+".."+w[1], true, nil); ok {
			for _, r := range ParseSleepHrv(t) {
				if keep(dateOf(r)) {
					assign(get(dateOf(r)), r)
				}
			}
		}
	}
	// 3. resting HR
	if t, ok := retry("queryRestingHeartRate", map[string]any{"days": min(days, 90)}, 2, "resting HR", true, nil); ok {
		for _, r := range ParseResting(t) {
			if keep(dateOf(r)) {
				assign(get(dateOf(r)), r)
			}
		}
	}
	// 3b. training load
	for n := max(min(days, 400), 7); n >= 7; n /= 2 {
		if t, ok := retry("queryTrainingLoadAssessment", map[string]any{"days": n}, 2, fmt.Sprintf("training load (%d days)", n), true, nil); ok {
			for _, r := range ParseTrainingLoad(t) {
				if keep(dateOf(r)) {
					assign(get(dateOf(r)), r)
				}
			}
			if n < days {
				note(fmt.Sprintf("training load only reached back %d days", n))
			}
			break
		}
	}
	// 3c. sleep score in 30-day windows
	for _, w := range window(30) {
		if t, ok := retry("querySleepOverview", map[string]any{"startDate": ymd(w[0]), "endDate": ymd(w[1])}, 2, "sleep score "+w[0]+".."+w[1], true, nil); ok {
			for _, r := range ParseSleepOverview(t) {
				if keep(dateOf(r)) {
					assign(get(dateOf(r)), r)
				}
			}
		}
	}
	// 3d. snapshots: recovery (stored under `to`), fitness, devices
	if t, ok := retry("queryRecoveryStatus", map[string]any{}, 2, "recovery status", true, nil); ok {
		assign(get(to), ParseRecovery(t))
	}
	fitness := Row{}
	if t, ok := retry("queryFitnessAssessmentOverview", map[string]any{}, 2, "fitness overview", true, nil); ok {
		fitness = ParseFitness(t)
	}
	var res PullResult
	if t, ok := retry("queryDevices", map[string]any{}, 1, "", false, nil); ok {
		res.Devices = ParseDevices(t)
	}
	// 3e. COROS training schedule, at most every 6 h; an empty answer never overwrites a good copy
	if due, had := state.PlanDue(); due {
		rows, err := PullSchedule(call, "2026-11-23", "2027-12-31")
		if err != nil {
			note("training plan: " + jsSlice(err.Error(), 120))
		} else {
			res.Plan, res.PlanDone = rows, true
			if len(rows) == 0 && !had {
				note("training plan: COROS returned no scheduled workouts")
			}
		}
	}
	// 4. activities month by month; a full page (100) is split in halves, up to 3 levels
	var acts []Row
	var fetch func(s, e string, depth int)
	fetch = func(s, e string, depth int) {
		t, ok := retry("querySportRecords", map[string]any{"startDate": ymd(s), "endDate": ymd(e), "limit": 100}, 2, "activities "+s+".."+e, true, nil)
		if !ok {
			return
		}
		list := ParseSportRecords(t)
		if len(list) >= 100 && depth < 3 && s < e {
			mid := AddDays(s, diffDays(e, s)/2)
			fetch(s, mid, depth+1)
			fetch(AddDays(mid, 1), e, depth+1)
		} else {
			acts = append(acts, list...)
		}
	}
	for s := from; s <= to; {
		t := parseDate(s)
		e := time.Date(t.Year(), t.Month()+1, 0, 0, 0, 0, 0, time.UTC).Format("2006-01-02")
		end := e
		if end > to {
			end = to
		}
		fetch(s, end, 0)
		s = AddDays(e, 1)
	}
	// unique by source_id: first position, last value (JS Map semantics)
	pos, uniq := map[string]int{}, []Row{}
	for _, a := range acts {
		id := fmt.Sprint(a["source_id"])
		if i, ok := pos[id]; ok {
			uniq[i] = a
		} else {
			pos[id] = len(uniq)
			uniq = append(uniq, a)
		}
	}
	code := func(a Row) int { f, _ := a["sport_code"].(float64); return int(f) }
	// 5. laps for runs that have none yet (flaky tool: 3 tries)
	for _, a := range uniq {
		id := fmt.Sprint(a["source_id"])
		if !RunCodes[code(a)] || state.HasLaps(id) {
			continue
		}
		t, ok := retry("queryActivityLapData", map[string]any{"labelId": id, "sportType": a["sport_code"]}, 3, "", false, func(t string) error {
			if ParseLaps(t) == nil {
				return fmt.Errorf("unreadable laps response")
			}
			return nil
		})
		var p *Laps
		if ok && t != "" {
			p = ParseLaps(t)
		}
		if p != nil && len(p.Laps) > 0 {
			a["laps"] = p.Laps
			for k, v := range map[string]any{"cadence": p.Cadence, "power": p.Power, "max_hr": p.MaxHR} {
				if isNullish(a[k], a[k] != nil) && v != nil {
					a[k] = v
				}
			}
		} else {
			note(fmt.Sprintf("laps missing for run %v (%s)", a["date"], id))
		}
	}
	// 5b. training load / TE / focus where not stored yet (runs + strength)
	for _, a := range uniq {
		id := fmt.Sprint(a["source_id"])
		if !(RunCodes[code(a)] || code(a) == 402) || state.HasTL(id) {
			continue
		}
		if t, ok := retry("getActivityDetail", map[string]any{"labelId": id, "sportType": a["sport_code"]}, 3, "", false, nil); ok && t != "" {
			assign(a, ParseActivityDetail(t))
		}
	}
	for _, a := range uniq {
		delete(a, "sport_code")
	}
	// 6. payloads (batches of 300 activities; health, fitness and notes in the first)
	sort.Strings(order)
	health := []Row{}
	for _, d := range order {
		if len(rows[d]) > 1 {
			health = append(health, rows[d])
		}
	}
	nb := max(1, (len(uniq)+299)/300)
	for i := 0; i < nb; i++ {
		p := PullPayload{Run: RunInfo{Trigger: trigger, Notes: []string{}}, Health: []Row{}, Fitness: []Row{}, Activities: uniq[min(i*300, len(uniq)):min((i+1)*300, len(uniq))]}
		if i == 0 {
			p.Run.Notes = append([]string{}, notes[:min(30, len(notes))]...)
			p.Health = health
			if len(fitness) > 0 {
				f := Row{"date": to}
				assign(f, fitness)
				p.Fitness = []Row{f}
			}
		}
		res.Payloads = append(res.Payloads, p)
	}
	return res, nil
}

// ---- COROS training schedule (plan.js)
var (
	reBlank     = regexp.MustCompile(`\n\s*\n`)
	reISODate   = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)
	reNotCode   = regexp.MustCompile(`^(?:Plan ID|idInPlan|Distance|Estimated Time|Load):`)
	reSchedDist = regexp.MustCompile(`(?i)Distance:\s*([\d.]+)\s*(km|m)\b`)
	reSchedTime = regexp.MustCompile(`(?i)Estimated Time:\s*([\d:]+)`)
	reSchedLoad = regexp.MustCompile(`(?i)Load:\s*(\d+)\s*TL`)
)

func ParseSchedule(text string) []ScheduleRow {
	out := []ScheduleRow{}
	for _, block := range reBlank.Split(text, -1) {
		var lines []string
		for _, l := range strings.Split(block, "\n") {
			if l = strings.TrimSpace(l); l != "" {
				lines = append(lines, l)
			}
		}
		di := -1
		for i, l := range lines {
			if reISODate.MatchString(l) {
				di = i
				break
			}
		}
		if di < 0 {
			continue
		}
		r := ScheduleRow{Date: lines[di]}
		if di+1 < len(lines) && !reNotCode.MatchString(lines[di+1]) && lines[di+1] != "" {
			c := lines[di+1]
			r.Code = &c
		}
		if m := reSchedDist.FindStringSubmatch(block); m != nil {
			v := atof(m[1])
			if strings.ToLower(m[2]) == "m" {
				v /= 1000
			}
			v = math.Floor(v*100+0.5) / 100
			r.Km = &v
		}
		if m := reSchedTime.FindStringSubmatch(block); m != nil {
			if v, ok := clock(m[1], true).(float64); ok {
				r.Sec = &v
			}
		}
		if m := reSchedLoad.FindStringSubmatch(block); m != nil {
			v := atof(m[1])
			r.TL = &v
		}
		out = append(out, r)
	}
	sort.SliceStable(out, func(a, b int) bool { return out[a].Date < out[b].Date })
	return out
}

// PullSchedule: chunks of 123 days (the tool takes months at a time); a failed call aborts (no retry, as in Node)
func PullSchedule(call Caller, from, to string) ([]ScheduleRow, error) {
	rows := []ScheduleRow{}
	for s := from; s <= to; s = AddDays(s, 123) {
		e := AddDays(s, 122)
		if e > to {
			e = to
		}
		t, err := call("queryTrainingSchedule", map[string]any{"startDate": ymd(s), "endDate": ymd(e)})
		if err != nil {
			return nil, err
		}
		rows = append(rows, ParseSchedule(t)...)
	}
	sort.SliceStable(rows, func(a, b int) bool { return rows[a].Date < rows[b].Date })
	return rows, nil
}

// MarshalJSON keeps the payload shape Node records (activities' laps as plain arrays)
func (p PullPayload) MarshalJSON() ([]byte, error) {
	type alias PullPayload
	return json.Marshal(alias(p))
}
