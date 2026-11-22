package graph

import (
	"regexp"
	"strings"
	"unicode"
)

// Structured contradictions (replaces the old keyword-polarity guess): a claim is (metric, direction) read from one sentence; two memories contradict only when
// the SAME metric moves in OPPOSITE directions in a shared context. Deterministic, English + Indonesian, conservative on purpose: a missed contradiction is cheap,
// a false one misleads the coach.

type metricDef struct {
	ID string
	re *regexp.Regexp
}

var metricDefs = []metricDef{
	{"gct", regexp.MustCompile(`(?i)\b(gct|ground contact|stance time|kontak)\b`)},
	{"cadence", regexp.MustCompile(`(?i)\b(cadence|spm|langkah per menit)\b`)},
	{"stride", regexp.MustCompile(`(?i)\b(stride|step length|panjang langkah)\b`)},
	{"drift", regexp.MustCompile(`(?i)\b(drift|decoupl\w*|pa:?hr)\b`)},
	{"efficiency", regexp.MustCompile(`(?i)\b(efficiency|economy|ekonomi|ef)\b`)},
	{"heart_rate", regexp.MustCompile(`(?i)\b(heart rate|hr|detak jantung)\b`)},
	{"run_share", regexp.MustCompile(`(?i)\b(run.?share|walking|walk breaks?)\b`)},
	{"fade", regexp.MustCompile(`(?i)\b(fade|fades|fading|fade onset)\b`)},
	{"hrv", regexp.MustCompile(`(?i)\b(hrv)\b`)},
	{"sleep", regexp.MustCompile(`(?i)\b(sleep|tidur)\b`)},
	{"load", regexp.MustCompile(`(?i)\b(training load|load|volume|mileage)\b`)},
}

var (
	upWords   = map[string]bool{"increase": true, "increases": true, "increased": true, "rise": true, "rises": true, "rose": true, "higher": true, "up": true, "creep": true, "creeps": true, "climb": true, "climbs": true, "grows": true, "naik": true, "meningkat": true, "lebih tinggi": true, "tinggi": true, "longer": true}
	downWords = map[string]bool{"decrease": true, "decreases": true, "decreased": true, "drop": true, "drops": true, "dropped": true, "lower": true, "down": true, "fall": true, "falls": true, "fell": true, "reduce": true, "reduces": true, "reduced": true, "turun": true, "menurun": true, "rendah": true, "shorter": true}
)

type Claim struct {
	Metric string
	Dir    int // +1 up, -1 down
	Topics []string
	Terms  map[string]bool
}

func words(s string) []string {
	return strings.FieldsFunc(strings.ToLower(s), func(r rune) bool { return !unicode.IsLetter(r) && !unicode.IsDigit(r) && r != ':' })
}

var sentenceSplit = regexp.MustCompile(`[.!?;\n]+`)

// ClaimsOf reads claims from a text: the nearest direction word within 5 words of a metric mention, negation ("no", "not", "tidak") discarding the claim.
func ClaimsOf(text string) []Claim {
	var out []Claim
	for _, sent := range sentenceSplit.Split(text, -1) {
		ws := words(sent)
		if len(ws) < 3 {
			continue
		}
		if len(sent) > 220 {
			continue // long run-on sentences make direction words unreliable
		}
		topics := topicsOf(sent)
		for _, m := range metricDefs {
			loc := m.re.FindStringIndex(strings.ToLower(sent))
			if loc == nil {
				continue
			}
			pos := len(words(strings.ToLower(sent)[:loc[0]]))
			best, bd := 0, 99
			for i, w := range ws {
				d := i - pos
				if d < 0 {
					d = -d
				}
				if d > 5 || d >= bd {
					continue
				}
				dir := 0
				if upWords[w] {
					dir = 1
				} else if downWords[w] {
					dir = -1
				}
				if dir == 0 {
					continue
				}
				neg := false
				for k := maxInt(0, i-2); k < i; k++ {
					if ws[k] == "no" || ws[k] == "not" || ws[k] == "tidak" || ws[k] == "never" || ws[k] == "without" {
						neg = true
					}
				}
				if !neg {
					best, bd = dir, d
				}
			}
			if best != 0 {
				terms := map[string]bool{}
				for _, w := range ws {
					if len(w) >= 4 && !stop[w] && !upWords[w] && !downWords[w] && !isMetricWord(w) {
						terms[stem(w)] = true
					}
				}
				out = append(out, Claim{Metric: m.ID, Dir: best, Topics: topics, Terms: terms})
			}
		}
	}
	return out
}

func isMetricWord(w string) bool {
	for _, m := range metricDefs {
		if m.re.MatchString(w) {
			return true
		}
	}
	return false
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}

// ConflictMem is a memory prepared for the contradiction check.
type ConflictMem struct {
	ID      int64
	Group   string
	Curated bool // a coach finding / hypothesis (not knowledge-base text): at least one side of a pair must be
	Text    string
}

type Conflict struct {
	A, B   int64
	Metric string
	ADir   int
	BDir   int
}

// StructuredConflicts finds pairs whose claims on the same metric point in opposite directions in a shared context
// (a shared topic, or at least two shared content words besides the metric). Knowledge-base pairs are never compared with each other.
func StructuredConflicts(mems []ConflictMem, maxPairs int) []Conflict {
	claims := make([][]Claim, len(mems))
	for i, m := range mems {
		claims[i] = ClaimsOf(m.Text)
	}
	var out []Conflict
	for i := 0; i < len(mems); i++ {
		for j := i + 1; j < len(mems); j++ {
			if (!mems[i].Curated && !mems[j].Curated) || (mems[i].Group != "" && mems[i].Group == mems[j].Group) {
				continue
			}
			for _, a := range claims[i] {
				done := false
				for _, b := range claims[j] {
					if a.Metric != b.Metric || a.Dir == b.Dir || !sharedContext(a, b) {
						continue
					}
					out = append(out, Conflict{A: mems[i].ID, B: mems[j].ID, Metric: a.Metric, ADir: a.Dir, BDir: b.Dir})
					done = true
					break
				}
				if done {
					break
				}
			}
			if len(out) >= maxPairs {
				return out
			}
		}
	}
	return out
}

// a shared context = at least three shared content words (besides the metric itself): same situation, not just the same topic label
func sharedContext(a, b Claim) bool {
	n := 0
	for t := range a.Terms {
		if b.Terms[t] {
			n++
		}
	}
	return n >= 3
}
