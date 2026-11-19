package coach

import (
	"math"
	"regexp"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf16"
)

// "Every number in an answer must exist in the evidence": port of the number checks in server/intel/writeback.js.

var (
	reDate   = regexp.MustCompile(`\d{4}-\d{2}-\d{2}`)
	reClock  = regexp.MustCompile(`\b\d{1,2}:\d{2}(?::\d{2})?\b`)
	reCite   = regexp.MustCompile(`\[\d+\]`)
	reNumber = regexp.MustCompile(`-?\d+(?:[.,]\d+)?`)
	reToken  = regexp.MustCompile(`[\p{L}\p{N}]{4,}`)
)

func strip(t string) string {
	t = reDate.ReplaceAllString(t, " ")
	t = reClock.ReplaceAllString(t, " ")
	return reCite.ReplaceAllString(t, " ")
}

// NumbersOf: every number in the text (dates, clock times and [n] citations removed first), decimal comma accepted.
func NumbersOf(t string) []float64 {
	out := []float64{}
	for _, m := range reNumber.FindAllString(strip(t), -1) {
		f, err := strconv.ParseFloat(strings.Replace(m, ",", ".", 1), 64)
		if err == nil && !math.IsInf(f, 0) && !math.IsNaN(f) {
			out = append(out, f)
		}
	}
	return out
}
func TimesOf(t string) []string {
	out := reClock.FindAllString(t, -1)
	if out == nil {
		return []string{}
	}
	return out
}

func trivial(x float64) bool { return x == math.Trunc(x) && math.Abs(x) <= 12 }
func near(a, b float64) bool { return math.Abs(a-b) <= math.Max(0.051, math.Abs(b)*0.011) }

// JSNum formats a number the way JS String(x) does for ordinary magnitudes.
func JSNum(x float64) string {
	if x == 0 {
		return "0"
	}
	return strconv.FormatFloat(x, 'f', -1, 64)
}

// Unverified lists the numbers and times of text that the evidence corpus does not contain (trivial integers ≤ 12 and years 2024–2030 are exempt).
func Unverified(text, corpus string) []string {
	have, tm, bad := NumbersOf(corpus), map[string]bool{}, []string{}
	for _, t := range TimesOf(corpus) {
		tm[t] = true
	}
	for _, n := range NumbersOf(text) {
		if trivial(n) || (n >= 2024 && n <= 2030) {
			continue
		}
		ok := false
		for _, h := range have {
			if near(n, h) {
				ok = true
				break
			}
		}
		if !ok {
			bad = append(bad, JSNum(n))
		}
	}
	for _, t := range TimesOf(text) {
		if !tm[t] {
			bad = append(bad, t)
		}
	}
	return bad
}

// Tokens / Jaccard: the near-duplicate test for memory write-back (tokens of 4+ letters or digits, lower-cased).
func Tokens(s string) map[string]bool {
	out := map[string]bool{}
	for _, m := range reToken.FindAllString(jsLower(s), -1) {
		out[m] = true
	}
	return out
}
func Jaccard(a, b map[string]bool) float64 {
	i := 0
	for x := range a {
		if b[x] {
			i++
		}
	}
	d := len(a) + len(b) - i
	if d == 0 {
		d = 1
	}
	return float64(i) / float64(d)
}

// jsSliceU16: String.prototype.slice(from, to) on UTF-16 code units (negative `from` counts from the end is not needed here)
func jsSliceU16(s string, from, to int) string {
	u := utf16.Encode([]rune(s))
	if from < 0 {
		from = 0
	}
	if to > len(u) {
		to = len(u)
	}
	if from >= to {
		return ""
	}
	return string(utf16.Decode(u[from:to]))
}
func u16Index(s string, byteIdx int) int { return len(utf16.Encode([]rune(s[:byteIdx]))) }

// jsLower is String.prototype.toLowerCase: full case mapping, which differs from Go's simple mapping in two places that matter here —
// U+0130 (İ) becomes "i" + U+0307, and a capital sigma at the end of a word becomes the final form ς.
func jsLower(s string) string {
	rs := []rune(s)
	var b strings.Builder
	for i, r := range rs {
		switch {
		case r == 0x130:
			b.WriteString("i\u0307")
		case r == 0x3A3 && i > 0 && unicode.IsLetter(rs[i-1]) && (i+1 >= len(rs) || !unicode.IsLetter(rs[i+1])):
			b.WriteRune(0x3C2)
		default:
			b.WriteRune(unicode.ToLower(r))
		}
	}
	return b.String()
}

// ---- strict check
// The Node check accepts a number when ANY number in the whole prompt (about 1,000 of them on a real context) is within ±0.051 or 1.1 %:
// on the athlete's data every invented value from 0.01 to 0.99 passes, and about 80 % of invented values from 10 to 199. The strict check
// enforces the rule the prompt states ("every body number must appear in a cited item"): a number must equal, at the precision it is written
// with, a number in the cited items. Rounding is allowed (36.92 may be written 36.9), invention is not.

var reNumberTok = regexp.MustCompile(`-?\d+(?:[.,]\d+)?`)

type numTok struct {
	v   float64
	dec int
}

func numToks(t string) []numTok {
	out := []numTok{}
	for _, m := range reNumberTok.FindAllString(strip(t), -1) {
		s := strings.Replace(m, ",", ".", 1)
		f, err := strconv.ParseFloat(s, 64)
		if err != nil || math.IsInf(f, 0) {
			continue
		}
		dec := 0
		if i := strings.IndexByte(s, '.'); i >= 0 {
			dec = len(s) - i - 1
		}
		out = append(out, numTok{f, dec})
	}
	return out
}

// UnverifiedStrict: numbers and times of text that the evidence (the cited items) does not contain. Years 2024–2030 and whole numbers up to 12 are exempt, as before.
func UnverifiedStrict(text, evidence string) []string {
	have, tm, bad := numToks(evidence), map[string]bool{}, []string{}
	for _, t := range TimesOf(evidence) {
		tm[t] = true
	}
	for _, n := range numToks(text) {
		if (n.dec == 0 && trivial(n.v)) || (n.v >= 2024 && n.v <= 2030) {
			continue
		}
		ok := false
		for _, h := range have {
			d := min(n.dec, h.dec) // compare at the coarser of the two precisions
			if math.Abs(n.v-h.v) <= 0.5*math.Pow(10, -float64(d))+1e-9 {
				ok = true
				break
			}
		}
		if !ok {
			bad = append(bad, JSNum(n.v))
		}
	}
	for _, t := range TimesOf(text) {
		if !tm[t] {
			bad = append(bad, t)
		}
	}
	return bad
}
