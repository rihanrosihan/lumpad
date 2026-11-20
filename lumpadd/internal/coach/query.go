package coach

import (
	"encoding/json"
	"fmt"
	"math"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/rihanrosihan/lumpad/lumpadd/internal/athlete"
)

// Query decomposition (blueprint §3.4.1): a free-text question → SQL filters over the session table, the text query for full-text search,
// and topics that pick the relevant correlation edges. Pure and deterministic (no model call), English + Indonesian. Port of server/intel/query.js.

type Gear struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// Filters keeps the order in which keys were set (the JSON the model reads lists them in that order, as in the Node app).
type Filters struct {
	keys []string
	m    map[string]any
}

func newFilters() *Filters { return &Filters{m: map[string]any{}} }
func (f *Filters) set(k string, v any) {
	if _, ok := f.m[k]; !ok {
		f.keys = append(f.keys, k)
	}
	f.m[k] = v
}
func (f *Filters) has(k string) bool   { _, ok := f.m[k]; return ok }
func (f *Filters) str(k string) string { s, _ := f.m[k].(string); return s }
func (f *Filters) MarshalJSON() ([]byte, error) {
	var sb strings.Builder
	sb.WriteByte('{')
	for i, k := range f.keys {
		if i > 0 {
			sb.WriteByte(',')
		}
		kb, _ := json.Marshal(k)
		vb, err := marshalNoEscape(f.m[k])
		if err != nil {
			return nil, err
		}
		sb.Write(kb)
		sb.WriteByte(':')
		sb.WriteString(vb)
	}
	sb.WriteByte('}')
	return []byte(sb.String()), nil
}
func (f *Filters) Len() int { return len(f.keys) }

type Decomposed struct {
	Filters      *Filters
	Topics       []string
	HasFilters   bool
	Shoes        []Gear
	DistKm       *[2]float64
	From, To     string
	HRMin, HRMax float64
	Indoor       bool
}

var months = []string{"jan|january|januari", "feb|february|februari", "mar|march|maret", "apr|april", "may|mei", "jun|june|juni", "jul|july|juli", "aug|august|agu|agustus", "sep|sept|september", "oct|october|okt|oktober", "nov|november", "dec|december|des|desember"}
var raceWords = [][2]string{{"borobudur", "Borobudur"}, {"jakim", "Jakim"}, {"jrf", "JRF"}, {"lps", "LPS"}, {"sentul", "Sentul"}}
var stopShoe = map[string]bool{"hoka": true, "asics": true, "nike": true, "adidas": true, "puma": true, "saucony": true, "new": true, "balance": true, "brooks": true, "mizuno": true, "shoe": true, "shoes": true, "running": true, "run": true}

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

var (
	reYesterday = regexp.MustCompile(`\byesterday|kemarin\b`)
	reToday     = regexp.MustCompile(`\btoday|hari ini\b`)
	reLastN     = regexp.MustCompile(`\b(?:last|past|terakhir)\s+(\d{1,3})\s*(day|days|hari|week|weeks|minggu|month|months|bulan)\b`)
	reNAgo      = regexp.MustCompile(`\b(\d{1,3})\s*(day|days|hari|week|weeks|minggu|month|months|bulan)\s+(?:terakhir|ago)\b`)
	reLastWeek  = regexp.MustCompile(`\b(last|past) week|minggu lalu|seminggu\b`)
	reLastMonth = regexp.MustCompile(`\b(last|past) month|bulan lalu\b`)
	reISO       = regexp.MustCompile(`\b(20\d{2}-\d{2}-\d{2})\b`)
	reYear      = regexp.MustCompile(`\b(20\d{2})\b`)
	reKm        = regexp.MustCompile(`\b(\d{1,2}(?:[.,]\d)?)\s?(?:k|km)\b`)
	reHalf      = regexp.MustCompile(`half|\bhm\b|setengah`)
	reFull      = regexp.MustCompile(`marathon|\bfm\b|maraton`)
	reLong      = regexp.MustCompile(`long run|lari panjang|\blr\b`)
	reEasy      = regexp.MustCompile(`\beasy|santai|z2\b|zone 2`)
	reQuality   = regexp.MustCompile(`tempo|threshold|interval|repeat|quality`)
	reRace      = regexp.MustCompile(`\brace|lomba\b`)
	reIndoor    = regexp.MustCompile(`treadmill|bodimax|indoor`)
	reAbove     = regexp.MustCompile(`(?:above|over|more than|>|di atas|lebih dari)\s*(\d{3})\s*(?:bpm)?`)
	reBelow     = regexp.MustCompile(`(?:below|under|less than|<|di bawah|kurang dari)\s*(\d{3})\s*(?:bpm)?`)
	reX2        = regexp.MustCompile(`x2\b`)
	reShoeWord  = regexp.MustCompile(`shoe|sepatu`)
	reHeat      = regexp.MustCompile(`heat|panas|wbgt|humid`)
	reNonAlnum  = regexp.MustCompile(`[^a-z0-9]+`)
	monthRes    = func() []*regexp.Regexp {
		out := make([]*regexp.Regexp, 12)
		for i, m := range months {
			out[i] = regexp.MustCompile(`(?:\b(?:in|on|during|since|bulan|sejak)\s+(?:` + m + `)\b(?:\s+(20\d{2}))?|\b(?:` + m + `)\s+(20\d{2})\b|\b\d{1,2}\s+(?:` + m + `)\b(?:\s+(20\d{2}))?)`)
		}
		return out
	}()
)

func isoAddDays(s string, n int) string {
	t, _ := time.Parse("2006-01-02", s)
	return t.AddDate(0, 0, n).Format("2006-01-02")
}
func round1(x float64) float64 { return math.Floor(x*10+0.5) / 10 }

// Decompose: today is the question's "now" (YYYY-MM-DD, WIB); gear is the athlete's garage.
func Decompose(question, today string, gear []Gear) Decomposed {
	q := jsLower(question)
	f := newFilters()
	var from, to string
	setRange := func(a, b string) { from, to = a, b; f.set("from", a); f.set("to", b) }
	if reYesterday.MatchString(q) {
		setRange(isoAddDays(today, -1), isoAddDays(today, -1))
	} else if reToday.MatchString(q) {
		setRange(today, today)
	} else if m := reLastN.FindStringSubmatch(q); m != nil || func() bool { m = reNAgo.FindStringSubmatch(q); return m != nil }() {
		n, _ := strconv.Atoi(m[1])
		unit := 1
		if strings.Contains(m[2], "week") || strings.Contains(m[2], "minggu") {
			unit = 7
		} else if strings.Contains(m[2], "month") || strings.Contains(m[2], "bulan") {
			unit = 30
		}
		setRange(isoAddDays(today, -n*unit), today)
	} else if reLastWeek.MatchString(q) {
		setRange(isoAddDays(today, -7), today)
	} else if reLastMonth.MatchString(q) {
		setRange(isoAddDays(today, -30), today)
	}
	if m := reISO.FindStringSubmatch(q); m != nil {
		setRange(m[1], m[1])
	} else if from == "" {
		for i := 0; i < 12; i++ {
			mm := monthRes[i].FindStringSubmatch(q)
			if mm == nil {
				continue
			}
			yy := mm[1] + mm[2] + mm[3]
			var y int
			if yy != "" {
				y, _ = strconv.Atoi(yy)
			} else {
				cm, _ := strconv.Atoi(today[5:7])
				cy, _ := strconv.Atoi(today[0:4])
				if i+1 > cm {
					y = cy - 1
				} else {
					y = cy
				}
			}
			s := fmt.Sprintf("%04d-%02d-01", y, i+1)
			e := time.Date(y, time.Month(i+2), 0, 0, 0, 0, 0, time.UTC).Format("2006-01-02")
			setRange(s, e)
			break
		}
	}
	// named races → that race day (newest matching, or the year given)
	for _, rw := range raceWords {
		if !strings.Contains(q, rw[0]) {
			continue
		}
		yr := ""
		if m := reYear.FindStringSubmatch(q); m != nil {
			yr = m[1]
		}
		var hit *athlete.Race
		for i := range athlete.Athlete.Races {
			r := &athlete.Athlete.Races[i]
			if strings.Contains(r.Name, rw[1]) && (yr == "" || strings.HasPrefix(r.Date, yr)) {
				hit = r
			}
		}
		if hit != nil {
			f.set("race", hit.Name)
			f.set("race_date", hit.Date)
			if from == "" {
				setRange(hit.Date, hit.Date)
			}
		}
	}
	// distance / type
	d := Decomposed{Filters: f}
	var dist *[2]float64
	if m := reKm.FindStringSubmatch(q); m != nil {
		k, _ := strconv.ParseFloat(strings.Replace(m[1], ",", ".", 1), 64)
		if k >= 1 {
			dist = &[2]float64{round1(k * 0.85), round1(k * 1.15)}
		}
	}
	if reHalf.MatchString(q) {
		dist = &[2]float64{19, 24}
	} else if reFull.MatchString(q) && !strings.Contains(q, "half") {
		dist = &[2]float64{35, 50}
	}
	var kinds []string
	if reLong.MatchString(q) {
		kinds = append(kinds, "long")
		if dist == nil {
			dist = &[2]float64{16, 50}
		}
	}
	if reEasy.MatchString(q) {
		kinds = append(kinds, "easy")
	}
	if reQuality.MatchString(q) {
		kinds = append(kinds, "quality")
	}
	if reRace.MatchString(q) {
		kinds = append(kinds, "race")
	}
	if dist != nil {
		f.set("dist_km", []float64{dist[0], dist[1]})
		d.DistKm = dist
	}
	if reIndoor.MatchString(q) {
		f.set("indoor", true)
		d.Indoor = true
	}
	if len(kinds) > 0 {
		f.set("kinds", kinds)
	}
	if m := reAbove.FindStringSubmatch(q); m != nil {
		v, _ := strconv.ParseFloat(m[1], 64)
		f.set("hr_min", v)
		d.HRMin = v
	}
	if m := reBelow.FindStringSubmatch(q); m != nil {
		v, _ := strconv.ParseFloat(m[1], 64)
		f.set("hr_max", v)
		d.HRMax = v
	}
	// shoes from the athlete's own garage: a distinctive word of the model name
	var shoes []Gear
	for _, g := range gear {
		hit := false
		for _, w := range reNonAlnum.Split(jsLower(g.Name), -1) {
			if len(w) >= 4 && !stopShoe[w] && strings.Contains(q, w) {
				hit = true
			}
		}
		if reX2.MatchString(q) && regexp.MustCompile(`(?i)x2\b`).MatchString(g.Name) {
			hit = true
		}
		if hit {
			shoes = append(shoes, g)
		}
	}
	if len(shoes) > 0 {
		f.set("shoes", shoes)
		d.Shoes = shoes
	}
	d.From, d.To = from, to
	if f.has("from") {
		d.From, d.To = f.str("from"), f.str("to")
	}
	seen, topics := map[string]bool{}, []string{}
	for _, tr := range topicRules {
		if tr.re.MatchString(q) {
			for _, id := range tr.ids {
				if !seen[id] {
					seen[id] = true
					topics = append(topics, id)
				}
			}
		}
	}
	if len(shoes) > 0 || reShoeWord.MatchString(q) {
		topics = append(topics, "shoes")
	}
	if reHeat.MatchString(q) {
		topics = append(topics, "heat")
	}
	d.Topics = topics
	d.HasFilters = f.Len() > 0
	return d
}

// SQL: the filters as a parameterised WHERE over train.session_metric (s) joined to train.run_weather (w); parameters are $1.. in order.
func (d Decomposed) SQL() (where string, params []any) {
	params = []any{}
	var w []string
	add := func(cond string, vals ...any) {
		params = append(params, vals...)
		w = append(w, fmt.Sprintf(cond, placeholders(len(params)-len(vals), len(vals))...))
	}
	if d.Filters.has("from") {
		add("s.date >= %s::date", d.From)
	}
	if d.Filters.has("to") {
		add("s.date <= %s::date", d.To)
	}
	if d.DistKm != nil {
		add("s.distance_m BETWEEN %s AND %s", d.DistKm[0]*1000, d.DistKm[1]*1000)
	}
	if d.HRMin != 0 {
		add("s.run_hr >= %s", d.HRMin)
	}
	if d.HRMax != 0 {
		add("s.run_hr <= %s", d.HRMax)
	}
	if d.Indoor {
		w = append(w, "COALESCE(w.indoor, 0) = 1")
	}
	if len(d.Shoes) > 0 {
		ph := make([]string, len(d.Shoes))
		for i, g := range d.Shoes {
			params = append(params, g.ID)
			ph[i] = "$" + strconv.Itoa(len(params))
		}
		w = append(w, "s.shoe_id IN ("+strings.Join(ph, ",")+")")
	}
	if len(w) > 0 {
		where = "WHERE " + strings.Join(w, " AND ")
	}
	return
}
func placeholders(start, n int) []any {
	out := make([]any, n)
	for i := range out {
		out[i] = "$" + strconv.Itoa(start+i+1)
	}
	return out
}
