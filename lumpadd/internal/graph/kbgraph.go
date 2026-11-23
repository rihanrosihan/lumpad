package graph

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

// Knowledge-base layer of the graph. The exported Running project (36 Markdown docs: index, doctrine, race ledger, plans, strength blocks…) used to enter the graph only as
// ~480 anonymous Memory chunks. This file reads the documents themselves and adds their STRUCTURE: documents and sections, which doc supersedes/references which, the race
// ledger, the 2027 plan (weeks, phases, checkpoints), reconciled conflicts, open decisions, strength exercises, and a vocabulary of entities (conditions, supplements, events,
// metrics, shoes, goals, concepts) with who mentions them. Nothing here is guessed: every node comes from a table row, a frontmatter field or a dictionary match in the text.
// All nodes carry src:'kbx' and are rebuilt on every sync (delete + create), so nothing goes stale. No health data from the athlete's own records is involved: this is the
// owner-authored knowledge base only.

const kbSrc = "kbx"

// KBDir is where the exported project lives on the server (override with KB_DIR).
func KBDir() string {
	if d := os.Getenv("KB_DIR"); d != "" {
		return d
	}
	return "/opt/lumpad/server/data/kb/Running_project_export"
}

type KBDoc struct {
	ID, Title, Status, SourceDate, TopicOwner, Section, SectionName, Path string
	Supersedes, SupersededBy                                              []string
	Tags                                                                  []string
	Refs                                                                  map[string]int // referenced doc id -> mentions
	Topics                                                                []string
	Text                                                                  string
	Mentions                                                              map[string]int // entity id -> count
}

type kbRow = map[string]any

// KBGraph is the parsed knowledge layer, ready to be written.
type KBGraph struct {
	Docs                                                []*KBDoc
	Races, Weeks, Phases, Checkpoints, Conflicts, Items []kbRow
	Exercises, ExerciseUse                              []kbRow
	Entities                                            []kbRow
	CoMention                                           []kbRow
	docByID                                             map[string]*KBDoc
	seen                                                map[string]bool
	entMentionsByChunk                                  map[int64][]string
}

var (
	reFMKey   = regexp.MustCompile(`^([A-Za-z][\w-]*):\s*(.*)$`)
	reDocID   = regexp.MustCompile(`^(\d{2}\.\d{1,2})\b`)
	reRefTick = regexp.MustCompile("`(\\d{2}\\.\\d{1,2})`")
	reRefDoc  = regexp.MustCompile(`(?i)\bdoc\s+(\d{2}\.\d{1,2})\b`)
	reAnyRef  = regexp.MustCompile(`\b(\d{2}\.\d{1,2})\b`)
	reYear    = regexp.MustCompile(`\b(20\d\d)\b`)
	reCP      = regexp.MustCompile(`CP\s?(\d{1,2})\b`)
	reMd      = strings.NewReplacer("**", "", "`", "", "*", "")
)

func clean(s string) string { return strings.TrimSpace(reMd.Replace(s)) }

// splitDocIDs pulls "01.1, 03.2" style ids out of a frontmatter value or a table cell.
func splitDocIDs(s string) []string {
	var out []string
	seen := map[string]bool{}
	for _, m := range reAnyRef.FindAllString(s, -1) {
		if !seen[m] {
			seen[m] = true
			out = append(out, m)
		}
	}
	return out
}

type mdTable struct {
	Heading string // nearest preceding heading
	Header  []string
	Rows    [][]string
}

func cells(line string) []string {
	line = strings.TrimSpace(line)
	line = strings.TrimPrefix(line, "|")
	line = strings.TrimSuffix(line, "|")
	parts := strings.Split(line, "|")
	for i := range parts {
		parts[i] = strings.TrimSpace(parts[i])
	}
	return parts
}

func isSep(line string) bool {
	t := strings.TrimSpace(line)
	return strings.HasPrefix(t, "|") && strings.Trim(t, "|-: ") == ""
}

// parseTables finds the pipe tables of a Markdown body, each with its nearest heading.
func parseTables(body string) []mdTable {
	lines := strings.Split(body, "\n")
	var out []mdTable
	heading := ""
	for i := 0; i < len(lines); i++ {
		l := lines[i]
		if strings.HasPrefix(l, "#") {
			heading = strings.TrimSpace(strings.TrimLeft(l, "# "))
			continue
		}
		if strings.HasPrefix(strings.TrimSpace(l), "|") && i+1 < len(lines) && isSep(lines[i+1]) {
			t := mdTable{Heading: heading, Header: cells(l)}
			j := i + 2
			for ; j < len(lines) && strings.HasPrefix(strings.TrimSpace(lines[j]), "|"); j++ {
				r := cells(lines[j])
				if len(r) < len(t.Header) {
					r = append(r, make([]string, len(t.Header)-len(r))...)
				}
				t.Rows = append(t.Rows, r)
			}
			out = append(out, t)
			i = j - 1
		}
	}
	return out
}

func colIdx(h []string, names ...string) int {
	for i, c := range h {
		lc := strings.ToLower(clean(c))
		for _, n := range names {
			if strings.HasPrefix(lc, n) {
				return i
			}
		}
	}
	return -1
}

func cell(r []string, i int) string {
	if i < 0 || i >= len(r) {
		return ""
	}
	return clean(r[i])
}

// parseFrontmatter reads key: value pairs and a "tags:" list from the head of a document (some docs carry two frontmatter blocks).
func parseFrontmatter(text string) (fm map[string]string, tags []string, body string) {
	fm = map[string]string{}
	lines := strings.Split(text, "\n")
	end, inTags := 0, false
	limit := len(lines)
	if limit > 60 {
		limit = 60
	}
	for i := 0; i < limit; i++ {
		t := strings.TrimRight(lines[i], " \r")
		if t == "---" {
			inTags = false
			end = i + 1
			continue
		}
		if strings.HasPrefix(t, "#") {
			break
		}
		if inTags && strings.HasPrefix(strings.TrimSpace(t), "- ") {
			tags = append(tags, strings.Trim(strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(t), "- ")), `"'`))
			end = i + 1
			continue
		}
		if m := reFMKey.FindStringSubmatch(t); m != nil && !strings.HasPrefix(t, ">") {
			inTags = m[1] == "tags" && strings.TrimSpace(m[2]) == ""
			if _, dup := fm[m[1]]; !dup {
				fm[m[1]] = strings.Trim(strings.TrimSpace(m[2]), `"'`)
			}
			end = i + 1
		}
	}
	return fm, tags, strings.Join(lines[end:], "\n")
}

func headingOf(body string) string {
	for _, l := range strings.Split(body, "\n") {
		if strings.HasPrefix(l, "# ") {
			return strings.TrimSpace(l[2:])
		}
	}
	return ""
}

var months = map[string]int{"jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "mei": 5, "jun": 6, "jul": 7, "aug": 8, "agu": 8, "sep": 9, "oct": 10, "okt": 10, "nov": 11, "dec": 12, "des": 12}
var reDayMonth = regexp.MustCompile(`(?i)(\d{1,2})\s+([A-Za-z]{3})[a-z]*`)

// dayMonth parses "12 Jan" / "24 Okt" into (day, month); ok=false when the text has no date.
func dayMonth(s string) (int, int, bool) {
	m := reDayMonth.FindStringSubmatch(s)
	if m == nil {
		return 0, 0, false
	}
	mo, ok := months[strings.ToLower(m[2])]
	d, _ := strconv.Atoi(m[1])
	return d, mo, ok && d >= 1 && d <= 31
}

func slug(s string) string {
	s = strings.ToLower(s)
	var b strings.Builder
	dash := false
	for _, r := range s {
		if r >= 'a' && r <= 'z' || r >= '0' && r <= '9' {
			b.WriteRune(r)
			dash = false
		} else if !dash && b.Len() > 0 {
			b.WriteByte('-')
			dash = true
		}
	}
	return strings.Trim(b.String(), "-")
}

type entDef struct {
	Kind, Key, Name string
	re              *regexp.Regexp
}

func ed(kind, key, name, pat string) entDef {
	return entDef{kind, key, name, regexp.MustCompile(`(?i)` + pat)}
}

// The vocabulary: matched with word boundaries against document text and knowledge-base chunks. Indonesian and English spellings are both covered because the docs mix them.
var entityDefs = []entDef{
	ed("Condition", "mtss", "MTSS / shin splints", `\b(mtss|shin ?splints?|tibia\w*)\b`),
	ed("Condition", "plantar", "Plantar fascia", `\bplantar\b`),
	ed("Condition", "achilles", "Achilles", `\bachilles\b`),
	ed("Condition", "thigh", "Hip / thigh pain (paha)", `\b(paha|hip flexor|quad strain|adduct\w*)\b`),
	ed("Condition", "eosinophilia", "Eosinophilia (MCU)", `\beosinofil\w*|\beosinophil\w*`),
	ed("Condition", "gi", "GI distress (nausea, diarrhoea)", `\b(nausea|mual|diarrh?ea|diare|gi distress|gi flush)\b`),
	ed("Condition", "heat-illness", "Heat strain & black flag", `\b(black flag|heat ?stroke|heat strain|dehydrat\w*)\b`),
	ed("Supplement", "creatine", "Creatine", `\bcreatine\b`),
	ed("Supplement", "whey", "Whey protein", `\bwhey\b`),
	ed("Supplement", "beetroot", "Beetroot / nitrate", `\b(beetroot|nitrate)\b`),
	ed("Supplement", "caffeine", "Caffeine", `\bcaffeine|kafein\b`),
	ed("Supplement", "d3", "Vitamin D3", `\b(d3|25\(oh\)d|vitamin d)\b`),
	ed("Supplement", "betafuel", "SiS Beta Fuel / gels", `\b(beta ?fuel|sis\b|gels?)\b`),
	ed("Supplement", "electrolyte", "Electrolytes & salt", `\b(electrolyte\w*|sodium|salt|garam)\b`),
	ed("Event", "borobudur", "Borobudur Marathon", `\b(borobudur|bormar)\b`),
	ed("Event", "jakim", "Jakarta International Marathon (Jakim)", `\bjakim\b`),
	ed("Event", "jrf", "Jakarta Running Festival (JRF)", `\b(jrf|jakarta running festival)\b`),
	ed("Event", "mjm", "Mandiri Jogja Marathon (MJM)", `\b(mjm|jogja marathon)\b`),
	ed("Event", "urbana", "Urbana qualifier", `\burbana\b`),
	ed("Event", "milo", "MILO races", `\bmilo\b`),
	ed("Event", "monas", "LPS Monas HM", `\bmonas\b`),
	ed("Event", "sentul", "Sentul Ultra 17K", `\bsentul\b`),
	ed("Metric", "vdot", "VDOT", `\bvdot\b`),
	ed("Metric", "hrv", "HRV", `\bhrv\b`),
	ed("Metric", "te", "Training Effect (TE)", `\btraining effect\b|\bTE ?[≥>]=? ?\d`),
	ed("Metric", "threshold", "Threshold pace", `\b(threshold|ambang)\b`),
	ed("Metric", "mp", "Marathon pace (MP)", `\b(marathon pace|mp block|\bMP\b)`),
	ed("Metric", "sleephr", "Sleep heart rate", `\bsleep hr\b`),
	ed("Metric", "cadence", "Cadence & GCT", `\b(cadence|gct|ground contact)\b`),
	ed("Metric", "rpe", "RPE", `\brpe\b`),
	ed("Metric", "hrpace", "HR at pace", `\bhr ?@ ?pace|hr at pace\b`),
	ed("Shoe", "mach", "Hoka Mach X2", `\bmach ?x2?\b`),
	ed("Shoe", "clifton", "Hoka Clifton", `\bclifton\b`),
	ed("Shoe", "adizero", "Adidas Adizero", `\badizero\b`),
	ed("Shoe", "speed4", "Saucony/Puma Speed 4", `\bspeed 4\b`),
	ed("Goal", "sub4", "Sub-4:00 marathon (JRF 2027)", `\bsub-?4(:00)?\b`),
	ed("Goal", "sub330", "Sub-3:30 marathon (Oct 2028)", `\bsub-?3[-:]?30\b`),
	ed("Goal", "finishfirst", "Finish-first (4:50 budget)", `\b(finish-first|4:50:00)\b`),
	ed("Goal", "bormar-plan", "Borobudur 6:00–6:20 plan", `\b6[:\-]00\s?[–-]\s?6[:\-]20\b`),
	ed("Concept", "runwalk", "Run-walk", `\brun-?walk\b`),
	ed("Concept", "durability", "Durability event", `\bdurability\b`),
	ed("Concept", "ladder", "Goal-pace ladder", `\b(goal-pace ladder|pace ladder)\b`),
	ed("Concept", "gutramp", "Gut training ramp", `\b(gut ramp|gut training|g/jam|g/hr|g/h|cho 30)\b`),
	ed("Concept", "heatblock", "Heat acclimation block", `\b(heat block|blok heat|acclimat\w*|flag protocol)\b`),
	ed("Concept", "taper", "Taper", `\btaper\b`),
	ed("Concept", "cutback", "Cutback week", `\bcut-?back\b`),
	ed("Concept", "tt", "Time trial (TT)", `\b(time trial|tt)\b`),
	ed("Concept", "cutoff", "Race cut-offs & sweep", `\b(cut-?off|sweep|cop1)\b`),
	ed("Concept", "hrvgate", "HRV gating rules", `\bhrv gat\w*|\bgate\b`),
	ed("Concept", "ramadan", "Ramadan training", `\bramadan\b`),
	ed("Concept", "runna", "Runna plan", `\brunna\b`),
}

func mentionsIn(text string) map[string]int {
	out := map[string]int{}
	for _, e := range entityDefs {
		if n := len(e.re.FindAllStringIndex(text, -1)); n > 0 {
			out[e.Kind+":"+e.Key] = n
		}
	}
	return out
}

// ParseKB reads every document under dir and extracts the knowledge layer. chunks maps Memory id -> text for the knowledge-base chunks (entity mentions per chunk).
func ParseKB(dir string, chunks map[int64]string) (*KBGraph, error) {
	g := &KBGraph{seen: map[string]bool{}, docByID: map[string]*KBDoc{}, entMentionsByChunk: map[int64][]string{}}
	var files []string
	err := filepath.WalkDir(dir, func(p string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if !d.IsDir() && strings.HasSuffix(p, ".md") && !strings.HasSuffix(p, "MANIFEST.md") {
			files = append(files, p)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	sort.Strings(files)
	type parsed struct {
		doc    *KBDoc
		body   string
		tables []mdTable
	}
	var all []parsed
	for _, f := range files {
		raw, err := os.ReadFile(f)
		if err != nil {
			continue
		}
		fm, tags, body := parseFrontmatter(string(raw))
		rel, _ := filepath.Rel(dir, f)
		base := filepath.Base(f)
		id := fm["doc-id"]
		if m := reDocID.FindStringSubmatch(base); id == "" && m != nil {
			id = m[1]
		}
		if id == "" {
			continue
		}
		d := &KBDoc{ID: id, Title: firstNonEmpty(fm["title"], headingOf(body), strings.TrimSuffix(base, ".md")), Status: fm["status"], SourceDate: fm["source-date"], TopicOwner: fm["topic-owner"],
			Path: rel, Tags: tags, Refs: map[string]int{}, Text: body}
		if sec := strings.SplitN(filepath.Dir(rel), string(os.PathSeparator), 2)[0]; strings.Contains(sec, "_") && sec[0] >= '0' && sec[0] <= '9' {
			d.Section, d.SectionName = sec[:2], strings.TrimSpace(strings.SplitN(sec, "_", 2)[1])
		}
		d.Supersedes, d.SupersededBy = splitDocIDs(fm["supersedes"]), splitDocIDs(fm["superseded-by"])
		g.Docs = append(g.Docs, d)
		g.docByID[id] = d
		all = append(all, parsed{d, body, parseTables(body)})
	}
	for _, p := range all {
		d := p.doc
		for _, re := range []*regexp.Regexp{reRefTick, reRefDoc} {
			for _, m := range re.FindAllStringSubmatch(p.body, -1) {
				if m[1] != d.ID && g.docByID[m[1]] != nil {
					d.Refs[m[1]]++
				}
			}
		}
		d.Topics = topicsOf(d.Title + " " + p.body)
		d.Mentions = mentionsIn(p.body)
	}

	// entities
	seenEnt := map[string]bool{}
	for _, d := range g.Docs {
		for k := range d.Mentions {
			seenEnt[k] = true
		}
	}
	chunkEnts := map[int64][]string{}
	pair := map[[2]string]int{}
	ids := make([]int64, 0, len(chunks))
	for id := range chunks {
		ids = append(ids, id)
	}
	sort.Slice(ids, func(i, j int) bool { return ids[i] < ids[j] })
	for _, id := range ids {
		var es []string
		for k := range mentionsIn(chunks[id]) {
			es = append(es, k)
			seenEnt[k] = true
		}
		sort.Strings(es)
		chunkEnts[id] = es
		for i := range es {
			for j := i + 1; j < len(es); j++ {
				pair[[2]string{es[i], es[j]}]++
			}
		}
	}
	g.entMentionsByChunk = chunkEnts
	for _, e := range entityDefs {
		if k := e.Kind + ":" + e.Key; seenEnt[k] {
			g.Entities = append(g.Entities, kbRow{"id": k, "kind": e.Kind, "name": e.Name})
		}
	}
	type pc struct {
		a, b string
		n    int
	}
	var pcs []pc
	for k, n := range pair {
		if n >= 3 {
			pcs = append(pcs, pc{k[0], k[1], n})
		}
	}
	sort.Slice(pcs, func(i, j int) bool {
		if pcs[i].n != pcs[j].n {
			return pcs[i].n > pcs[j].n
		}
		return pcs[i].a+pcs[i].b < pcs[j].a+pcs[j].b
	})
	if len(pcs) > 250 {
		pcs = pcs[:250]
	}
	for _, p := range pcs {
		g.CoMention = append(g.CoMention, kbRow{"a": p.a, "b": p.b, "n": p.n})
	}

	// tables → structured nodes
	exSeen := map[string]bool{}
	cpSeen := map[string]bool{}
	for _, p := range all {
		d := p.doc
		for _, t := range p.tables {
			h0 := strings.ToLower(clean(strings.Join(t.Header, " ")))
			switch {
			case d.ID == "04.1" && colIdx(t.Header, "date") == 0 && colIdx(t.Header, "race") >= 0:
				g.parseLedger(d, t)
			case d.ID == "06.4" && colIdx(t.Header, "w") == 0 && colIdx(t.Header, "tanggal") == 1 && colIdx(t.Header, "fase") == 2:
				g.parseWeeks(d, t, cpSeen)
			case d.ID == "06.4" && colIdx(t.Header, "fase") == 0 && colIdx(t.Header, "minggu") == 1:
				g.parsePhaseGoals(d, t)
			case colIdx(t.Header, "cp") == 0 && colIdx(t.Header, "tanggal") == 1 && (colIdx(t.Header, "tes") == 2 || colIdx(t.Header, "jenis") == 2):
				g.parseCheckpoints(d, t, cpSeen)
			case colIdx(t.Header, "#") == 0 && (colIdx(t.Header, "topik") == 1 || colIdx(t.Header, "konflik") == 1):
				g.parseConflicts(d, t)
			case d.ID == "00.4" && colIdx(t.Header, "#") == 0 && colIdx(t.Header, "item") == 1:
				g.parseItems(d, t)
			case strings.Contains(h0, "exercise"):
				g.parseExercises(d, t, exSeen)
			}
		}
	}
	return g, nil
}

func firstNonEmpty(ss ...string) string {
	for _, s := range ss {
		if strings.TrimSpace(s) != "" {
			return strings.TrimSpace(s)
		}
	}
	return ""
}

func (g *KBGraph) parseLedger(d *KBDoc, t mdTable) {
	year := ""
	if m := reYear.FindString(t.Heading); m != "" {
		year = m
	}
	ci, ri, di, rs, ni := colIdx(t.Header, "date"), colIdx(t.Header, "race"), colIdx(t.Header, "distance"), colIdx(t.Header, "result"), colIdx(t.Header, "notes")
	if year == "" {
		return
	}
	for _, r := range t.Rows {
		day, mo, ok := dayMonth(cell(r, ci))
		if !ok {
			continue
		}
		name := cell(r, ri)
		tier := ""
		if m := regexp.MustCompile(`(?i)tier ([A-C])`).FindStringSubmatch(name); m != nil {
			tier = strings.ToUpper(m[1])
		}
		if i := strings.Index(name, " — "); i > 0 {
			name = strings.TrimSpace(name[:i])
		}
		y, _ := strconv.Atoi(year)
		date := fmt.Sprintf("%04d-%02d-%02d", y, mo, day)
		res := cell(r, rs)
		if g.seen["r"+date+slug(name)] {
			continue
		}
		g.seen["r"+date+slug(name)] = true
		g.Races = append(g.Races, kbRow{"id": date + "-" + slug(name), "date": date, "name": name, "distance": cell(r, di), "result": res, "tier": tier,
			"dnf": strings.Contains(strings.ToUpper(res), "DNF"), "dns": strings.Contains(strings.ToUpper(res), "DNS"), "note": truncRunes(cell(r, ni), 300), "doc": d.ID})
	}
}

func truncRunes(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[:n])
}

// parseWeeks builds the 2027 season: one node per planned week, chained, grouped into phases (consecutive weeks with the same phase label).
func (g *KBGraph) parseWeeks(d *KBDoc, t mdTable, cpSeen map[string]bool) {
	year := 2026 // W0 starts 28 Dec 2026
	prevMonth := 0
	var lastPhase string
	phaseN := 0
	var prev string
	for _, r := range t.Rows {
		w := cell(r, 0)
		if !regexp.MustCompile(`^W\d+$`).MatchString(w) {
			continue
		}
		parts := strings.Split(cell(r, 1), "–")
		var start, end string
		for i, p := range parts {
			day, mo, ok := dayMonth(p)
			if !ok {
				continue
			}
			if prevMonth != 0 && mo < prevMonth {
				year++
			}
			prevMonth = mo
			iso := fmt.Sprintf("%04d-%02d-%02d", year, mo, day)
			if i == 0 {
				start = iso
			} else {
				end = iso
			}
		}
		if start == "" {
			continue
		}
		if end == "" {
			end = start
		}
		ph := cell(r, 2)
		if ph != lastPhase {
			phaseN++
			lastPhase = ph
		}
		km, _ := strconv.ParseFloat(strings.ReplaceAll(cell(r, 3), ",", "."), 64)
		row := kbRow{"id": "w27:" + w, "week": w, "start": start, "end": end, "phase": ph, "phase_id": fmt.Sprintf("ph27:%02d", phaseN), "km": km, "longest": cell(r, 4), "quality": cell(r, 5), "note": truncRunes(cell(r, 7), 200), "prev": prev, "doc": d.ID}
		cp := ""
		if m := reCP.FindStringSubmatch(cell(r, 6)); m != nil {
			cp = "CP" + m[1]
			row["cp"] = cp
			if !cpSeen[cp] {
				cpSeen[cp] = true
				g.Checkpoints = append(g.Checkpoints, kbRow{"id": cp, "num": cp, "date": start, "doc": d.ID, "week": w})
			}
		}
		prev = "w27:" + w
		g.Weeks = append(g.Weeks, row)
	}
}

func (g *KBGraph) parsePhaseGoals(d *KBDoc, t mdTable) {
	for _, r := range t.Rows {
		wk := regexp.MustCompile(`W(\d+)`).FindStringSubmatch(cell(r, 1))
		if wk == nil {
			continue
		}
		g.Phases = append(g.Phases, kbRow{"first_week": "W" + wk[1], "name": cell(r, 0), "weeks": cell(r, 1), "dates": cell(r, 2), "goal": truncRunes(cell(r, 3), 300), "doc": d.ID})
	}
}

func (g *KBGraph) parseCheckpoints(d *KBDoc, t mdTable, cpSeen map[string]bool) {
	ti, li, gi, ri := colIdx(t.Header, "tes", "jenis"), colIdx(t.Header, "line"), colIdx(t.Header, "hijau", "lolos"), colIdx(t.Header, "merah", "gagal")
	for _, r := range t.Rows {
		n := regexp.MustCompile(`^\d{1,2}$`).FindString(cell(r, 0))
		if n == "" {
			continue
		}
		id := "CP" + n
		vals := map[string]string{"date_text": cell(r, 1), "test": cell(r, ti), "line": cell(r, li), "green": cell(r, gi), "red": cell(r, ri)}
		var row kbRow
		for _, c := range g.Checkpoints {
			if c["id"] == id {
				row = c
			}
		}
		if row == nil {
			row = kbRow{"id": id, "num": id, "doc": d.ID}
			g.Checkpoints = append(g.Checkpoints, row)
		}
		for k, v := range vals {
			if cur, _ := row[k].(string); cur == "" && v != "" {
				row[k] = v
			}
		}
		cpSeen[id] = true
	}
}

func (g *KBGraph) parseConflicts(d *KBDoc, t mdTable) {
	var win, old, why, aff int = colIdx(t.Header, "versi menang", "yang menang", "status"), colIdx(t.Header, "versi lama"), colIdx(t.Header, "alasan"), colIdx(t.Header, "doc yang")
	for _, r := range t.Rows {
		num := cell(r, 0)
		if num == "" || strings.Trim(num, "0123456789ab") != "" {
			continue
		}
		topic := cell(r, 1)
		if topic == "" {
			continue
		}
		var affects []string
		if aff >= 0 {
			for _, x := range splitDocIDs(cell(r, aff)) {
				if x != d.ID && g.docByID[x] != nil {
					affects = append(affects, x)
				}
			}
		}
		if g.seen["c"+d.ID+num] {
			continue
		}
		g.seen["c"+d.ID+num] = true
		g.Conflicts = append(g.Conflicts, kbRow{"id": d.ID + "#c" + num, "num": num, "topic": truncRunes(topic, 200), "old": truncRunes(cell(r, old), 250), "winner": truncRunes(cell(r, win), 300), "reason": truncRunes(cell(r, why), 250), "doc": d.ID, "affects": affects})
	}
}

func (g *KBGraph) parseItems(d *KBDoc, t mdTable) {
	bucket := "other"
	switch {
	case strings.Contains(t.Heading, "🔴"):
		bucket = "blocking"
	case strings.Contains(t.Heading, "🟡"):
		bucket = "important"
	case strings.Contains(t.Heading, "🟢"):
		bucket = "housekeeping"
	}
	si, ti := colIdx(t.Header, "sumber"), colIdx(t.Header, "status", "kenapa")
	for _, r := range t.Rows {
		num := cell(r, 0)
		if num == "" || strings.Trim(num, "0123456789abcd") != "" {
			continue
		}
		var refs []string
		for _, x := range splitDocIDs(strings.Join(r, " ")) {
			if x != d.ID && g.docByID[x] != nil {
				refs = append(refs, x)
			}
		}
		_ = si
		if g.seen["o"+num] {
			continue
		}
		g.seen["o"+num] = true
		g.Items = append(g.Items, kbRow{"id": "oi:" + num, "num": num, "item": truncRunes(cell(r, 1), 240), "detail": truncRunes(cell(r, ti), 300), "bucket": bucket, "doc": d.ID, "refs": refs})
	}
}

func (g *KBGraph) parseExercises(d *KBDoc, t mdTable, seen map[string]bool) {
	ei, si, ni := colIdx(t.Header, "exercise"), colIdx(t.Header, "sets"), colIdx(t.Header, "catatan", "tujuan", "tier", "notes")
	if ei < 0 {
		return
	}
	for _, r := range t.Rows {
		name := cell(r, ei)
		if len(name) < 3 || len(name) > 60 || strings.ContainsAny(name, "→") {
			continue
		}
		id := slug(name)
		if id == "" {
			continue
		}
		if !seen[id] {
			seen[id] = true
			g.Exercises = append(g.Exercises, kbRow{"id": "ex:" + id, "name": name})
		}
		g.ExerciseUse = append(g.ExerciseUse, kbRow{"ex": "ex:" + id, "doc": d.ID, "sets": cell(r, si), "note": truncRunes(cell(r, ni), 160)})
	}
}

// SyncKB rebuilds the knowledge layer in AuraDB. memRows are the projected Memory rows (the kb ones are tied to their document and entities).
func SyncKB(ctx context.Context, aura *Client, redact func(string) string, memRows []map[string]any, st *SyncStats) error {
	dir := KBDir()
	if _, err := os.Stat(dir); err != nil {
		return nil // no export on this machine: nothing to add
	}
	chunks := map[int64]string{}
	chunkDoc := map[int64]string{}
	for _, m := range memRows {
		if s, _ := m["source"].(string); s != "kb" {
			continue
		}
		id, _ := m["id"].(int64)
		ref, _ := m["source_ref"].(string)
		title, _ := m["title"].(string)
		body, _ := m["body"].(string)
		chunks[id] = title + " " + body
		if i := strings.Index(ref, "#"); i > 0 {
			chunkDoc[id] = ref[:i]
		}
	}
	g, err := ParseKB(dir, chunks)
	if err != nil {
		return fmt.Errorf("kb parse: %w", err)
	}
	for _, c := range []string{"Document", "Section", "Tag", "Week", "Phase", "Checkpoint", "RaceEntry", "Conflict", "OpenItem", "Exercise", "Entity"} {
		key := "id"
		switch c {
		case "Tag":
			key = "name"
		case "Section":
			key = "id"
		}
		if _, err := aura.Query(ctx, fmt.Sprintf("CREATE CONSTRAINT kbx_%s IF NOT EXISTS FOR (n:%s) REQUIRE n.%s IS UNIQUE", strings.ToLower(c), c, key), nil); err != nil {
			return fmt.Errorf("kb constraint: %w", err)
		}
	}
	if _, err := aura.Query(ctx, `MATCH (n {src: 'kbx'}) DETACH DELETE n`, nil); err != nil {
		return fmt.Errorf("kb reset: %w", err)
	}
	nodes, edges := 0, 0
	run := func(rows []map[string]any, size int, cypher string, isNode bool) error {
		if len(rows) == 0 {
			return nil
		}
		if err := runBatches(ctx, aura, rows, size, cypher); err != nil {
			return err
		}
		if isNode {
			nodes += len(rows)
		} else {
			edges += len(rows)
		}
		return nil
	}

	// documents, sections, tags
	var docRows, secRows, tagRows, supRows, refRows, topRows, docTag []map[string]any
	secSeen, tagSeen := map[string]bool{}, map[string]bool{}
	for _, d := range g.Docs {
		docRows = append(docRows, map[string]any{"id": d.ID, "title": redact(d.Title), "status": truncRunes(d.Status, 200), "source_date": d.SourceDate, "owner": truncRunes(d.TopicOwner, 200), "section": d.Section, "path": d.Path,
			"chars": len([]rune(d.Text)), "archived": statusArchived(d.Status)})
		if d.Section != "" && !secSeen[d.Section] {
			secSeen[d.Section] = true
			secRows = append(secRows, map[string]any{"id": d.Section, "name": d.SectionName})
		}
		for _, t := range d.Tags {
			docTag = append(docTag, map[string]any{"doc": d.ID, "tag": t})
			if !tagSeen[t] {
				tagSeen[t] = true
				tagRows = append(tagRows, map[string]any{"name": t})
			}
		}
		for _, s := range d.Supersedes {
			if g.docByID[s] != nil && s != d.ID {
				supRows = append(supRows, map[string]any{"new": d.ID, "old": s})
			}
		}
		for _, s := range d.SupersededBy {
			if g.docByID[s] != nil && s != d.ID {
				supRows = append(supRows, map[string]any{"new": s, "old": d.ID})
			}
		}
		for ref, n := range d.Refs {
			refRows = append(refRows, map[string]any{"from": d.ID, "to": ref, "n": n})
		}
		for _, t := range d.Topics {
			topRows = append(topRows, map[string]any{"doc": d.ID, "topic": t})
		}
	}
	if err := run(docRows, 50, `UNWIND $rows AS r CREATE (d:Document {id: r.id, src: 'kbx'}) SET d.title = r.title, d.status = r.status, d.source_date = r.source_date, d.owner = r.owner, d.path = r.path, d.chars = r.chars, d.archived = r.archived`, true); err != nil {
		return fmt.Errorf("kb docs: %w", err)
	}
	if err := run(secRows, 20, `UNWIND $rows AS r CREATE (s:Section {id: r.id, src: 'kbx', name: r.name})`, true); err != nil {
		return fmt.Errorf("kb sections: %w", err)
	}
	if err := run(tagRows, 100, `UNWIND $rows AS r CREATE (t:Tag {name: r.name, src: 'kbx'})`, true); err != nil {
		return fmt.Errorf("kb tags: %w", err)
	}
	for _, q := range []struct {
		rows []map[string]any
		c    string
	}{
		{docRows, `UNWIND $rows AS r MATCH (d:Document {id: r.id}), (s:Section {id: (CASE WHEN r.section = '' THEN NULL ELSE r.section END)}) MERGE (d)-[:IN_SECTION]->(s)`},
		{docTag, `UNWIND $rows AS r MATCH (d:Document {id: r.doc}), (t:Tag {name: r.tag}) MERGE (d)-[:TAGGED]->(t)`},
		{supRows, `UNWIND $rows AS r MATCH (a:Document {id: r.new}), (b:Document {id: r.old}) MERGE (a)-[:SUPERSEDES]->(b)`},
		{refRows, `UNWIND $rows AS r MATCH (a:Document {id: r.from}), (b:Document {id: r.to}) MERGE (a)-[x:REFERENCES]->(b) SET x.mentions = r.n`},
		{topRows, `UNWIND $rows AS r MATCH (d:Document {id: r.doc}), (t:Topic {id: r.topic}) MERGE (d)-[:ABOUT]->(t)`},
	} {
		if err := run(q.rows, 200, q.c, false); err != nil {
			return fmt.Errorf("kb doc edges: %w", err)
		}
	}

	// every kb chunk belongs to its document
	var fromDoc []map[string]any
	for id, doc := range chunkDoc {
		if g.docByID[doc] != nil {
			fromDoc = append(fromDoc, map[string]any{"mem": id, "doc": doc})
		}
	}
	if err := run(fromDoc, 300, `UNWIND $rows AS r MATCH (m:Memory {id: r.mem}), (d:Document {id: r.doc}) MERGE (m)-[:FROM_DOC]->(d)`, false); err != nil {
		return fmt.Errorf("kb chunk docs: %w", err)
	}

	// entities and who mentions them
	if err := run(toRows(g.Entities), 100, `UNWIND $rows AS r CREATE (e:Entity {id: r.id, src: 'kbx'}) SET e.kind = r.kind, e.name = r.name`, true); err != nil {
		return fmt.Errorf("kb entities: %w", err)
	}
	var dm, cm []map[string]any
	for _, d := range g.Docs {
		for e, n := range d.Mentions {
			dm = append(dm, map[string]any{"doc": d.ID, "e": e, "n": n})
		}
	}
	for id, es := range g.entMentionsByChunk {
		for _, e := range es {
			cm = append(cm, map[string]any{"mem": id, "e": e})
		}
	}
	if err := run(dm, 300, `UNWIND $rows AS r MATCH (d:Document {id: r.doc}), (e:Entity {id: r.e}) MERGE (d)-[x:MENTIONS]->(e) SET x.n = r.n`, false); err != nil {
		return fmt.Errorf("kb doc mentions: %w", err)
	}
	if err := run(cm, 400, `UNWIND $rows AS r MATCH (m:Memory {id: r.mem}), (e:Entity {id: r.e}) MERGE (m)-[:MENTIONS]->(e)`, false); err != nil {
		return fmt.Errorf("kb chunk mentions: %w", err)
	}
	if err := run(toRows(g.CoMention), 200, `UNWIND $rows AS r MATCH (a:Entity {id: r.a}), (b:Entity {id: r.b}) MERGE (a)-[x:CO_OCCURS]->(b) SET x.chunks = r.n`, false); err != nil {
		return fmt.Errorf("kb co-occurs: %w", err)
	}

	// race ledger → canonical races by date
	if err := run(g.Races, 60, `UNWIND $rows AS r CREATE (e:RaceEntry {id: r.id, src: 'kbx'}) SET e.date = r.date, e.name = r.name, e.distance = r.distance, e.result = r.result, e.tier = r.tier, e.dnf = r.dnf, e.dns = r.dns, e.note = r.note
		WITH e, r MATCH (d:Document {id: r.doc}) MERGE (e)-[:RECORDED_IN]->(d)`, true); err != nil {
		return fmt.Errorf("kb races: %w", err)
	}
	for _, q := range []string{
		`MATCH (e:RaceEntry), (r:Race) WHERE r.date = e.date MERGE (e)-[:LEDGER_OF]->(r)`,
		`MATCH (e:RaceEntry), (s:Session) WHERE s.date = e.date MERGE (e)-[:DONE_AS]->(s)`,
		`MATCH (e:RaceEntry {src:'kbx'}), (t:Topic {id:'race'}) MERGE (e)-[:ABOUT]->(t)`,
		`MATCH (e:RaceEntry {dnf: true}), (en:Entity {id:'Condition:heat-illness'}) WHERE toLower(e.note) CONTAINS 'heat' OR toLower(e.note) CONTAINS 'black flag' MERGE (e)-[:FACED]->(en)`,
		`MATCH (a:RaceEntry), (b:RaceEntry) WHERE a.date < b.date AND NOT EXISTS { MATCH (c:RaceEntry) WHERE c.date > a.date AND c.date < b.date } MERGE (a)-[:NEXT_RACE]->(b)`,
		`MATCH (e:RaceEntry), (en:Entity {kind:'Event'}) WHERE (en.id = 'Event:jrf' AND (toLower(e.name) CONTAINS 'jrf' OR toLower(e.name) CONTAINS 'wondr')) OR (en.id = 'Event:jakim' AND toLower(e.name) CONTAINS 'jakim') OR (en.id = 'Event:borobudur' AND toLower(e.name) CONTAINS 'borobudur') OR (en.id = 'Event:milo' AND toLower(e.name) CONTAINS 'milo') OR (en.id = 'Event:monas' AND toLower(e.name) CONTAINS 'monas') OR (en.id = 'Event:sentul' AND toLower(e.name) CONTAINS 'sentul') MERGE (e)-[:OF_EVENT]->(en)`,
	} {
		if _, err := aura.Query(ctx, q, nil); err != nil {
			return fmt.Errorf("kb race links: %w", err)
		}
	}
	edges += len(g.Races)

	// the 2027 season
	var weekRows, phaseRows []map[string]any
	seenPh := map[string]bool{}
	for _, w := range g.Weeks {
		weekRows = append(weekRows, w)
		pid, _ := w["phase_id"].(string)
		if !seenPh[pid] {
			seenPh[pid] = true
			row := kbRow{"id": pid, "name": w["phase"], "first_week": w["week"], "start": w["start"], "goal": "", "weeks": ""}
			for _, p := range g.Phases {
				if p["first_week"] == w["week"] {
					row["goal"], row["weeks"] = p["goal"], p["weeks"]
				}
			}
			phaseRows = append(phaseRows, row)
		}
	}
	if err := run(phaseRows, 50, `UNWIND $rows AS r CREATE (p:Phase {id: r.id, src: 'kbx'}) SET p.name = r.name, p.first_week = r.first_week, p.start = r.start, p.goal = r.goal, p.weeks = r.weeks`, true); err != nil {
		return fmt.Errorf("kb phases: %w", err)
	}
	if err := run(weekRows, 60, `UNWIND $rows AS r CREATE (w:Week {id: r.id, src: 'kbx'}) SET w.week = r.week, w.start = r.start, w.end = r.end, w.km = r.km, w.longest = r.longest, w.quality = r.quality, w.note = r.note
		WITH w, r MATCH (p:Phase {id: r.phase_id}) MERGE (w)-[:IN_PHASE]->(p)`, true); err != nil {
		return fmt.Errorf("kb weeks: %w", err)
	}
	var nextW []map[string]any
	for _, w := range g.Weeks {
		if p, _ := w["prev"].(string); p != "" {
			nextW = append(nextW, map[string]any{"a": p, "b": w["id"]})
		}
	}
	if err := run(nextW, 100, `UNWIND $rows AS r MATCH (a:Week {id: r.a}), (b:Week {id: r.b}) MERGE (a)-[:NEXT_WEEK]->(b)`, false); err != nil {
		return fmt.Errorf("kb week chain: %w", err)
	}
	if err := run(g.Checkpoints, 50, `UNWIND $rows AS r CREATE (c:Checkpoint {id: r.id, src: 'kbx'}) SET c.num = r.num, c.date = r.date, c.week = r.week, c.date_text = r.date_text, c.test = r.test, c.line = r.line, c.green = r.green, c.red = r.red
		WITH c, r MATCH (d:Document {id: r.doc}) MERGE (c)-[:DEFINED_IN]->(d)`, true); err != nil {
		return fmt.Errorf("kb checkpoints: %w", err)
	}
	for _, q := range []string{
		`MATCH (c:Checkpoint {src:'kbx'}) WHERE c.week IS NOT NULL MATCH (w:Week {week: c.week}) MERGE (w)-[:HAS_CHECKPOINT]->(c)`,
		`MATCH (w:Week {src:'kbx'}), (d:Day) WHERE d.date >= w.start AND d.date <= w.end MERGE (w)-[:SPANS]->(d)`,
		`MATCH (w:Week {src:'kbx'}), (t:Topic {id:'load'}) MERGE (w)-[:ABOUT]->(t)`,
		`MATCH (c:Checkpoint {src:'kbx'}) MATCH (m:Entity {id:'Metric:vdot'}) MERGE (c)-[:MEASURES]->(m)`,
		`MATCH (p:Phase {src:'kbx'}), (d:Document {id:'06.4'}) MERGE (p)-[:DEFINED_IN]->(d)`,
		`MATCH (w:Week {src:'kbx'}), (d:Document {id:'06.4'}) MERGE (w)-[:DEFINED_IN]->(d)`,
		`MATCH (c:Checkpoint {src:'kbx'}) WHERE c.test CONTAINS 'TT' OR toLower(c.test) CONTAINS 'time trial' MATCH (e:Entity {id:'Concept:tt'}) MERGE (c)-[:USES]->(e)`,
		`MATCH (g:Entity {id:'Goal:sub4'}), (w:Week {id:'w27:W42'}) MERGE (w)-[:TARGETS]->(g)`,
	} {
		if _, err := aura.Query(ctx, q, nil); err != nil {
			return fmt.Errorf("kb season links: %w", err)
		}
	}
	edges += len(g.Weeks) + len(g.Checkpoints)

	// reconciled conflicts, open decisions
	if err := run(g.Conflicts, 60, `UNWIND $rows AS r CREATE (c:Conflict {id: r.id, src: 'kbx'}) SET c.num = r.num, c.topic = r.topic, c.old = r.old, c.winner = r.winner, c.reason = r.reason
		WITH c, r MATCH (d:Document {id: r.doc}) MERGE (c)-[:RAISED_IN]->(d)
		WITH c, r UNWIND r.affects AS a MATCH (x:Document {id: a}) MERGE (c)-[:AFFECTS]->(x)`, true); err != nil {
		return fmt.Errorf("kb conflicts: %w", err)
	}
	if err := run(g.Items, 60, `UNWIND $rows AS r CREATE (o:OpenItem {id: r.id, src: 'kbx'}) SET o.num = r.num, o.item = r.item, o.detail = r.detail, o.bucket = r.bucket
		WITH o, r MATCH (d:Document {id: r.doc}) MERGE (o)-[:RAISED_IN]->(d)
		WITH o, r UNWIND r.refs AS a MATCH (x:Document {id: a}) MERGE (o)-[:CONCERNS]->(x)`, true); err != nil {
		return fmt.Errorf("kb open items: %w", err)
	}
	for _, q := range []string{
		`MATCH (c:Conflict {src:'kbx'}), (e:Entity) WHERE e.kind IN ['Condition','Supplement','Event','Goal','Metric','Shoe'] AND (toLower(c.topic) CONTAINS toLower(split(e.name,' ')[0])) MERGE (c)-[:CONCERNS]->(e)`,
		`MATCH (o:OpenItem {src:'kbx'}), (e:Entity) WHERE e.kind IN ['Condition','Supplement','Event','Goal','Metric','Shoe'] AND (toLower(o.item) CONTAINS toLower(split(e.name,' ')[0])) MERGE (o)-[:CONCERNS]->(e)`,
	} {
		if _, err := aura.Query(ctx, q, nil); err != nil {
			return fmt.Errorf("kb concern links: %w", err)
		}
	}
	edges += len(g.Conflicts) + len(g.Items)

	// exercises
	if err := run(g.Exercises, 100, `UNWIND $rows AS r CREATE (x:Exercise {id: r.id, src: 'kbx'}) SET x.name = r.name`, true); err != nil {
		return fmt.Errorf("kb exercises: %w", err)
	}
	if err := run(g.ExerciseUse, 200, `UNWIND $rows AS r MATCH (x:Exercise {id: r.ex}), (d:Document {id: r.doc}) MERGE (x)-[u:PRESCRIBED_IN]->(d) SET u.sets = r.sets, u.note = r.note`, false); err != nil {
		return fmt.Errorf("kb exercise use: %w", err)
	}
	if _, err := aura.Query(ctx, `MATCH (x:Exercise {src:'kbx'}), (t:Topic {id:'strength'}) MERGE (x)-[:ABOUT]->(t)`, nil); err != nil {
		return fmt.Errorf("kb exercise topic: %w", err)
	}
	_, _ = nodes, edges
	if r, err := aura.Query(ctx, `MATCH (n {src:'kbx'}) RETURN count(n)`, nil); err == nil && len(r.Values) == 1 {
		if f, ok := r.Values[0][0].(float64); ok {
			st.KBNodes = int(f)
		}
	}
	if r, err := aura.Query(ctx, `MATCH (n {src:'kbx'})-[x]-() RETURN count(DISTINCT x)`, nil); err == nil && len(r.Values) == 1 {
		if f, ok := r.Values[0][0].(float64); ok {
			st.KBEdges = int(f)
		}
	}
	return nil
}

func toRows(in []kbRow) []map[string]any {
	out := make([]map[string]any, len(in))
	for i, r := range in {
		out[i] = r
	}
	return out
}

func statusArchived(s string) bool {
	u := strings.ToUpper(s)
	return (strings.HasPrefix(u, "SUPERSEDED") || strings.HasPrefix(u, "ARCHIVE") || strings.HasPrefix(u, "RETIRED")) && !strings.Contains(u, "ACTIVE")
}
