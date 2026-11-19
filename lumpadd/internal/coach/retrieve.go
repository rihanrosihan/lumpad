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
	"github.com/rihanrosihan/lumpad/lumpadd/internal/graph"
)

// Phase 4-e: PostgreSQL Retrieval & RAG implementing coach.Retriever.
// Combines SQL filters over train.session_metric, 14-D z-scored fingerprint kNN, PostgreSQL tsvector FTS + RRF + MMR,
// correlation edges, and per-intent token budget compression (P2-2).

var (
	EvidenceOrder = []string{"VALIDATED", "MEASURED", "CALCULATED", "CLINICIAN", "KB", "REPORTED", "LITERATURE", "HYPOTHESIS"}
	IntentBudget  = map[string]int{
		"daily_brief":    6000,
		"session_review": 12000,
		"weekly_review":  12000,
		"race_plan":      16000,
		"question":       16000,
	}
	knnFeatures = []string{"log_dist", "log_dur", "run_pace", "run_hr", "ef", "run_share", "drift", "gct_fade", "stride_fade", "vr_fade", "temp", "gain_km", "tl_min", "hrv_dev"}
)

func evidenceRank(tag string) int {
	for i, t := range EvidenceOrder {
		if t == tag {
			return i
		}
	}
	return len(EvidenceOrder)
}

type RetrievedItem struct {
	ID    int64   `json:"id"`
	Tier  string  `json:"tier"`
	Kind  string  `json:"kind"`
	Title string  `json:"title"`
	Body  string  `json:"body"`
	Tag   string  `json:"tag"`
	Why   string  `json:"why"`
	Date  *string `json:"date"`
	fused float64
}

type TelemetrySplit struct {
	LabelID string  `json:"label_id"`
	Date    string  `json:"date"`
	KmTotal float64 `json:"km_total"`
	Cols    string  `json:"cols"`
	Km      [][]any `json:"km"`
}

type CorrEdgeOut struct {
	Exposure   string     `json:"exposure"`
	Outcome    string     `json:"outcome"`
	WindowDays [2]int64   `json:"window_days_before"`
	PartialRho *float64   `json:"partial_rho"`
	CI         [2]*float64 `json:"ci"`
	N          int64      `json:"n"`
	NEff       *float64   `json:"n_eff"`
	Q          *float64   `json:"q"`
	Status     string     `json:"status"`
	Caveat     string     `json:"caveat"`
}

// ---- Pure ranking & similarity helpers (unit-tested without Postgres)

type RankedID struct {
	ID    int64
	Score float64
}

// RRF computes Reciprocal Rank Fusion (k = 60) over multiple ranked ID lists.
func RRF(lists [][]int64, k int) []RankedID {
	if k <= 0 {
		k = 60
	}
	scores := map[int64]float64{}
	for _, l := range lists {
		for i, id := range l {
			scores[id] += 1.0 / float64(k+i+1)
		}
	}
	out := make([]RankedID, 0, len(scores))
	for id, sc := range scores {
		out = append(out, RankedID{ID: id, Score: sc})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Score != out[j].Score {
			return out[i].Score > out[j].Score
		}
		return out[i].ID < out[j].ID
	})
	return out
}

// MMR selects up to k diverse items using Jaccard overlap over 4+ char tokens (lambda = 0.7).
func MMR(items []RetrievedItem, k int, lambda float64) []RetrievedItem {
	if len(items) == 0 || k <= 0 {
		return nil
	}
	if lambda <= 0 {
		lambda = 0.7
	}
	toks := make([]map[string]bool, len(items))
	for i, it := range items {
		toks[i] = Tokens(it.Title + " " + it.Body)
	}
	topScale := items[0].fused
	if topScale == 0 {
		topScale = 1
	}
	used := make([]bool, len(items))
	chosen := make([]int, 0, min(k, len(items)))
	for len(chosen) < k && len(chosen) < len(items) {
		bestIdx := -1
		bestSc := -1e18
		for i := range items {
			if used[i] {
				continue
			}
			maxSim := 0.0
			for _, j := range chosen {
				if sim := Jaccard(toks[i], toks[j]); sim > maxSim {
					maxSim = sim
				}
			}
			sc := lambda*items[i].fused - (1-lambda)*maxSim*topScale
			if sc > bestSc {
				bestSc = sc
				bestIdx = i
			}
		}
		if bestIdx < 0 {
			break
		}
		used[bestIdx] = true
		chosen = append(chosen, bestIdx)
	}
	out := make([]RetrievedItem, len(chosen))
	for i, idx := range chosen {
		out[i] = items[idx]
	}
	return out
}

// SortByEvidence orders items by EvidenceOrder (stable).
func SortByEvidence(items []RetrievedItem) []RetrievedItem {
	out := append([]RetrievedItem(nil), items...)
	sort.SliceStable(out, func(i, j int) bool {
		return evidenceRank(out[i].Tag) < evidenceRank(out[j].Tag)
	})
	return out
}

type SessionFeat struct {
	LabelID   string
	Date      string
	DistanceM float64
	Features  map[string]*float64
}

// NearestSessions finds the top-k earlier runs (>3 km) by 14-D z-scored cosine similarity.
func NearestSessions(rows []SessionFeat, targetLabel string, k int) []string {
	var me *SessionFeat
	for i := range rows {
		if rows[i].LabelID == targetLabel {
			me = &rows[i]
			break
		}
	}
	if me == nil || k <= 0 {
		return nil
	}
	mean := make([]float64, len(knnFeatures))
	sd := make([]float64, len(knnFeatures))
	for fi, key := range knnFeatures {
		var vals []float64
		for _, r := range rows {
			if p := r.Features[key]; p != nil && !math.IsNaN(*p) && !math.IsInf(*p, 0) {
				vals = append(vals, *p)
			}
		}
		if len(vals) == 0 {
			sd[fi] = 1
			continue
		}
		sum := 0.0
		for _, v := range vals {
			sum += v
		}
		m := sum / float64(len(vals))
		mean[fi] = m
		varSq := 0.0
		for _, v := range vals {
			d := v - m
			varSq += d * d
		}
		denom := float64(max(1, len(vals)-1))
		s := math.Sqrt(varSq / denom)
		if s == 0 {
			s = 1
		}
		sd[fi] = s
	}
	zvec := func(r SessionFeat) []float64 {
		v := make([]float64, len(knnFeatures))
		for fi, key := range knnFeatures {
			if p := r.Features[key]; p != nil && !math.IsNaN(*p) && !math.IsInf(*p, 0) {
				v[fi] = (*p - mean[fi]) / sd[fi]
			}
		}
		return v
	}
	cosine := func(a, b []float64) float64 {
		dot, na, nb := 0.0, 0.0, 0.0
		for i := range a {
			dot += a[i] * b[i]
			na += a[i] * a[i]
			nb += b[i] * b[i]
		}
		if na == 0 || nb == 0 {
			return 0
		}
		return dot / math.Sqrt(na*nb)
	}
	vMe := zvec(*me)
	type cand struct {
		id  string
		sim float64
	}
	var cands []cand
	for _, r := range rows {
		if r.LabelID == targetLabel || r.Date >= me.Date || r.DistanceM <= 3000 {
			continue
		}
		cands = append(cands, cand{r.LabelID, cosine(vMe, zvec(r))})
	}
	sort.Slice(cands, func(i, j int) bool { return cands[i].sim > cands[j].sim })
	if len(cands) > k {
		cands = cands[:k]
	}
	out := make([]string, len(cands))
	for i, c := range cands {
		out[i] = c.id
	}
	return out
}

// BuildTSQuery converts free text into a safe PostgreSQL OR-joined simple tsquery (at most 24 distinct tokens ≥3 chars).
func BuildTSQuery(text string) string {
	terms := ftsTerms(text)
	if len(terms) == 0 {
		return ""
	}
	parts := make([]string, 0, len(terms))
	for _, toks := range terms {
		if len(toks) == 0 {
			continue
		}
		if len(toks) == 1 {
			parts = append(parts, toks[0])
		} else {
			parts = append(parts, "("+strings.Join(toks, " <-> ")+")")
		}
	}
	return strings.Join(parts, " | ")
}

func estTokens(s string) int {
	return int(math.Ceil(float64(len(s)) / 3.6))
}

func compactTwinMap(state map[string]any) map[string]any {
	b, _ := json.Marshal(state)
	var cp map[string]any
	_ = json.Unmarshal(b, &cp)
	if cp == nil {
		return map[string]any{}
	}
	delete(cp, "fade_curves")
	if dur, ok := cp["durability"].(map[string]any); ok {
		delete(dur, "run_share_by_km")
	}
	if races, ok := cp["races"].(map[string]any); ok {
		if fm, ok := races["fm_attempts"].([]any); ok && len(fm) > 3 {
			races["fm_attempts"] = fm[len(fm)-3:]
		}
	}
	if shoes, ok := cp["shoes"].([]any); ok {
		kept := make([]any, 0, 6)
		for _, sh := range shoes {
			m, _ := sh.(map[string]any)
			n, _ := m["n"].(float64)
			ret, _ := m["retired"].(bool)
			if n > 0 || !ret {
				kept = append(kept, sh)
				if len(kept) == 6 {
					break
				}
			}
		}
		cp["shoes"] = kept
	}
	return cp
}

// ---- PostgreSQL Retriever

type PGRetriever struct {
	Pool        *pgxpool.Pool
	Graph       *graph.Client // optional Neo4j AuraDB hybrid RAG expansion (1.5s timeout, PG fallback)
	TokenBudget int           // 0 = use per-intent budget (IntentBudget)
	SinceDays   int           // default 400
}

func (r *PGRetriever) Retrieve(ctx context.Context, in RunInput) (Retrieved, error) {
	if r.Pool == nil {
		return Retrieved{}, errors.New("pg retriever: nil pool")
	}
	intent := in.Intent
	if intent == "" {
		intent = "daily_brief"
	}
	date := in.Date
	if date == "" {
		date = time.Now().UTC().Add(7 * time.Hour).Format("2006-01-02")
	}
	sinceDays := r.SinceDays
	if sinceDays <= 0 {
		sinceDays = 400
	}
	budget := r.TokenBudget
	if budget <= 0 {
		budget = IntentBudget[intent]
		if budget == 0 {
			budget = 16000
		}
	}

	// 1. Latest twin snapshot
	var twinStateStr string
	err := r.Pool.QueryRow(ctx, `SELECT state FROM athlete.state_snapshot ORDER BY version DESC LIMIT 1`).Scan(&twinStateStr)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Retrieved{}, errors.New("twin not built yet — run the intelligence job first")
		}
		return Retrieved{}, err
	}
	var twinFull map[string]any
	if err := json.Unmarshal([]byte(twinStateStr), &twinFull); err != nil {
		return Retrieved{}, fmt.Errorf("twin json: %w", err)
	}

	// 2. Pinned procedural rules
	rules := []Rule{}
	rRows, err := r.Pool.Query(ctx, `SELECT id, COALESCE(title,''), COALESCE(body,''), COALESCE(locked,0), COALESCE(evidence_tag,'') FROM memory.item WHERE tier='procedural' AND status='active' ORDER BY locked DESC, id`)
	if err != nil {
		return Retrieved{}, err
	}
	for rRows.Next() {
		var id, locked int64
		var title, body, tag string
		if err := rRows.Scan(&id, &title, &body, &locked, &tag); err != nil {
			rRows.Close()
			return Retrieved{}, err
		}
		rules = append(rules, Rule{ID: int(id), Title: title, Rule: Redact(body), Locked: locked != 0, Tag: tag})
	}
	rRows.Close()

	itemsMap := map[int64]bool{}
	items := []RetrievedItem{}
	addItem := func(it RetrievedItem) {
		if it.ID == 0 || itemsMap[it.ID] {
			return
		}
		itemsMap[it.ID] = true
		it.Title = Redact(it.Title)
		it.Body = Redact(it.Body)
		items = append(items, it)
	}

	epiByLabels := func(labels []string, why string) error {
		if len(labels) == 0 {
			return nil
		}
		byRef := map[string]RetrievedItem{}
		rows2, err := r.Pool.Query(ctx, `SELECT id, COALESCE(title,''), COALESCE(body,''), valid_from, source_ref FROM memory.item WHERE source='fit' AND source_ref = ANY($1)`, labels)
		if err != nil {
			return err
		}
		defer rows2.Close()
		for rows2.Next() {
			var id int64
			var title, body, ref string
			var vf *string
			if err := rows2.Scan(&id, &title, &body, &vf, &ref); err != nil {
				return err
			}
			byRef[ref] = RetrievedItem{ID: id, Tier: "episodic", Kind: "session", Title: title, Body: body, Tag: "MEASURED", Why: why, Date: vf}
		}
		for _, l := range labels {
			if it, ok := byRef[l]; ok {
				addItem(it)
			}
		}
		return nil
	}

	// 3. Focus session + 14-D kNN or recent episodic sessions
	focus := ""
	if in.ActivityID != "" {
		stripped := strings.TrimPrefix(in.ActivityID, "coros:")
		_ = r.Pool.QueryRow(ctx, `SELECT label_id FROM train.session_metric WHERE activity_id=$1 OR label_id=$2 LIMIT 1`, in.ActivityID, stripped).Scan(&focus)
	}
	if focus != "" {
		fRows, err := r.Pool.Query(ctx, `SELECT label_id, COALESCE(to_char(date,'YYYY-MM-DD'),''), COALESCE(distance_m,0), COALESCE(features,'{}') FROM train.session_metric`)
		if err == nil {
			var feats []SessionFeat
			for fRows.Next() {
				var lid, dt, fjson string
				var dm float64
				if fRows.Scan(&lid, &dt, &dm, &fjson) == nil {
					fm := map[string]*float64{}
					_ = json.Unmarshal([]byte(fjson), &fm)
					feats = append(feats, SessionFeat{LabelID: lid, Date: dt, DistanceM: dm, Features: fm})
				}
			}
			fRows.Close()
			labels := append([]string{focus}, NearestSessions(feats, focus, 3)...)
			_ = epiByLabels(labels, "focus/similar")
		}
	} else {
		n := 5
		if intent == "weekly_review" {
			n = 10
		} else if intent == "race_plan" {
			n = 6
		}
		eRows, err := r.Pool.Query(ctx, `SELECT id, COALESCE(title,''), COALESCE(body,''), valid_from FROM memory.item WHERE tier='episodic' AND status='active' AND valid_from IS NOT NULL ORDER BY valid_from DESC LIMIT $1`, n)
		if err == nil {
			for eRows.Next() {
				var id int64
				var title, body string
				var vf *string
				if eRows.Scan(&id, &title, &body, &vf) == nil {
					addItem(RetrievedItem{ID: id, Tier: "episodic", Kind: "session", Title: title, Body: body, Tag: "MEASURED", Why: "recent", Date: vf})
				}
			}
			eRows.Close()
		}
	}

	// 4. Query decomposition + SQL filters over train.session_metric
	var gear []Gear
	if gRows, err := r.Pool.Query(ctx, `SELECT id, COALESCE(name,'') FROM train.gear`); err == nil {
		for gRows.Next() {
			var g Gear
			if gRows.Scan(&g.ID, &g.Name) == nil {
				gear = append(gear, g)
			}
		}
		gRows.Close()
	}
	dq := Decompose(in.Question, date, gear)
	telemetry := []TelemetrySplit{}
	hasTel := func(lid string) bool {
		for _, t := range telemetry {
			if t.LabelID == lid {
				return true
			}
		}
		return false
	}
	parseSplits := func(lid, dt string, distM float64, kmJSON string) TelemetrySplit {
		var raw []map[string]any
		_ = json.Unmarshal([]byte(kmJSON), &raw)
		rows := make([][]any, 0, len(raw))
		for _, k := range raw {
			rows = append(rows, []any{k["km"], k["pace"], k["hr"], k["cad"], k["gct"], k["runShare"]})
		}
		return TelemetrySplit{
			LabelID: lid,
			Date:    dt,
			KmTotal: math.Round(distM/100) / 10,
			Cols:    "km, pace s/km (elapsed), HR, cadence spm, GCT ms, run share",
			Km:      rows,
		}
	}

	if dq.HasFilters {
		where, params := FilterSQL(dq.Filters)
		sqlQ := `SELECT s.label_id, COALESCE(to_char(s.date,'YYYY-MM-DD'),''), COALESCE(s.distance_m,0), COALESCE(s.km,'[]') FROM train.session_metric s LEFT JOIN train.run_weather w ON w.label_id = s.label_id ` + where + ` ORDER BY s.date DESC LIMIT 6`
		if sRows, err := r.Pool.Query(ctx, sqlQ, params...); err == nil {
			var hitLabels []string
			for sRows.Next() {
				var lid, dt, kmJ string
				var dm float64
				if sRows.Scan(&lid, &dt, &dm, &kmJ) == nil {
					hitLabels = append(hitLabels, lid)
					if len(telemetry) < 3 {
						telemetry = append(telemetry, parseSplits(lid, dt, dm, kmJ))
					}
				}
			}
			sRows.Close()
			_ = epiByLabels(hitLabels, "sql filter")
		}
	}
	if dq.Filters.RaceDate != "" {
		var lid, dt, kmJ string
		var dm float64
		if err := r.Pool.QueryRow(ctx, `SELECT label_id, COALESCE(to_char(date,'YYYY-MM-DD'),''), COALESCE(distance_m,0), COALESCE(km,'[]') FROM train.session_metric WHERE date = $1::date ORDER BY distance_m DESC LIMIT 1`, dq.Filters.RaceDate).Scan(&lid, &dt, &dm, &kmJ); err == nil {
			_ = epiByLabels([]string{lid}, "named race")
			if !hasTel(lid) {
				telemetry = append(telemetry, parseSplits(lid, dt, dm, kmJ))
			}
		}
	}
	if focus != "" && !hasTel(focus) {
		var lid, dt, kmJ string
		var dm float64
		if err := r.Pool.QueryRow(ctx, `SELECT label_id, COALESCE(to_char(date,'YYYY-MM-DD'),''), COALESCE(distance_m,0), COALESCE(km,'[]') FROM train.session_metric WHERE label_id = $1`, focus).Scan(&lid, &dt, &dm, &kmJ); err == nil {
			telemetry = append([]TelemetrySplit{parseSplits(lid, dt, dm, kmJ)}, telemetry...)
		}
	}

	// 5. PostgreSQL FTS over memory.item.tsv + RRF + MMR
	focusExtra := ""
	if focus != "" {
		focusExtra = "durability fade pacing"
	}
	qText := strings.TrimSpace(strings.Join([]string{in.Question, StableData.IntentQuery[intent], focusExtra}, " "))
	tsq := BuildTSQuery(qText)
	if tsq != "" {
		since := addDaysISO(date, -sinceDays)
		fts := func(tier string, limit int, useSince bool) []RetrievedItem {
			var rows pgx.Rows
			var qerr error
			if useSince {
				rows, qerr = r.Pool.Query(ctx, `SELECT id, tier, COALESCE(kind,''), COALESCE(title,''), COALESCE(body,''), COALESCE(evidence_tag,''), valid_from FROM memory.item WHERE tsv @@ to_tsquery('simple', $1) AND tier=$2 AND status='active' AND (valid_from IS NULL OR valid_from >= $3) ORDER BY ts_rank_cd(tsv, to_tsquery('simple', $1)) DESC LIMIT $4`, tsq, tier, since, limit)
			} else {
				rows, qerr = r.Pool.Query(ctx, `SELECT id, tier, COALESCE(kind,''), COALESCE(title,''), COALESCE(body,''), COALESCE(evidence_tag,''), valid_from FROM memory.item WHERE tsv @@ to_tsquery('simple', $1) AND tier=$2 AND status='active' ORDER BY ts_rank_cd(tsv, to_tsquery('simple', $1)) DESC LIMIT $3`, tsq, tier, limit)
			}
			if qerr != nil {
				return nil
			}
			defer rows.Close()
			var out []RetrievedItem
			for rows.Next() {
				var it RetrievedItem
				if rows.Scan(&it.ID, &it.Tier, &it.Kind, &it.Title, &it.Body, &it.Tag, &it.Date) == nil {
					it.Why = "text match"
					out = append(out, it)
				}
			}
			return out
		}
		bySem := fts("semantic", 30, false)
		byEpi := fts("episodic", 12, true)
		semIDs := make([]int64, len(bySem))
		poolMap := map[int64]RetrievedItem{}
		for i, x := range bySem {
			semIDs[i] = x.ID
			poolMap[x.ID] = x
		}
		epiIDs := make([]int64, len(byEpi))
		for i, x := range byEpi {
			epiIDs[i] = x.ID
			poolMap[x.ID] = x
		}
		var graphMemIDs []int64
		if r.Graph != nil && intent != "daily_brief" {
			if gh, gerr := graph.ExpandContext(ctx, r.Graph, intent, dq.Topics, focus); gerr == nil {
				_ = epiByLabels(gh.SessionLabels, "graph multi-hop")
				graphMemIDs = gh.MemoryIDs
			}
		}
		fused := RRF([][]int64{semIDs, epiIDs, graphMemIDs}, 60)
		ranked := make([]RetrievedItem, 0, len(fused))
		for _, f := range fused {
			if it, ok := poolMap[f.ID]; ok {
				it.fused = f.Score
				ranked = append(ranked, it)
			}
		}
		picked := SortByEvidence(MMR(ranked, 12, 0.7))
		for _, it := range picked {
			addItem(it)
		}
	}

	// 6. Correlation edges
	topicSet := map[string]bool{}
	for _, t := range dq.Topics {
		topicSet[t] = true
	}
	type edgeRow struct {
		out CorrEdgeOut
		rel int
	}
	var eList []edgeRow
	if cRows, err := r.Pool.Query(ctx, `SELECT COALESCE(exposure,''), COALESCE(outcome,''), COALESCE(lag_lo,0), COALESCE(lag_hi,0), partial_rho, ci_lo, ci_hi, COALESCE(n,0), n_eff, q, COALESCE(status,'') FROM analytics.corr_edge WHERE status IN ('supported','candidate')`); err == nil {
		for cRows.Next() {
			var e CorrEdgeOut
			if cRows.Scan(&e.Exposure, &e.Outcome, &e.WindowDays[0], &e.WindowDays[1], &e.PartialRho, &e.CI[0], &e.CI[1], &e.N, &e.NEff, &e.Q, &e.Status) == nil {
				e.Caveat = "association in one athlete, not causal"
				rel := 0
				if topicSet[e.Exposure] {
					rel++
				}
				if topicSet[e.Outcome] {
					rel++
				}
				eList = append(eList, edgeRow{e, rel})
			}
		}
		cRows.Close()
	}
	sort.SliceStable(eList, func(i, j int) bool { return eList[i].rel > eList[j].rel })
	edges := make([]CorrEdgeOut, 0, min(8, len(eList)))
	for i := 0; i < len(eList) && i < 8; i++ {
		edges = append(edges, eList[i].out)
	}

	// 7. Token budget trimming loop
	twinCompact := compactTwinMap(twinFull)
	twinJSON, _ := json.Marshal(twinCompact)
	edgesJSON, _ := json.Marshal(edges)
	shoeNames := make([]string, len(dq.Filters.Shoes))
	for i, s := range dq.Filters.Shoes {
		shoeNames[i] = s.Name
	}
	queryObj := map[string]any{
		"filters": map[string]any{
			"from": dq.Filters.From, "to": dq.Filters.To, "race": dq.Filters.Race,
			"dist_km": dq.Filters.DistKm, "kinds": dq.Filters.Kinds, "indoor": dq.Filters.Indoor,
			"hr_min": dq.Filters.HRMin, "hr_max": dq.Filters.HRMax, "shoes": shoeNames,
		},
		"topics": dq.Topics,
	}
	queryJSON, _ := json.Marshal(queryObj)
	rulesJSON, _ := json.Marshal(rules)
	stableTokens := estTokens(string(rulesJSON)) + estTokens(string(stableJSON))

	var epiJSON, factsJSON, telJSON []byte
	var totalTokens int
	for {
		epis := []RetrievedItem{}
		facts := []RetrievedItem{}
		for _, it := range items {
			if it.Tier == "episodic" {
				epis = append(epis, it)
			} else {
				facts = append(facts, it)
			}
		}
		epiJSON, _ = json.Marshal(epis)
		factsJSON, _ = json.Marshal(facts)
		telJSON, _ = json.Marshal(telemetry)
		totalTokens = stableTokens + estTokens(string(queryJSON)) + estTokens(string(twinJSON)) + estTokens(string(edgesJSON)) + estTokens(string(epiJSON)) + estTokens(string(factsJSON)) + estTokens(string(telJSON))
		if totalTokens <= budget || len(items) == 0 {
			break
		}
		if len(telemetry) > 1 {
			telemetry = telemetry[:len(telemetry)-1]
			continue
		}
		dropIdx := -1
		for i := len(items) - 1; i >= 0; i-- {
			if items[i].Why == "text match" {
				dropIdx = i
				break
			}
		}
		if dropIdx < 0 {
			for i := len(items) - 1; i >= 0; i-- {
				if items[i].Why == "recent" {
					dropIdx = i
					break
				}
			}
		}
		if dropIdx < 0 {
			dropIdx = len(items) - 1
		}
		items = append(items[:dropIdx], items[dropIdx+1:]...)
	}

	itemIDs := make([]int64, len(items))
	for i, it := range items {
		itemIDs[i] = it.ID
	}
	ctxOut := Context{
		Rules: rules,
		Volatile: Volatile{
			Intent:           intent,
			AsOf:             date,
			Question:         Redact(in.Question),
			Query:            queryJSON,
			Twin:             twinJSON,
			CorrelationEdges: edgesJSON,
			Episodes:         epiJSON,
			Facts:            factsJSON,
			Telemetry:        telJSON,
		},
	}
	return Retrieved{Ctx: ctxOut, ItemIDs: itemIDs, Twin: twinFull, TokensEst: totalTokens}, nil
}
