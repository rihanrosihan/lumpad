package coach

import (
	"fmt"
	"math"
	"regexp"
	"strings"
)

// Safety layer: port of server/intel/safety.js. Deterministic, no model call. Two jobs:
//  1) red flags: symptoms that need a clinician → the coach answers with a referral, no training advice, no paid call;
//  2) gate check on answers: while a validated gate is active, any recommendation of a hard session is removed and the reason is shown.
// It never diagnoses and never clears anyone to train. Rules are data (the table below) so they can be tuned without touching the logic.

const Referral = "This needs a doctor, not a training plan. Stop running for now and get this checked by a clinician (or urgent care / emergency services if it is severe or getting worse). The coach does not diagnose and cannot clear you to train."

type RedFlag struct {
	ID     string
	Urgent bool
	Label  string
	re     *regexp.Regexp
}

// English + Bahasa Indonesia. "urgent" = call emergency services; the rest = see a clinician before training.
var RedFlags = []RedFlag{
	{"chest", true, "chest pain or pressure", regexp.MustCompile(`(?i)\b(chest (pain|pressure|tightness)|pain in (my )?chest|nyeri dada|dada (sakit|sesak|terasa berat|nyeri))\b`)},
	{"faint", true, "fainting or near-fainting", regexp.MustCompile(`(?i)\b(faint(ed|ing)?|passed out|black(ed)? out|collapse[d]?|pingsan|hampir pingsan|kolaps)\b`)},
	{"palpitations", false, "palpitations or an irregular heartbeat", regexp.MustCompile(`(?i)\b(palpitation|irregular (heart ?beat|pulse)|(heart|pulse) (was |is |kept |keeps |felt )?(racing|skipping|pounding|fluttering)|jantung (berdebar|berhenti|tidak teratur|kencang sendiri))\b`)},
	{"breath", false, "breathlessness out of proportion", regexp.MustCompile(`(?i)\b(can'?t breathe|short(ness)? of breath at rest|struggling to breathe|sesak (napas|nafas))\b`)},
	{"fever", false, "fever or acute illness", regexp.MustCompile(`(?i)\b(fever|temperature of 3[89]|flu\b|covid|sore throat and (body )?ache|demam|meriang|sakit (tenggorokan|badan))\b`)},
	{"neuro", true, "numbness, weakness or severe headache", regexp.MustCompile(`(?i)\b(numb(ness)?|slurred|sudden weakness|severe headache|kebas|mati rasa|sakit kepala hebat)\b`)},
	{"swelling", false, "swelling, calf pain or a possible stress fracture", regexp.MustCompile(`(?i)\b(swollen|swelling|calf (pain|swelling)|stress fracture|bengkak|retak)\b`)},
	{"pain-worse", false, "worsening or severe pain", regexp.MustCompile(`(?i)\b(pain\b[^.?!]{0,30}\b(getting |gets |is |keeps )?(worse|worsening|more severe)\b|pain (is )?severe|worsening pain|sharp pain|unbearable|nyeri (makin|semakin) (parah|berat)|sakit (banget|sekali|parah))\b`)},
	{"heat", true, "heat illness symptoms", regexp.MustCompile(`(?i)\b(heat ?stroke|stopped sweating|confus(ed|ion)|disoriented|bingung|kram panas)\b`)},
}
var negated = regexp.MustCompile(`(?i)\b(no|not|without|never|denies|tidak|tanpa|bukan)\s+(any\s+)?$`)

type Flag struct {
	ID     string `json:"id"`
	Label  string `json:"label"`
	Urgent bool   `json:"urgent"`
	Quote  string `json:"quote,omitempty"`
}

// RedFlagsIn: the red flags a free text mentions; a flag directly preceded by a negation ("no chest pain") is skipped.
func RedFlagsIn(text string) []Flag {
	out := []Flag{}
	for _, f := range RedFlags {
		loc := f.re.FindStringIndex(text)
		if loc == nil {
			continue
		}
		start := u16Index(text, loc[0])
		if negated.MatchString(jsSliceU16(text, start-14, start)) {
			continue
		}
		out = append(out, Flag{f.ID, f.Label, f.Urgent, text[loc[0]:loc[1]]})
	}
	return out
}

type BP struct{ Sys, Dia *float64 }
type Checkin struct {
	Pain      *float64
	PainTrend string
	Symptoms  map[string]bool
	BP        *BP
}

// CheckinFlags: structured signals (morning check-in, biometrics): pain sites 0–10, symptom flags, blood pressure.
func CheckinFlags(c Checkin) []Flag {
	out := []Flag{}
	if c.Pain != nil && *c.Pain >= 4 {
		out = append(out, Flag{ID: "pain-high", Label: "pain " + JSNum(*c.Pain) + "/10"})
	}
	if c.PainTrend == "rising" {
		out = append(out, Flag{ID: "pain-rising", Label: "pain rising over 3 days"})
	}
	for _, k := range []string{"chest", "faint", "palpitations", "breath", "fever", "swelling", "numbness"} {
		if c.Symptoms[k] {
			out = append(out, Flag{ID: k, Label: k, Urgent: k == "chest" || k == "faint" || k == "numbness"})
		}
	}
	if c.BP != nil && ((c.BP.Sys != nil && *c.BP.Sys >= 180) || (c.BP.Dia != nil && *c.BP.Dia >= 120)) {
		out = append(out, Flag{ID: "bp-crisis", Label: "blood pressure " + jsVal(c.BP.Sys) + "/" + jsVal(c.BP.Dia), Urgent: true})
	}
	return out
}
func jsVal(x *float64) string { // template literal of a possibly missing number
	if x == nil {
		return "undefined"
	}
	return JSNum(*x)
}

// ReferralFor: the answer the coach gives instead of calling a model (shape of a normal answer, no training advice).
func ReferralFor(flags []Flag) map[string]any {
	labels, urgent, ids := make([]string, len(flags)), false, make([]any, len(flags))
	fl := make([]any, len(flags))
	for i, f := range flags {
		labels[i], ids[i] = f.Label, f.ID
		urgent = urgent || f.Urgent
		fl[i] = map[string]any{"type": "injury", "text": f.Label}
	}
	prefix := ""
	if urgent {
		prefix = "Possible emergency: "
	}
	return map[string]any{
		"summary":         fmt.Sprintf("%syou mention %s. %s", prefix, strings.Join(labels, ", "), Referral),
		"analysis_md":     fmt.Sprintf("## Please get this checked first\n\nYou mentioned **%s**.\n\n%s\n\nNo training advice has been generated. Come back once a clinician has seen you and tell the coach what they advised; that guidance overrides anything the coach suggests.", strings.Join(labels, "**, **"), Referral),
		"recommendations": []any{map[string]any{"action": "Stop running and see a clinician", "why": "A symptom that can need medical assessment was reported", "priority": "now"}},
		"flags":           fl, "memory_writes": []any{}, "cited_ids": []any{},
		"safety": map[string]any{"referral": true, "urgent": urgent, "ids": ids},
	}
}

// ---- gate check on answers
type Gate struct {
	Active  bool     `json:"active"`
	Reasons []string `json:"reasons"`
}

func obj(v any) map[string]any  { m, _ := v.(map[string]any); return m }
func num(v any) (float64, bool) { f, ok := v.(float64); return f, ok }

// GateFromTwin: readiness caps, tier compromised/depleted, a weekly-distance spike, or pain ≥ 2/10 inside the last 7 days.
func GateFromTwin(t map[string]any) Gate {
	reasons, r, L := []string{}, obj(t["readiness"]), obj(t["load"])
	if caps, ok := r["caps"].([]any); ok {
		for _, c := range caps {
			reasons = append(reasons, fmt.Sprint(c))
		}
	}
	if tier, _ := r["tier"].(string); tier == "depleted" || tier == "compromised" {
		reasons = append(reasons, "readiness tier "+tier)
	}
	if pct, ok := num(L["km_vs_4wk_avg_pct"]); ok && pct > 30 {
		reasons = append(reasons, "weekly distance +"+JSNum(pct)+"% (> 30%)")
	}
	worst, nan := 0.0, false // Math.max(0, ...values): a missing value makes it NaN, which never reaches the threshold
	for _, sv := range obj(obj(t["injury"])["sites"]) {
		s := obj(sv)
		v := 0.0
		if d, _ := s["last_pain_date"].(string); d != "" {
			if free, ok := num(s["pain_free_days"]); ok && free < 7 {
				if lp, ok := num(s["last_pain"]); ok {
					v = lp
				} else if s["last_pain"] == nil && hasKey(s, "last_pain") {
					v = 0 // null → 0
				} else {
					nan = true
				}
			}
		}
		worst = math.Max(worst, v)
	}
	if !nan && worst >= 2 {
		reasons = append(reasons, "pain "+JSNum(worst)+"/10 in the last 7 days")
	}
	return Gate{len(reasons) > 0, reasons}
}
func hasKey(m map[string]any, k string) bool { _, ok := m[k]; return ok }

var (
	hardRe     = regexp.MustCompile(`(?i)\b(tempo|threshold|interval|repeats?|fartlek|strides? session|hill (repeats|sprints)|speed ?work|time trial|\btt\b|race[- ]?pace|marathon[- ]?pace|\bmp\b|progression run|quality session|long run|lari panjang|lomba|race effort|all[- ]out|vo2)\b`)
	negateHard = regexp.MustCompile(`(?i)\b(no|avoid|skip|do not|don't|instead of|rather than|replace|swap|downgrade|hold off|postpone|jangan|hindari|ganti)\b[^.]{0,40}$`)
)

// GateCheck removes hard-session recommendations while the gate is active (a negated mention such as "skip the tempo" is kept) and tells the athlete why.
// It returns the (possibly new) answer and the removed recommendations.
func GateCheck(parsed map[string]any, gate Gate) (map[string]any, []any) {
	if !gate.Active || parsed == nil {
		return parsed, []any{}
	}
	removed, keep := []any{}, []any{}
	recs, _ := parsed["recommendations"].([]any)
	for _, rv := range recs {
		txt := tpl(obj(rv), "action")
		bad := false
		if loc := hardRe.FindStringIndex(txt); loc != nil {
			bad = !negateHard.MatchString(jsSliceU16(txt, 0, u16Index(txt, loc[0])+1))
		}
		if bad {
			removed = append(removed, rv)
		} else {
			keep = append(keep, rv)
		}
	}
	if len(removed) == 0 {
		return parsed, removed
	}
	first := gate.Reasons
	if len(first) > 3 {
		first = first[:3]
	}
	plural, verb := "", "was"
	if len(removed) > 1 {
		plural, verb = "s", "were"
	}
	note := jsSliceU16(fmt.Sprintf("Safety gate active (%s): %d hard-session recommendation%s %s removed. Easy running, walking or rest only until the gate clears.", strings.Join(first, "; "), len(removed), plural, verb), 0, 300)
	out := map[string]any{}
	for k, v := range parsed {
		out[k] = v
	}
	flags, _ := parsed["flags"].([]any)
	out["recommendations"] = keep
	out["flags"] = append(append([]any{}, flags...), map[string]any{"type": "gate", "text": note})
	acts := make([]any, len(removed))
	for i, rv := range removed {
		acts[i] = obj(rv)["action"]
	}
	out["safety"] = map[string]any{"gate_removed": acts, "reasons": gate.Reasons}
	return out, removed
}

var diagnosisRe = regexp.MustCompile(`(?i)\b(you have (a |an )?(stress fracture|tendinitis|tendinopathy|plantar fasciitis|mtss|shin splints|arrhythmia|hypertension|diabetes|infection)|you are (cleared|fit|safe) to (run|race|train)|medically cleared|you('re| are) diagnosed|this is (definitely|certainly) (a |an )?[a-z ]+(itis|osis|fracture))\b`)

// DiagnosisWording: wording the model must not use (diagnosis / clearance); returns the offending phrase.
func DiagnosisWording(parsed map[string]any) []string {
	parts := []string{joinStr(parsed["summary"]), joinStr(parsed["analysis_md"])}
	if recs, ok := parsed["recommendations"].([]any); ok {
		for _, rv := range recs {
			r := obj(rv)
			parts = append(parts, tpl(r, "action")+" "+tpl(r, "why"))
		}
	}
	if m := diagnosisRe.FindString(strings.Join(parts, "\n")); m != "" {
		return []string{m}
	}
	return []string{}
}

// joinStr: an element of Array.prototype.join — undefined and null become the empty string
func joinStr(v any) string {
	if v == nil {
		return ""
	}
	return fmt.Sprint(v)
}

// tpl: a field inside a template literal — missing is "undefined", null is "null"
func tpl(m map[string]any, k string) string {
	v, ok := m[k]
	switch {
	case !ok:
		return "undefined"
	case v == nil:
		return "null"
	}
	return fmt.Sprint(v)
}
