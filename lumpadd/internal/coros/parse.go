// Package coros: the COROS MCP response parsers (port of server/coros/parse.js). The tools return text (and JSON for laps);
// a field that cannot be read is omitted, never guessed. Output rows are map[string]any with exactly the keys and values the JS
// produces, so they can be diffed JSON-for-JSON against the Node ingest.
package coros

import (
	"encoding/json"
	"math"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf16"
)

type Row = map[string]any

// set adds k=v unless v is "undefined" (nil here) or NaN — JS clean()
func set(r Row, k string, v any) {
	switch x := v.(type) {
	case nil:
		return
	case float64:
		if math.IsNaN(x) {
			return
		}
	}
	r[k] = v
}

// jsSlice: String.prototype.slice(0, n) (UTF-16 code units)
func jsSlice(s string, n int) string {
	u := utf16.Encode([]rune(s))
	if len(u) <= n {
		return s
	}
	return string(utf16.Decode(u[:n]))
}
func trim(s string) string { return strings.TrimSpace(s) }

// num: first capture of re, commas removed, as a number; nil when no match
func num(re *regexp.Regexp, s string) any {
	m := re.FindStringSubmatch(s)
	if m == nil {
		return nil
	}
	f, err := strconv.ParseFloat(strings.ReplaceAll(m[1], ",", ""), 64)
	if err != nil {
		return math.NaN()
	}
	return f
}
func group(re *regexp.Regexp, s string) (string, bool) {
	m := re.FindStringSubmatch(s)
	if m == nil {
		return "", false
	}
	return m[1], true
}

var (
	reH   = regexp.MustCompile(`(\d+)\s*h`)
	reMin = regexp.MustCompile(`(\d+)\s*min`)
)

// mins: "7 h 12 min" → 432; nil when neither part is present
func mins(s string, ok bool) any {
	if !ok || s == "" {
		return nil
	}
	h, m := reH.FindStringSubmatch(s), reMin.FindStringSubmatch(s)
	if h == nil && m == nil {
		return nil
	}
	t := 0.0
	if h != nil {
		v, _ := strconv.ParseFloat(h[1], 64)
		t += v * 60
	}
	if m != nil {
		v, _ := strconv.ParseFloat(m[1], 64)
		t += v
	}
	return t
}

// clock: "1:02:03" → 3723 (JS Number(”) = 0 for empty parts); nil for missing / non-numeric
func clock(s string, ok bool) any {
	if !ok || s == "" {
		return nil
	}
	t := 0.0
	for _, p := range strings.Split(s, ":") {
		v := 0.0
		if p != "" {
			f, err := strconv.ParseFloat(p, 64)
			if err != nil {
				return nil
			}
			v = f
		}
		t = t*60 + v
	}
	return t
}

// splitCapture: JS str.split(re) where re has one capture group → [before, cap1, between, cap2, …]; returns the (cap, body) pairs
func splitCapture(re *regexp.Regexp, s string) [][2]string {
	idx := re.FindAllStringSubmatchIndex(s, -1)
	out := [][2]string{}
	for i, m := range idx {
		end := len(s)
		if i+1 < len(idx) {
			end = idx[i+1][0]
		}
		out = append(out, [2]string{s[m[2]:m[3]], s[m[1]:end]})
	}
	return out
}
func iso8(d string) string { return d[0:4] + "-" + d[4:6] + "-" + d[6:8] }

var (
	reDayHdr = regexp.MustCompile(`(?m)^--- (\d{8}) ---$`)
	reSteps  = regexp.MustCompile(`Steps:\s*([\d,]+)`)
	reStress = regexp.MustCompile(`Stress:\s*Avg\s*(\d+)`)
	reTotal  = regexp.MustCompile(`Total:\s*([^|\n]+)`)
	reDeep   = regexp.MustCompile(`Deep:\s*([^|\n]+)`)
	reLight  = regexp.MustCompile(`Light:\s*([^|\n]+)`)
	reREM    = regexp.MustCompile(`REM:\s*([^|\n]+)`)
	reAwake  = regexp.MustCompile(`Awake:\s*([^|\n]+)`)
	reSHRAvg = regexp.MustCompile(`Sleep HR:\s*Avg\s*(\d+)`)
	reSHRMin = regexp.MustCompile(`Sleep HR:[^\n]*Min\s*(\d+)`)
	reSHRMax = regexp.MustCompile(`Sleep HR:[^\n]*Max\s*(\d+)`)
)

// ParseDailyHealth: queryDailyHealthData → rows per wake-up date
func ParseDailyHealth(text string) []Row {
	out := []Row{}
	for _, p := range splitCapture(reDayHdr, text) {
		d, b := p[0], p[1]
		r := Row{"date": iso8(d)}
		set(r, "steps", num(reSteps, b))
		set(r, "stress_avg", num(reStress, b))
		for _, x := range []struct {
			k  string
			re *regexp.Regexp
		}{{"sleep_total_min", reTotal}, {"sleep_deep_min", reDeep}, {"sleep_light_min", reLight}, {"sleep_rem_min", reREM}, {"sleep_awake_min", reAwake}} {
			s, ok := group(x.re, b)
			set(r, x.k, mins(s, ok))
		}
		set(r, "sleep_hr_avg", num(reSHRAvg, b))
		set(r, "sleep_hr_min", num(reSHRMin, b))
		set(r, "sleep_hr_max", num(reSHRMax, b))
		out = append(out, r)
	}
	return out
}

var reHRV = regexp.MustCompile(`(\d{4}-\d{2}-\d{2}):\s*\n\s*HRV Avg:\s*(\d+)\s*ms\s*[—–-]\s*([^\n]+?)\s*\n\s*Normal Range:\s*(\d+)\s*[-–]\s*(\d+)\s*ms\s*\n\s*Baseline:\s*(\d+)\s*ms`)

func atof(s string) float64 { f, _ := strconv.ParseFloat(s, 64); return f }

// ParseSleepHrv: the official "HRV Assessment" block only
func ParseSleepHrv(text string) []Row {
	a, b := strings.Index(text, "HRV Assessment"), strings.Index(text, "Sleep HRV Time Series")
	if a < 0 {
		a = 0
	}
	blk := text[a:]
	if b >= 0 {
		if b >= a {
			blk = text[a:b]
		} else {
			blk = "" // JS slice(a, b) with b < a is empty
		}
	}
	out := []Row{}
	for _, m := range reHRV.FindAllStringSubmatch(blk, -1) {
		out = append(out, Row{"date": m[1], "hrv_avg": atof(m[2]), "hrv_status": jsSlice(trim(m[3]), 40), "hrv_range_lo": atof(m[4]), "hrv_range_hi": atof(m[5]), "hrv_baseline": atof(m[6])})
	}
	return out
}

var reResting = regexp.MustCompile(`(\d{4}-\d{2}-\d{2}):\s*(\d+)\s*bpm`)

func ParseResting(text string) []Row {
	out := []Row{}
	for _, m := range reResting.FindAllStringSubmatch(text, -1) {
		out = append(out, Row{"date": m[1], "resting_hr": atof(m[2])})
	}
	return out
}

var Sport = map[int]string{100: "Run", 101: "Run", 102: "Run", 103: "Run", 104: "Hike", 900: "Walk", 402: "Strength", 400: "Cardio", 200: "Ride", 201: "Ride", 300: "Swim"}
var RunCodes = map[int]bool{100: true, 101: true, 102: true, 103: true}

var (
	reRecSplit = regexp.MustCompile(`(?m)^\s*\d+\.\s+`)
	reHead     = regexp.MustCompile(`^(.+?)\s+[—–-]\s+(\d{4}-\d{2}-\d{2})`)
	reLabel    = regexp.MustCompile(`LabelId:\s*(\d+)`)
	reSportT   = regexp.MustCompile(`SportType:\s*(\d+)`)
	reDist     = regexp.MustCompile(`Distance:\s*([\d.,]+)\s*(km|m)\b`)
	rePace     = regexp.MustCompile(`Average Pace:\s*(\d+:\d{2})`)
	reDur      = regexp.MustCompile(`Duration:\s*([\d:]+)`)
	reAvgHR    = regexp.MustCompile(`Avg HR:\s*(\d+)`)
	reCal      = regexp.MustCompile(`Calories:\s*([\d,]+)`)
	reStartTs  = regexp.MustCompile(`startTimestamp=(\d+)`)
	reEndTs    = regexp.MustCompile(`endTimestamp=(\d+)`)
	reLoc      = regexp.MustCompile(`Location:\s*([^\n]+)`)
)

// ParseSportRecords: querySportRecords → activities. sport_code is kept (the pull uses it, then deletes it before saving).
func ParseSportRecords(text string) []Row {
	parts := reRecSplit.Split(text, -1)
	out := []Row{}
	for _, b := range parts[1:] {
		head := reHead.FindStringSubmatch(b)
		if head == nil {
			continue
		}
		label, ok := group(reLabel, b)
		if !ok || label == "" {
			continue
		}
		st := num(reSportT, b)
		name := trim(head[1])
		sport := jsSlice(name, 40)
		if f, ok := st.(float64); ok {
			if s, ok := Sport[int(f)]; ok && f == math.Trunc(f) {
				sport = s
			}
		}
		r := Row{"source": "coros", "source_id": label, "date": head[2], "sport": sport, "name": jsSlice(name, 200)}
		set(r, "sport_code", st)
		if d := reDist.FindStringSubmatch(b); d != nil {
			v, err := strconv.ParseFloat(strings.ReplaceAll(d[1], ",", ""), 64)
			if err != nil {
				v = math.NaN()
			}
			if d[2] == "km" {
				v *= 1000
			}
			set(r, "distance_m", math.Floor(v+0.5))
		}
		ds, ok := group(reDur, b)
		set(r, "duration_s", clock(ds, ok))
		if p := rePace.FindStringSubmatch(b); p != nil {
			set(r, "avg_pace_s_km", clock(p[1], true))
		}
		set(r, "avg_hr", num(reAvgHR, b))
		set(r, "calories", num(reCal, b))
		set(r, "start_ts", num(reStartTs, b))
		set(r, "end_ts", num(reEndTs, b))
		if l, ok := group(reLoc, b); ok {
			r["location"] = jsSlice(trim(l), 120)
		}
		out = append(out, r)
	}
	return out
}

// ---- laps (JSON). JS arithmetic on JSON values: missing → NaN (dropped), null → 0, `x || undefined` drops 0/null.
func jsNum(v any, present bool) float64 {
	if !present {
		return math.NaN()
	}
	switch x := v.(type) {
	case nil:
		return 0
	case float64:
		return x
	case bool:
		if x {
			return 1
		}
		return 0
	case string:
		if strings.TrimSpace(x) == "" {
			return 0
		}
		f, err := strconv.ParseFloat(strings.TrimSpace(x), 64)
		if err != nil {
			return math.NaN()
		}
		return f
	}
	return math.NaN()
}
func truthy(v any, present bool) bool {
	if !present {
		return false
	}
	switch x := v.(type) {
	case nil:
		return false
	case float64:
		return x != 0 && !math.IsNaN(x)
	case string:
		return x != ""
	case bool:
		return x
	}
	return true
}

// raw: the value as JS would keep it in an object literal (undefined → omitted, else as-is)
func rawOr(l map[string]any, k string) any {
	v, ok := l[k]
	if !ok {
		return nil
	}
	if v == nil {
		return jsonNull{}
	}
	return v
}

type jsonNull struct{}

func (jsonNull) MarshalJSON() ([]byte, error) { return []byte("null"), nil }

func orUndef(l map[string]any, k string) any {
	v, ok := l[k]
	if truthy(v, ok) {
		return v
	}
	return nil
}
func scaled(l map[string]any, k string, div float64) any {
	v, ok := l[k]
	if !truthy(v, ok) {
		return nil
	}
	return jsNum(v, true) / div
}

type Laps struct {
	Laps                  []Row
	Cadence, Power, MaxHR any
}

func (p Laps) MarshalJSON() ([]byte, error) {
	m := Row{"laps": p.Laps}
	set(m, "cadence", p.Cadence)
	set(m, "power", p.Power)
	set(m, "max_hr", p.MaxHR)
	return json.Marshal(m)
}

// ParseLaps: queryActivityLapData → laps of the 1-km auto-lap group (type 2) + whole-activity cadence/power/max HR (type −1); nil when unreadable
func ParseLaps(text string) *Laps {
	var j map[string]any
	if err := json.Unmarshal([]byte(text), &j); err != nil {
		return nil
	}
	groups, ok := j["lapGroups"].([]any)
	if !ok {
		return nil
	}
	var g2, all map[string]any
	for _, x := range groups {
		g, _ := x.(map[string]any)
		if g == nil {
			continue
		}
		if t, _ := g["type"].(float64); t == 2 && g2 == nil {
			g2 = g
		}
		if t, _ := g["type"].(float64); t == -1 && all == nil {
			if ls, _ := g["laps"].([]any); len(ls) > 0 {
				all, _ = ls[0].(map[string]any)
			}
			if all == nil {
				all = map[string]any{}
			}
		}
	}
	p := &Laps{Laps: []Row{}}
	if g2 != nil {
		ls, _ := g2["laps"].([]any)
		for _, x := range ls {
			l, _ := x.(map[string]any)
			if l == nil {
				l = map[string]any{}
			}
			r := Row{}
			d, has := l["distance"]
			set(r, "distance_m", jsNum(d, has)/100)
			set(r, "duration_s", rawOr(l, "time"))
			set(r, "avg_pace_s_km", rawOr(l, "avgPace"))
			set(r, "avg_hr", rawOr(l, "avgHr"))
			set(r, "cadence", orUndef(l, "avgCadence"))
			set(r, "power", orUndef(l, "avgPower"))
			set(r, "gct_ms", orUndef(l, "groundTime"))
			set(r, "max_hr", orUndef(l, "maxHr"))
			set(r, "stride_m", scaled(l, "avgStrideLength", 100))
			set(r, "vo_cm", scaled(l, "strideHeight", 10))
			set(r, "vratio_pct", scaled(l, "strideRatio", 10))
			p.Laps = append(p.Laps, r)
		}
	}
	if all != nil {
		p.Cadence, p.Power, p.MaxHR = orUndef(all, "avgCadence"), orUndef(all, "avgPower"), orUndef(all, "maxHr")
	}
	return p
}

// ---- load / recovery / fitness / sleep score / activity detail
var reLoad = regexp.MustCompile(`(\d{4}-\d{2}-\d{2})\s*\n\s*Comment:\s*([^\n]+)\n\s*Short-Term Load:\s*(\d+)\s*\n\s*Long-Term Load:\s*(\d+)\s*\n\s*Load Ratio:\s*([\d.]+)`)

func ParseTrainingLoad(text string) []Row {
	out := []Row{}
	for _, m := range reLoad.FindAllStringSubmatch(text, -1) {
		ratio, err := strconv.ParseFloat(m[5], 64)
		if err != nil {
			ratio = math.NaN() // JS +"1.2.3" is NaN and is kept in the row (no clean() here)
		}
		out = append(out, Row{"date": m[1], "load_comment": jsSlice(trim(m[2]), 30), "load_short": atof(m[3]), "load_long": atof(m[4]), "load_ratio": ratio})
	}
	return out
}

var (
	reRecEst = regexp.MustCompile(`Estimated Full Recovery:\s*([^\n]+)`)
	reDays   = regexp.MustCompile(`(\d+)\s*d`)
	reRecPct = regexp.MustCompile(`Recovery:\s*(\d+)\s*%`)
	reLevel  = regexp.MustCompile(`Level:\s*([^\n]+)`)
)

func ParseRecovery(text string) Row {
	e, _ := group(reRecEst, text)
	d, h := reDays.FindStringSubmatch(e), reH.FindStringSubmatch(e)
	r := Row{}
	set(r, "recovery_pct", num(reRecPct, text))
	if l, ok := group(reLevel, text); ok {
		r["recovery_level"] = jsSlice(trim(l), 30)
	}
	if d != nil || h != nil {
		t := 0.0
		if d != nil {
			t += atof(d[1]) * 24
		}
		if h != nil {
			t += atof(h[1])
		}
		r["recovery_hours"] = t
	}
	return r
}

var reDevice = regexp.MustCompile(`(?m)^\s*\d+\.\s+(.+)$`)

func ParseDevices(text string) []string {
	out := []string{}
	for _, m := range reDevice.FindAllStringSubmatch(text, -1) {
		out = append(out, jsSlice(trim(m[1]), 60))
	}
	return out
}

var (
	reDateLine = regexp.MustCompile(`(?m)^(\d{4}-\d{2}-\d{2})$`)
	reScore    = regexp.MustCompile(`Sleep Score:\s*(\d+)`)
	reAwakeN   = regexp.MustCompile(`Awake Count[^:]*:\s*(\d+)`)
)

func ParseSleepOverview(text string) []Row {
	out := []Row{}
	for _, p := range splitCapture(reDateLine, text) {
		r := Row{"date": p[0]}
		set(r, "sleep_score", num(reScore, p[1]))
		set(r, "sleep_awake_count", num(reAwakeN, p[1]))
		if len(r) > 1 {
			out = append(out, r)
		}
	}
	return out
}

var (
	reTL      = regexp.MustCompile(`Training Load:\s*(\d+)`)
	reATE     = regexp.MustCompile(`Aerobic TE:\s*([\d.]+)`)
	reANTE    = regexp.MustCompile(`Anaerobic TE:\s*([\d.]+)`)
	reAdjPace = regexp.MustCompile(`Adjusted Pace:\s*(\d+:\d{2})`)
	reFocus   = regexp.MustCompile(`Training Focus:\s*([^\n]+)`)
	rePerf    = regexp.MustCompile(`Performance:\s*([^\n]+)`)
)

func ParseActivityDetail(text string) Row {
	r := Row{}
	set(r, "training_load", num(reTL, text))
	set(r, "aerobic_te", num(reATE, text))
	set(r, "anaerobic_te", num(reANTE, text))
	s, ok := group(reAdjPace, text)
	set(r, "adjusted_pace_s_km", clock(s, ok))
	if f, ok := group(reFocus, text); ok {
		r["training_focus"] = jsSlice(trim(f), 40)
	}
	if f, ok := group(rePerf, text); ok {
		r["performance"] = jsSlice(trim(f), 40)
	}
	return r
}

var reFit = map[string]*regexp.Regexp{}

func fitTime(text, label string) any {
	re, ok := reFit[label]
	if !ok {
		re = regexp.MustCompile(`(?m)^` + regexp.QuoteMeta(label) + `:\s*([\d:]+)`)
		reFit[label] = re
	}
	s, found := group(re, text)
	return clock(s, found)
}

var (
	reVO2    = regexp.MustCompile(`VO2max:\s*(\d+)`)
	reLevel2 = regexp.MustCompile(`Running Level:\s*(\d+)`)
)

func ParseFitness(text string) Row {
	r := Row{}
	set(r, "vo2max", num(reVO2, text))
	set(r, "running_level", num(reLevel2, text))
	set(r, "threshold_pace_s_km", fitTime(text, "Threshold Pace"))
	set(r, "pred_5k_s", fitTime(text, "5 km Prediction"))
	set(r, "pred_10k_s", fitTime(text, "10 km Prediction"))
	set(r, "pred_hm_s", fitTime(text, "Half Marathon Prediction"))
	set(r, "pred_m_s", fitTime(text, "Marathon Prediction"))
	return r
}
