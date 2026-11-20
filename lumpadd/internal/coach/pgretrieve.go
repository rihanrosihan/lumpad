package coach

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Context builder on PostgreSQL: port of retrieveRunnerContext in server/intel/context.js. SQL filters, BM25 full-text search (an exact
// reproduction of SQLite FTS5 bm25, see bm25.go — PostgreSQL's ts_rank has no IDF or length normalisation and ranked quite differently: only 39 %
// of its text picks matched Node's), numeric-fingerprint neighbours and correlation edges → ONE structured payload.

type CtxItem struct {
	ID    int64   `json:"id"`
	Tier  string  `json:"tier"`
	Kind  string  `json:"kind"`
	Title string  `json:"title"`
	Body  string  `json:"body"`
	Tag   string  `json:"tag"`
	Why   string  `json:"why"`
	Date  *string `json:"date"`
}
type CtxEdge struct {
	Exposure   string      `json:"exposure"`
	Outcome    string      `json:"outcome"`
	Window     [2]int      `json:"window_days_before"`
	PartialRho *float64    `json:"partial_rho"`
	CI         [2]*float64 `json:"ci"`
	N          *int        `json:"n"`
	NEff       *float64    `json:"n_eff"`
	Q          *float64    `json:"q"`
	Status     string      `json:"status"`
	Caveat     string      `json:"caveat"`
}
type CtxTelemetry struct {
	LabelID string  `json:"label_id"`
	Date    string  `json:"date"`
	KmTotal float64 `json:"km_total"`
	Cols    string  `json:"cols"`
	Km      [][]any `json:"km"`
}

type PGRetriever struct {
	Pool        *pgxpool.Pool
	Now         func() time.Time
	TokenBudget int // 0 = 24000
	SinceDays   int // 0 = 400
}

const ctxSchema = "context/1"

func (r *PGRetriever) today() string {
	n := time.Now()
	if r.Now != nil {
		n = r.Now()
	}
	return n.Add(7 * time.Hour).UTC().Format("2006-01-02") // WIB
}

func dstr(t *time.Time) string {
	if t == nil {
		return ""
	}
	return t.Format("2006-01-02")
}

type memRow struct {
	ID                      int64
	Tier, Kind, Title, Body string
	Evidence                *string
	ValidFrom               *string
}

func (r *PGRetriever) epiByLabel(ctx context.Context, labels []string) ([]memRow, error) {
	var out []memRow
	for _, l := range labels {
		var m memRow
		err := r.Pool.QueryRow(ctx, `SELECT id, title, body, valid_from FROM memory.item WHERE source = 'fit' AND source_ref = $1 ORDER BY id LIMIT 1`, l).Scan(&m.ID, &m.Title, &m.Body, &m.ValidFrom)
		if errors.Is(err, pgx.ErrNoRows) {
			continue
		}
		if err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, nil
}

type fpRow struct {
	Label, Date string
	Dist        float64
	F           FeatureRow
}

func (r *PGRetriever) nearest(ctx context.Context, label string, k int) ([]string, error) {
	rows, err := r.Pool.Query(ctx, `SELECT label_id, date, COALESCE(distance_m, 0), COALESCE(features, '{}') FROM train.session_metric ORDER BY date, start_ms, label_id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var all []fpRow
	for rows.Next() {
		var x fpRow
		var d *time.Time
		var f string
		if err := rows.Scan(&x.Label, &d, &x.Dist, &f); err != nil {
			return nil, err
		}
		x.Date = dstr(d)
		var m map[string]*float64
		_ = json.Unmarshal([]byte(f), &m)
		x.F = FeatureRow(m)
		all = append(all, x)
	}
	frs := make([]FeatureRow, len(all))
	for i, a := range all {
		frs[i] = a.F
	}
	z := NewZMatrix(frs)
	var me *fpRow
	for i := range all {
		if all[i].Label == label {
			me = &all[i]
		}
	}
	if me == nil {
		return nil, nil
	}
	v := z.Z(me.F)
	type sim struct {
		label string
		s     float64
	}
	var c []sim
	for _, a := range all {
		if a.Label != label && a.Date < me.Date && a.Dist > 3000 {
			c = append(c, sim{a.Label, Cosine(v, z.Z(a.F))})
		}
	}
	sort.SliceStable(c, func(i, j int) bool { return c[i].s > c[j].s })
	var out []string
	for i := 0; i < len(c) && i < k; i++ {
		out = append(out, c[i].label)
	}
	return out, nil
}

func splits(label, date string, dist float64, kmJSON string) CtxTelemetry {
	var km []map[string]any
	_ = json.Unmarshal([]byte(kmJSON), &km)
	rows := make([][]any, len(km))
	for i, k := range km {
		rows[i] = []any{k["km"], k["pace"], k["hr"], k["cad"], k["gct"], k["runShare"]}
	}
	return CtxTelemetry{LabelID: label, Date: date, KmTotal: math.Floor(dist/100+0.5) / 10, Cols: "km, pace s/km (elapsed), HR, cadence spm, GCT ms, run share", Km: rows}
}

// bm25Index loads the whole memory (a few hundred rows) and indexes it: BM25 statistics are corpus-wide, exactly as in SQLite FTS5.
func (r *PGRetriever) bm25Index(ctx context.Context) (*BM25Index, error) {
	rows, err := r.Pool.Query(ctx, `SELECT id, tier, COALESCE(kind, ''), COALESCE(title, ''), COALESCE(body, ''), evidence_tag, status, valid_from, COALESCE(source, '') FROM memory.item ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var items []Memory
	for rows.Next() {
		var m Memory
		var tag, vf *string
		if err := rows.Scan(&m.ID, &m.Tier, &m.Kind, &m.Title, &m.Body, &tag, &m.Status, &vf, &m.Source); err != nil {
			return nil, err
		}
		if tag != nil {
			m.Evidence = *tag
		}
		if vf != nil {
			m.ValidFrom = *vf
		}
		items = append(items, m)
	}
	return NewBM25Index(items), rows.Err()
}

type ftsHit struct {
	memRow
	Rank float64
}

// fts: BM25 over active items of one tier (episodic ones only from `since` on), best first.
func fts(ix *BM25Index, text, tier string, limit int, since string) []ftsHit {
	var out []ftsHit
	for _, h := range ix.Search(text, BM25Filter{Tiers: []string{tier}, Statuses: []string{"active"}, Since: since, Limit: limit}) {
		m := memRow{ID: h.Mem.ID, Tier: h.Mem.Tier, Kind: h.Mem.Kind, Title: h.Mem.Title, Body: h.Mem.Body}
		if h.Mem.Evidence != "" {
			e := h.Mem.Evidence
			m.Evidence = &e
		}
		if h.Mem.ValidFrom != "" {
			v := h.Mem.ValidFrom
			m.ValidFrom = &v
		}
		out = append(out, ftsHit{m, h.Score})
	}
	return out
}

func (r *PGRetriever) Retrieve(ctx context.Context, in RunInput) (Retrieved, error) {
	date := in.Date
	if date == "" {
		date = r.today()
	}
	intent := in.Intent
	if intent == "" {
		intent = "daily_brief"
	}
	budget, since := r.TokenBudget, r.SinceDays
	if budget == 0 {
		budget = 24000
	}
	if since == 0 {
		since = 400
	}
	var twinVersion int64
	var twinState string
	if err := r.Pool.QueryRow(ctx, `SELECT version, state FROM athlete.state_snapshot ORDER BY version DESC LIMIT 1`).Scan(&twinVersion, &twinState); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Retrieved{}, errors.New("twin not built yet — run the intelligence job first")
		}
		return Retrieved{}, err
	}
	var items []CtxItem
	have := map[int64]bool{}
	add := func(m memRow, tier, kind, tag, why string) {
		if have[m.ID] {
			return
		}
		have[m.ID] = true
		it := CtxItem{ID: m.ID, Tier: tier, Kind: kind, Title: Redact(m.Title), Body: Redact(m.Body), Tag: tag, Why: why}
		if m.ValidFrom != nil && *m.ValidFrom != "" {
			it.Date = m.ValidFrom
		}
		items = append(items, it)
	}
	addMeasured := func(rows []memRow, why string) {
		for _, e := range rows {
			add(e, "episodic", "session", "MEASURED", why)
		}
	}

	// 1) pinned: locked + active procedural rules
	rrows, err := r.Pool.Query(ctx, `SELECT id, title, body, COALESCE(locked, 0) <> 0, COALESCE(evidence_tag, '') FROM memory.item WHERE tier = 'procedural' AND status = 'active' ORDER BY locked DESC, id`)
	if err != nil {
		return Retrieved{}, err
	}
	rules := []Rule{}
	for rrows.Next() {
		var ru Rule
		var body string
		if err := rrows.Scan(&ru.ID, &ru.Title, &body, &ru.Locked, &ru.Tag); err != nil {
			rrows.Close()
			return Retrieved{}, err
		}
		ru.Rule = Redact(body)
		rules = append(rules, ru)
	}
	rrows.Close()

	// 2) episodic: the focus session and its fingerprint neighbours, otherwise the most recent sessions for the intent
	focus := ""
	if in.ActivityID != "" {
		clean := strings.TrimPrefix(in.ActivityID, "coros:")
		_ = r.Pool.QueryRow(ctx, `SELECT label_id FROM train.session_metric WHERE activity_id = $1 OR label_id = $2 ORDER BY date, label_id LIMIT 1`, in.ActivityID, clean).Scan(&focus)
	}
	if focus != "" {
		near, err := r.nearest(ctx, focus, 3)
		if err != nil {
			return Retrieved{}, err
		}
		rows, err := r.epiByLabel(ctx, append([]string{focus}, near...))
		if err != nil {
			return Retrieved{}, err
		}
		addMeasured(rows, "focus/similar")
	} else {
		n := 5
		if intent == "weekly_review" {
			n = 10
		} else if intent == "race_plan" {
			n = 6
		}
		rows, err := r.Pool.Query(ctx, `SELECT id, title, body, valid_from FROM memory.item WHERE tier = 'episodic' AND status = 'active' AND valid_from IS NOT NULL ORDER BY valid_from DESC, id DESC LIMIT $1`, n)
		if err != nil {
			return Retrieved{}, err
		}
		var rec []memRow
		for rows.Next() {
			var m memRow
			if err := rows.Scan(&m.ID, &m.Title, &m.Body, &m.ValidFrom); err != nil {
				rows.Close()
				return Retrieved{}, err
			}
			rec = append(rec, m)
		}
		rows.Close()
		addMeasured(rec, "recent")
	}

	// 2b) query decomposition → SQL metric filters; matched sessions join the context with their exact km splits
	var gear []Gear
	if grows, err := r.Pool.Query(ctx, `SELECT id, COALESCE(name, '') FROM train.gear`); err == nil {
		for grows.Next() {
			var g Gear
			if grows.Scan(&g.ID, &g.Name) == nil {
				gear = append(gear, g)
			}
		}
		grows.Close()
	}
	dq := Decompose(in.Question, date, gear)
	telemetry := []CtxTelemetry{}
	if dq.HasFilters {
		where, params := dq.SQL()
		rows, err := r.Pool.Query(ctx, `SELECT s.label_id, s.date, COALESCE(s.distance_m, 0), COALESCE(s.km, '[]') FROM train.session_metric s LEFT JOIN train.run_weather w ON w.label_id = s.label_id `+where+` ORDER BY s.date DESC, s.start_ms DESC, s.label_id DESC LIMIT 6`, params...)
		if err != nil {
			return Retrieved{}, err
		}
		type hit struct {
			label, date, km string
			dist            float64
		}
		var hits []hit
		for rows.Next() {
			var h hit
			var d *time.Time
			if err := rows.Scan(&h.label, &d, &h.dist, &h.km); err != nil {
				rows.Close()
				return Retrieved{}, err
			}
			h.date = dstr(d)
			hits = append(hits, h)
		}
		rows.Close()
		labels := make([]string, len(hits))
		for i, h := range hits {
			labels[i] = h.label
		}
		epis, err := r.epiByLabel(ctx, labels)
		if err != nil {
			return Retrieved{}, err
		}
		addMeasured(epis, "sql filter")
		for i := 0; i < len(hits) && i < 3; i++ {
			telemetry = append(telemetry, splits(hits[i].label, hits[i].date, hits[i].dist, hits[i].km))
		}
	}
	if rd := dq.Filters.str("race_date"); rd != "" { // a named race is always brought in with its splits
		var label, km string
		var dist float64
		var d *time.Time
		err := r.Pool.QueryRow(ctx, `SELECT label_id, date, COALESCE(distance_m, 0), COALESCE(km, '[]') FROM train.session_metric WHERE date = $1::date ORDER BY distance_m DESC, label_id LIMIT 1`, rd).Scan(&label, &d, &dist, &km)
		if err == nil {
			epis, err := r.epiByLabel(ctx, []string{label})
			if err != nil {
				return Retrieved{}, err
			}
			addMeasured(epis, "named race")
			found := false
			for _, t := range telemetry {
				found = found || t.LabelID == label
			}
			if !found {
				telemetry = append(telemetry, splits(label, dstr(d), dist, km))
			}
		} else if !errors.Is(err, pgx.ErrNoRows) {
			return Retrieved{}, err
		}
	}
	if focus != "" {
		found := false
		for _, t := range telemetry {
			found = found || t.LabelID == focus
		}
		if !found {
			var label, km string
			var dist float64
			var d *time.Time
			if err := r.Pool.QueryRow(ctx, `SELECT label_id, date, COALESCE(distance_m, 0), COALESCE(km, '[]') FROM train.session_metric WHERE label_id = $1`, focus).Scan(&label, &d, &dist, &km); err == nil {
				telemetry = append([]CtxTelemetry{splits(label, dstr(d), dist, km)}, telemetry...)
			}
		}
	}

	// 3) text retrieval over semantic + episodic memory, fused with RRF, diversified with MMR
	extra := ""
	if focus != "" {
		extra = "durability fade pacing"
	}
	text := strings.TrimSpace(strings.Join([]string{in.Question, StableData.IntentQuery[intent], extra}, " "))
	sinceDate := isoAddDays(date, -since)
	ix, err := r.bm25Index(ctx)
	if err != nil {
		return Retrieved{}, err
	}
	bySem, byEpi := fts(ix, text, "semantic", 30, ""), fts(ix, text, "episodic", 12, sinceDate)
	ids := func(h []ftsHit) []int64 {
		o := make([]int64, len(h))
		for i, x := range h {
			o[i] = x.ID
		}
		return o
	}
	fused := RRF([][]int64{ids(bySem), ids(byEpi)}, 60)
	pool := map[int64]ftsHit{}
	for _, h := range append(append([]ftsHit{}, bySem...), byEpi...) {
		pool[h.ID] = h
	}
	var ranked []Candidate
	for _, f := range fused {
		h := pool[f.ID]
		tag := ""
		if h.Evidence != nil {
			tag = *h.Evidence
		}
		ranked = append(ranked, Candidate{ID: f.ID, Title: h.Title, Body: h.Body, Evidence: tag, Fused: f.Score})
	}
	pick := MMR(ranked, 12, 0.7)
	SortByEvidence(pick)
	if len(pick) > 12 {
		pick = pick[:12]
	}
	for _, c := range pick {
		h := pool[c.ID]
		add(h.memRow, h.Tier, h.Kind, c.Evidence, "text match")
	}

	// 4) correlation edges (supported or candidate), most relevant to the question's topics first
	erows, err := r.Pool.Query(ctx, `SELECT exposure, outcome, lag_lo, lag_hi, ci_lo, ci_hi, n, n_eff, q, partial_rho, status FROM analytics.corr_edge ORDER BY (status = 'supported') DESC, q, ABS(partial_rho) DESC`)
	if err != nil {
		return Retrieved{}, err
	}
	var edges []CtxEdge
	for erows.Next() {
		var e CtxEdge
		var lo, hi *int
		if err := erows.Scan(&e.Exposure, &e.Outcome, &lo, &hi, &e.CI[0], &e.CI[1], &e.N, &e.NEff, &e.Q, &e.PartialRho, &e.Status); err != nil {
			erows.Close()
			return Retrieved{}, err
		}
		if e.Status != "supported" && e.Status != "candidate" {
			continue
		}
		if lo != nil {
			e.Window[0] = *lo
		}
		if hi != nil {
			e.Window[1] = *hi
		}
		e.Caveat = "association in one athlete, not causal"
		edges = append(edges, e)
	}
	erows.Close()
	rel := func(e CtxEdge) int {
		n := 0
		for _, t := range dq.Topics {
			if t == e.Exposure {
				n++
				break
			}
		}
		for _, t := range dq.Topics {
			if t == e.Outcome {
				n++
				break
			}
		}
		return n
	}
	sort.SliceStable(edges, func(a, b int) bool { return rel(edges[a]) > rel(edges[b]) })
	if len(edges) > 8 {
		edges = edges[:8]
	}
	if edges == nil {
		edges = []CtxEdge{}
	}

	// 5) budget: drop from the bottom (text matches → older episodes → edges), never the rules or the twin
	var state map[string]any
	if err := json.Unmarshal([]byte(twinState), &state); err != nil {
		return Retrieved{}, fmt.Errorf("twin state: %w", err)
	}
	twin := CompactTwin(state)
	rulesJSON, _ := marshalNoEscape(rules)
	stableLen := EstTokens(fmt.Sprintf(`{"schema":%q,"athlete":%s,"definitions":%s,"rules":%s}`, ctxSchema, compact(StableRaw["athlete"]), compact(StableRaw["definitions"]), rulesJSON))
	shoeNames := []string{}
	for _, g := range dq.Shoes {
		shoeNames = append(shoeNames, g.Name)
	}
	filters := dq.Filters.withShoes(shoeNames)
	query := map[string]any{"filters": filters, "topics": nilS(dq.Topics)}
	question := Redact(in.Question)
	var episodes, facts []CtxItem
	var tokens int
	var queryJSON, twinJSON, edgesJSON, epJSON, factJSON, telJSON string
	for {
		episodes, facts = []CtxItem{}, []CtxItem{}
		for _, it := range items {
			if it.Tier == "episodic" {
				episodes = append(episodes, it)
			} else {
				facts = append(facts, it)
			}
		}
		queryJSON, _ = marshalOrdered(query, "filters", "topics")
		twinJSON, _ = marshalNoEscape(twin)
		edgesJSON, _ = marshalNoEscape(edges)
		epJSON, _ = marshalNoEscape(episodes)
		factJSON, _ = marshalNoEscape(facts)
		telJSON, _ = marshalNoEscape(telemetry)
		focusJSON := "null"
		if focus != "" {
			focusJSON, _ = marshalNoEscape(focus)
		}
		qj, _ := marshalNoEscape(question)
		ij, _ := marshalNoEscape(intent)
		aj, _ := marshalNoEscape(date)
		volLen := EstTokens(fmt.Sprintf(`{"as_of":%s,"intent":%s,"question":%s,"query":%s,"twin_version":%d,"twin":%s,"episodes":%s,"facts":%s,"correlation_edges":%s,"telemetry":%s,"focus_label":%s}`,
			aj, ij, qj, queryJSON, twinVersion, twinJSON, epJSON, factJSON, edgesJSON, telJSON, focusJSON))
		_ = volLen
		tokens = stableLen + volLen
		if tokens <= budget || len(items) == 0 {
			break
		}
		if len(telemetry) > 1 {
			telemetry = telemetry[:len(telemetry)-1]
			continue
		}
		drop := -1
		for i := len(items) - 1; i >= 0; i-- {
			if items[i].Why == "text match" {
				drop = i
				break
			}
		}
		if drop < 0 {
			for i := len(items) - 1; i >= 0; i-- {
				if items[i].Why == "recent" {
					drop = i
					break
				}
			}
		}
		if drop < 0 {
			drop = len(items) - 1
		}
		items = append(items[:drop], items[drop+1:]...)
	}
	itemIDs := make([]int64, len(items))
	for i, it := range items {
		itemIDs[i] = it.ID
	}
	return Retrieved{
		Ctx: Context{Rules: rules, Volatile: Volatile{Intent: intent, AsOf: date, Question: question, Query: json.RawMessage(queryJSON), Twin: json.RawMessage(twinJSON),
			CorrelationEdges: json.RawMessage(edgesJSON), Episodes: json.RawMessage(epJSON), Facts: json.RawMessage(factJSON), Telemetry: json.RawMessage(telJSON)}},
		ItemIDs: itemIDs, Twin: twin, TokensEst: tokens, Items: items, Edges: edges, Telemetry: telemetry, Focus: focus,
	}, nil
}

// withShoes: the filters as the model sees them: the shoes listed by name.
func (f *Filters) withShoes(names []string) *Filters {
	c := newFilters()
	for _, k := range f.keys {
		if k == "shoes" {
			c.set("shoes", names)
		} else {
			c.set(k, f.m[k])
		}
	}
	return c
}

func marshalOrdered(m map[string]any, keys ...string) (string, error) {
	var sb strings.Builder
	sb.WriteByte('{')
	for i, k := range keys {
		if i > 0 {
			sb.WriteByte(',')
		}
		kb, _ := json.Marshal(k)
		vb, err := marshalNoEscape(m[k])
		if err != nil {
			return "", err
		}
		sb.Write(kb)
		sb.WriteByte(':')
		sb.WriteString(vb)
	}
	sb.WriteByte('}')
	return sb.String(), nil
}
