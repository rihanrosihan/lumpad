package graph

import (
	"os"
	"testing"
)

func TestParseTablesAndFrontmatter(t *testing.T) {
	fm, tags, body := parseFrontmatter("---\ndoc-id: \"04.1\"\ntitle: Race Archive\nsupersedes: \"01.1, 03.2\"\n---\n> note\n---\ntype: ref\ntags:\n  - race-history\n  - ledger\n---\n\n# Race Archive\n")
	if fm["doc-id"] != "04.1" || fm["title"] != "Race Archive" || len(tags) != 2 || tags[1] != "ledger" || headingOf(body) != "Race Archive" {
		t.Fatalf("frontmatter: %v %v %q", fm, tags, body)
	}
	if ids := splitDocIDs(fm["supersedes"]); len(ids) != 2 || ids[0] != "01.1" {
		t.Errorf("ids %v", ids)
	}
	tb := parseTables("## 2025 Race Ledger\n\n| Date | Race | Result |\n|---|---|---|\n| 12 Jan | Soekarno Run | **1:21:05** |\n| **24 Aug** | Total Combat Run | DNF |\n")
	if len(tb) != 1 || tb[0].Heading != "2025 Race Ledger" || len(tb[0].Rows) != 2 || cell(tb[0].Rows[1], 0) != "24 Aug" {
		t.Fatalf("tables %+v", tb)
	}
	g := &KBGraph{seen: map[string]bool{}}
	g.parseLedger(&KBDoc{ID: "04.1"}, tb[0])
	if len(g.Races) != 2 || g.Races[0]["date"] != "2025-01-12" || g.Races[1]["dnf"] != true {
		t.Errorf("ledger %v", g.Races)
	}
}

func TestWeeksRollTheYearAndChain(t *testing.T) {
	tb := parseTables("| W | Tanggal | Fase | km | Longest | Quality / test | CP | Catatan |\n|---|---|---|---|---|---|---|---|\n| W0 | 28 Dec – 3 Jan | Off-season | 20.3 | 20.3 | – | – | x |\n| W1 | 4 Jan – 10 Jan | Off-season | 26 | 9 | – | – | |\n| W2 | 11 Jan – 17 Jan | Ramadan | 30 | 10 | 5K TT | CP1 | CP1 |\n")
	g := &KBGraph{seen: map[string]bool{}}
	g.parseWeeks(&KBDoc{ID: "06.4"}, tb[0], map[string]bool{})
	if len(g.Weeks) != 3 || g.Weeks[0]["start"] != "2026-12-28" || g.Weeks[0]["end"] != "2027-01-03" || g.Weeks[2]["start"] != "2027-01-11" {
		t.Fatalf("weeks %v", g.Weeks)
	}
	if g.Weeks[0]["phase_id"] != g.Weeks[1]["phase_id"] || g.Weeks[1]["phase_id"] == g.Weeks[2]["phase_id"] || g.Weeks[2]["prev"] != "w27:W1" || len(g.Checkpoints) != 1 {
		t.Errorf("phase/chain %v %v", g.Weeks, g.Checkpoints)
	}
}

func TestEntityMentions(t *testing.T) {
	m := mentionsIn("MTSS flare after hip thrust; creatine and whey; run-walk at Borobudur, sub-4 target, VDOT 37.9, HRV gate, TE ≥ 5.0")
	for _, k := range []string{"Condition:mtss", "Supplement:creatine", "Supplement:whey", "Concept:runwalk", "Event:borobudur", "Goal:sub4", "Metric:vdot", "Metric:hrv", "Metric:te"} {
		if m[k] == 0 {
			t.Errorf("missing %s in %v", k, m)
		}
	}
}

// Parses the real export when it is on this machine (the server has it; CI may not).
func TestParseRealExport(t *testing.T) {
	dir := KBDir()
	if _, err := os.Stat(dir); err != nil {
		t.Skip("no export at " + dir)
	}
	g, err := ParseKB(dir, map[int64]string{1: "MTSS and creatine and whey", 2: "MTSS creatine whey", 3: "MTSS creatine whey"})
	if err != nil {
		t.Fatal(err)
	}
	refs := 0
	for _, d := range g.Docs {
		refs += len(d.Refs)
	}
	t.Logf("docs=%d refs=%d races=%d weeks=%d phases=%d checkpoints=%d conflicts=%d items=%d exercises=%d(use %d) entities=%d comention=%d",
		len(g.Docs), refs, len(g.Races), len(g.Weeks), len(g.Phases), len(g.Checkpoints), len(g.Conflicts), len(g.Items), len(g.Exercises), len(g.ExerciseUse), len(g.Entities), len(g.CoMention))
	if len(g.Docs) < 30 || len(g.Races) < 15 || len(g.Weeks) < 40 || len(g.Conflicts) < 20 || len(g.Items) < 10 {
		t.Errorf("export parsed thinner than expected")
	}
	seen := map[string]bool{}
	for _, c := range g.Checkpoints {
		if seen[c["id"].(string)] {
			t.Errorf("duplicate checkpoint %v", c["id"])
		}
		seen[c["id"].(string)] = true
	}
}
