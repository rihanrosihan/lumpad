package coach

import (
	"fmt"
	"math"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// Query decomposition and privacy redaction (Phase 4-e): deterministic Go port of server/intel/query.js and redact() in prompt.js.

type Gear struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type QueryFilters struct {
	From     string     `json:"from,omitempty"`
	To       string     `json:"to,omitempty"`
	Race     string     `json:"race,omitempty"`
	RaceDate string     `json:"race_date,omitempty"`
	DistKm   *[2]float64 `json:"dist_km,omitempty"`
	Kinds    []string   `json:"kinds,omitempty"`
	Indoor   bool       `json:"indoor,omitempty"`
	HRMin    *int       `json:"hr_min,omitempty"`
	HRMax    *int       `json:"hr_max,omitempty"`
	Shoes    []Gear     `json:"shoes,omitempty"`
}

type DecomposedQuery struct {
	Filters    QueryFilters `json:"filters"`
	Topics     []string     `json:"topics"`
	HasFilters bool         `json:"has_filters"`
}

type knownRace struct {
	date string
	name string
}

var athleteRaces = []knownRace{
	{"2024-12-08", "Milo ACTIV 2024"},
	{"2025-01-12", "Soekarno Run"},
	{"2025-06-15", "LPS Monas HM"},
	{"2025-08-17", "Sentul Ultra 17K"},
	{"2025-10-25", "JRF HM 2025"},
	{"2025-12-07", "Milo Active Race 10K"},
	{"2026-06-14", "Jakim FM 2026"},
	{"2026-07-26", "Head & Shoulders 10K"},
	{"2026-09-13", "MILO ACTIV 10K 2026"},
	{"2026-10-24", "JRF HM 2026"},
	{"2026-10-25", "JRF FM 2026"},
	{"2026-11-15", "Borobudur FM 2026"},
}

var (
	reYest      = regexp.MustCompile(`\b(?:yesterday|kemarin)\b`)
	reToday     = regexp.MustCompile(`\b(?:today|hari ini)\b`)
	reLastN     = regexp.MustCompile(`\b(?:last|past|terakhir)\s+(\d{1,3})\s*(day|days|hari|week|weeks|minggu|month|months|bulan)\b`)
	reNAgo      = regexp.MustCompile(`\b(\d{1,3})\s*(day|days|hari|week|weeks|minggu|month|months|bulan)\s+(?:terakhir|ago)\b`)
	reLastWeek  = regexp.MustCompile(`\b(?:(?:last|past) week|minggu lalu|seminggu)\b`)
	reLastMonth = regexp.MustCompile(`\b(?:(?:last|past) month|bulan lalu)\b`)
	reISODate   = regexp.MustCompile(`\b(20\d{2}-\d{2}-\d{2})\b`)
	reYear      = regexp.MustCompile(`\b(20\d{2})\b`)
	reDistKm    = regexp.MustCompile(`\b(\d{1,2}(?:[.,]\d)?)\s?(?:k|km)\b`)
	reHalf      = regexp.MustCompile(`half|\bhm\b|setengah`)
	reMarathon  = regexp.MustCompile(`marathon|\bfm\b|maraton`)
	reLongRun   = regexp.MustCompile(`long run|lari panjang|\blr\b`)
	reEasy      = regexp.MustCompile(`\beasy|santai|z2\b|zone 2`)
	reQuality   = regexp.MustCompile(`tempo|threshold|interval|repeat|quality`)
	reRaceKind  = regexp.MustCompile(`\brace|lomba\b`)
	reIndoor    = regexp.MustCompile(`treadmill|bodimax|indoor`)
	reHRMin     = regexp.MustCompile(`(?:above|over|more than|>|di atas|lebih dari)\s*(\d{3})\s*(?:bpm)?`)
	reHRMax     = regexp.MustCompile(`(?:below|under|less than|<|di bawah|kurang dari)\s*(\d{3})\s*(?:bpm)?`)
	reWordSplit = regexp.MustCompile(`[^a-z0-9]+`)
	reX2        = regexp.MustCompile(`(?i)x2\b`)
	reShoeTopic = regexp.MustCompile(`shoe|sepatu`)
	reHeatTopic = regexp.MustCompile(`heat|panas|wbgt|humid`)
)

var monthPatterns = func() []*regexp.Regexp {
	months := []string{
		`jan|january|januari`, `feb|february|februari`, `mar|march|maret`, `apr|april`,
		`may|mei`, `jun|june|juni`, `jul|july|juli`, `aug|august|agu|agustus`,
		`sep|sept|september`, `oct|october|okt|oktober`, `nov|november`, `dec|december|des|desember`,
	}
	out := make([]*regexp.Regexp, 12)
	for i, m := range months {
		pat := fmt.Sprintf(`(?:\b(?:in|on|during|since|bulan|sejak)\s+(?:%s)\b(?:\s+(20\d{2}))?|\b(?:%s)\s+(20\d{2})\b|\b\d{1,2}\s+(?:%s)\b(?:\s+(20\d{2}))?)`, m, m, m)
		out[i] = regexp.MustCompile(pat)
	}
	return out
}()

var raceKeywords = [][2]string{
	{"borobudur", "Borobudur"}, {"jakim", "Jakim"}, {"jrf", "JRF"}, {"lps", "LPS"}, {"sentul", "Sentul"},
}

var shoeStop = map[string]bool{
	"hoka": true, "asics": true, "nike": true, "adidas": true, "puma": true, "saucony": true,
	"new": true, "balance": true, "brooks": true, "mizuno": true, "shoe": true, "shoes": true, "running": true, "run": true,
}

type topicRule struct {
	re  *regexp.Regexp
	ids []string
}

var topicRules = []topicRule{
	{regexp.MustCompile(`\bgct\b|ground contact|kontak`), []string{"gct_fade", "gct_avg"}},
	{regexp.MustCompile(`drift|decoupl|pa:?hr`), []string{"drift"}},
	{regexp.MustCompile(`stride|langkah`), []string{"stride_fade"}},
	{regexp.MustCompile(`gym|leg day|squat|calf|step-?up|leg curl|strength|beban`), []string{"strength_lower", "strength_upper", "strength_tl"}},
	{regexp.MustCompile(`sleep|tidur`), []string{"sleep_min"}},
	{regexp.MustCompile(`\bhrv\b`), []string{"hrv_dev"}},
	{regexp.MustCompile(`threshold|double|tempo|ambang`), []string{"thr_min", "double_days", "quality_sessions", "pace_hr150"}},
	{regexp.MustCompile(`efficien|\bef\b|economy|ekonomi`), []string{"ef_resid"}},
	{regexp.MustCompile(`durab|fade|run.?share|walk|jalan kaki`), []string{"run_share_long"}},
	{regexp.MustCompile(`volume|mileage|km per week|weekly`), []string{"run_km", "run_tl"}},
}

func addDaysISO(iso string, n int) string {
	t, err := time.Parse("2006-01-02", iso)
	if err != nil {
		return iso
	}
	return t.AddDate(0, 0, n).Format("2006-01-02")
}

// Decompose turns a free-text question into deterministic SQL filters and correlation topics.
func Decompose(question, today string, gear []Gear) DecomposedQuery {
	if today == "" {
		today = time.Now().UTC().Add(7 * time.Hour).Format("2006-01-02")
	}
	q := strings.ToLower(question)
	var f QueryFilters

	if reYest.MatchString(q) {
		d := addDaysISO(today, -1)
		f.From, f.To = d, d
	} else if reToday.MatchString(q) {
		f.From, f.To = today, today
	} else if m := reLastN.FindStringSubmatch(q); m != nil {
		n, _ := strconv.Atoi(m[1])
		unit := 1
		if strings.Contains(m[2], "week") || strings.Contains(m[2], "minggu") {
			unit = 7
		} else if strings.Contains(m[2], "month") || strings.Contains(m[2], "bulan") {
			unit = 30
		}
		f.From, f.To = addDaysISO(today, -n*unit), today
	} else if m := reNAgo.FindStringSubmatch(q); m != nil {
		n, _ := strconv.Atoi(m[1])
		unit := 1
		if strings.Contains(m[2], "week") || strings.Contains(m[2], "minggu") {
			unit = 7
		} else if strings.Contains(m[2], "month") || strings.Contains(m[2], "bulan") {
			unit = 30
		}
		f.From, f.To = addDaysISO(today, -n*unit), today
	} else if reLastWeek.MatchString(q) {
		f.From, f.To = addDaysISO(today, -7), today
	} else if reLastMonth.MatchString(q) {
		f.From, f.To = addDaysISO(today, -30), today
	}

	if m := reISODate.FindStringSubmatch(q); m != nil {
		f.From, f.To = m[1], m[1]
	} else if f.From == "" {
		todayYr, _ := strconv.Atoi(today[:4])
		todayMo, _ := strconv.Atoi(today[5:7])
		for i, re := range monthPatterns {
			mm := re.FindStringSubmatch(q)
			if mm == nil {
				continue
			}
			yy := mm[1]
			if yy == "" {
				yy = mm[2]
			}
			if yy == "" {
				yy = mm[3]
			}
			y := todayYr
			if yy != "" {
				y, _ = strconv.Atoi(yy)
			} else if i+1 > todayMo {
				y = todayYr - 1
			}
			first := time.Date(y, time.Month(i+1), 1, 0, 0, 0, 0, time.UTC)
			last := first.AddDate(0, 1, -1)
			f.From = first.Format("2006-01-02")
			f.To = last.Format("2006-01-02")
			break
		}
	}

	// Named races
	yr := ""
	if m := reYear.FindStringSubmatch(q); m != nil {
		yr = m[1]
	}
	for _, rw := range raceKeywords {
		if !strings.Contains(q, rw[0]) {
			continue
		}
		var hit *knownRace
		for i := range athleteRaces {
			r := &athleteRaces[i]
			if strings.Contains(r.name, rw[1]) && (yr == "" || strings.HasPrefix(r.date, yr)) {
				hit = r
			}
		}
		if hit != nil {
			f.Race = hit.name
			f.RaceDate = hit.date
			if f.From == "" {
				f.From, f.To = hit.date, hit.date
			}
		}
	}

	// Distance / kinds
	if m := reDistKm.FindStringSubmatch(q); m != nil {
		k, err := strconv.ParseFloat(strings.Replace(m[1], ",", ".", 1), 64)
		if err == nil && k >= 1 {
			d := [2]float64{math.Round(k*0.85*10) / 10, math.Round(k*1.15*10) / 10}
			f.DistKm = &d
		}
	}
	if reHalf.MatchString(q) {
		d := [2]float64{19, 24}
		f.DistKm = &d
	} else if reMarathon.MatchString(q) && !strings.Contains(q, "half") {
		d := [2]float64{35, 50}
		f.DistKm = &d
	}
	if reLongRun.MatchString(q) {
		f.Kinds = append(f.Kinds, "long")
		if f.DistKm == nil {
			d := [2]float64{16, 50}
			f.DistKm = &d
		}
	}
	if reEasy.MatchString(q) {
		f.Kinds = append(f.Kinds, "easy")
	}
	if reQuality.MatchString(q) {
		f.Kinds = append(f.Kinds, "quality")
	}
	if reRaceKind.MatchString(q) {
		f.Kinds = append(f.Kinds, "race")
	}
	if reIndoor.MatchString(q) {
		f.Indoor = true
	}

	// Heart rate thresholds
	if m := reHRMin.FindStringSubmatch(q); m != nil {
		v, _ := strconv.Atoi(m[1])
		f.HRMin = &v
	}
	if m := reHRMax.FindStringSubmatch(q); m != nil {
		v, _ := strconv.Atoi(m[1])
		f.HRMax = &v
	}

	// Shoes
	for _, g := range gear {
		matched := false
		for _, w := range reWordSplit.Split(strings.ToLower(g.Name), -1) {
			if len(w) >= 4 && !shoeStop[w] && strings.Contains(q, w) {
				matched = true
				break
			}
		}
		if !matched && reX2.MatchString(q) && reX2.MatchString(g.Name) {
			matched = true
		}
		if matched {
			f.Shoes = append(f.Shoes, g)
		}
	}

	// Topics
	seen := map[string]bool{}
	topics := []string{}
	addTopic := func(id string) {
		if !seen[id] {
			seen[id] = true
			topics = append(topics, id)
		}
	}
	for _, tr := range topicRules {
		if tr.re.MatchString(q) {
			for _, id := range tr.ids {
				addTopic(id)
			}
		}
	}
	if len(f.Shoes) > 0 || reShoeTopic.MatchString(q) {
		addTopic("shoes")
	}
	if reHeatTopic.MatchString(q) {
		addTopic("heat")
	}

	has := f.From != "" || f.To != "" || f.Race != "" || f.DistKm != nil || len(f.Kinds) > 0 || f.Indoor || f.HRMin != nil || f.HRMax != nil || len(f.Shoes) > 0
	return DecomposedQuery{Filters: f, Topics: topics, HasFilters: has}
}

// FilterSQL builds a parameterised PostgreSQL WHERE clause ($1, $2, …) over train.session_metric (s) LEFT JOIN train.run_weather (w).
func FilterSQL(f QueryFilters) (string, []any) {
	var where []string
	var params []any
	add := func(cond string, vals ...any) {
		where = append(where, cond)
		params = append(params, vals...)
	}
	if f.From != "" {
		add(fmt.Sprintf("s.date >= $%d::date", len(params)+1), f.From)
	}
	if f.To != "" {
		add(fmt.Sprintf("s.date <= $%d::date", len(params)+1), f.To)
	}
	if f.DistKm != nil {
		add(fmt.Sprintf("s.distance_m BETWEEN $%d AND $%d", len(params)+1, len(params)+2), f.DistKm[0]*1000, f.DistKm[1]*1000)
	}
	if f.HRMin != nil {
		add(fmt.Sprintf("s.run_hr >= $%d", len(params)+1), *f.HRMin)
	}
	if f.HRMax != nil {
		add(fmt.Sprintf("s.run_hr <= $%d", len(params)+1), *f.HRMax)
	}
	if f.Indoor {
		where = append(where, "COALESCE(w.indoor, 0) = 1")
	}
	if len(f.Shoes) > 0 {
		ph := make([]string, len(f.Shoes))
		for i, sh := range f.Shoes {
			ph[i] = fmt.Sprintf("$%d", len(params)+1)
			params = append(params, sh.ID)
		}
		where = append(where, "s.shoe_id IN ("+strings.Join(ph, ",")+")")
	}
	if len(where) == 0 {
		return "", nil
	}
	return "WHERE " + strings.Join(where, " AND "), params
}

// Privacy redaction (port of redact() in server/intel/prompt.js).
var (
	reRedactRihan    = regexp.MustCompile(`(?i)\bRihan(?:\s+Rosihan)?\b`)
	reRedactRosihan  = regexp.MustCompile(`(?i)\bRosihan\b`)
	reRedactEmployer = regexp.MustCompile(`(?i)Pizza Hut(?: Indonesia)?`)
	reRedactEmail    = regexp.MustCompile(`[\w.+-]+@[\w-]+\.[\w.-]+`)
	reRedactURL      = regexp.MustCompile(`https?://\S+`)
	reRedactKey      = regexp.MustCompile(`\b(?:sk|pk)-[A-Za-z0-9]{16,}\b`)
	reRedactHex      = regexp.MustCompile(`\b[0-9a-f]{32,}\b`)
	reRedactPhone    = regexp.MustCompile(`\b(?:\+?62|0)8\d{8,11}\b`)
)

func Redact(t string) string {
	t = reRedactRihan.ReplaceAllString(t, "the athlete")
	t = reRedactRosihan.ReplaceAllString(t, "the athlete")
	t = reRedactEmployer.ReplaceAllString(t, "the employer")
	t = reRedactEmail.ReplaceAllString(t, "[email]")
	t = reRedactURL.ReplaceAllString(t, "[url]")
	t = reRedactKey.ReplaceAllString(t, "[secret]")
	t = reRedactHex.ReplaceAllString(t, "[secret]")
	t = reRedactPhone.ReplaceAllString(t, "[phone]")
	return t
}
