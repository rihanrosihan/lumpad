package main

import (
	"context"
	"encoding/json"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Inputs of the Sub-4 report, each with where it came from. "data" = computed from the athlete's own records; "assumed" = a stated assumption
// (race-day heat cannot be forecast months ahead, and the realization ratios are model targets), shown as such in the card.
type sub4Param struct {
	Value float64 `json:"value"`
	Basis string  `json:"basis"` // data | assumed | observed
	Note  string  `json:"note"`
}

type sub4Inputs struct {
	VDOT             sub4Param `json:"vdot"`
	RunShareAfter20K sub4Param `json:"run_share_after_20k"`
	LongRunsOver20K  int       `json:"long_runs_over_20k"`
	FMCount          int       `json:"fm_count"`
}

const (
	fallbackVDOT     = 31.7 // last known value, used only until a twin snapshot exists
	fallbackRunShare = 0.28 // observed at Jakim / Borobudur 2026, used only when the per-km curve has too little data
)

// sub4FromTwin reads VDOT and the run share after km 20 from the twin snapshot (durability.run_share_by_km, each km weighted by its sample count).
func sub4FromTwin(stateStr string) sub4Inputs {
	in := sub4Inputs{
		VDOT:             sub4Param{fallbackVDOT, "assumed", "no twin snapshot yet; last known value"},
		RunShareAfter20K: sub4Param{fallbackRunShare, "observed", "Jakim / Borobudur 2026; too few long-run km in the data"},
	}
	var tw map[string]any
	if stateStr == "" || json.Unmarshal([]byte(stateStr), &tw) != nil {
		return in
	}
	if prof, ok := tw["profile"].(map[string]any); ok {
		if v, ok := prof["vdot"].(float64); ok && v > 20 {
			in.VDOT = sub4Param{v, "data", "twin profile"}
		}
	}
	if d, ok := tw["durability"].(map[string]any); ok {
		if rows, ok := d["run_share_by_km"].([]any); ok {
			var sum, n float64
			for _, r := range rows {
				m, _ := r.(map[string]any)
				km, _ := m["km"].(float64)
				sh, ok1 := m["run_share"].(float64)
				cnt, _ := m["n"].(float64)
				if ok1 && km > 20 && cnt > 0 {
					sum += sh * cnt
					n += cnt
				}
			}
			if n >= 6 { // at least a handful of km-samples beyond km 20, else keep the observed value
				in.RunShareAfter20K = sub4Param{sum / n, "data", "mean run share over km 21+ of long runs (twin durability)"}
			}
		}
	}
	return in
}

func sub4Counts(ctx context.Context, pool *pgxpool.Pool, in *sub4Inputs) {
	_ = pool.QueryRow(ctx, `SELECT count(*) FROM train.session_metric WHERE distance_m >= 20000 AND date >= current_date - 180`).Scan(&in.LongRunsOver20K)
	_ = pool.QueryRow(ctx, `SELECT count(*) FROM train.session_metric WHERE distance_m >= 40000`).Scan(&in.FMCount)
}
