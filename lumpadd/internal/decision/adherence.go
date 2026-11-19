package decision

import (
	"context"
	"math"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Phase 5 (P1-2): Planned vs Actual per-session adherence (plan.adherence).

type PlanDay struct {
	Date         string
	Kind         string // easy | quality | long | race | rest | strength
	Label        string
	PlannedKm    float64
	PlannedS     float64
	TargetPaceSK float64 // s/km (0 if none)
}

type ActualSession struct {
	ActivityID     string
	ActualKm       float64
	ActualS        float64
	AvgPaceSK      float64
	TimeInZonePct  float64 // 0..100 from 6-zone FIT data
}

type AdherenceRow struct {
	Date            string  `json:"date"`
	ActivityID      string  `json:"activity_id"`
	PlannedKm       float64 `json:"planned_km"`
	ActualKm        float64 `json:"actual_km"`
	PlannedS        float64 `json:"planned_s"`
	ActualS         float64 `json:"actual_s"`
	TimeInZonePct   float64 `json:"time_in_zone_pct"`
	PaceVsTargetPct float64 `json:"pace_vs_target_pct"`
	Score           float64 `json:"score"`
}

func clamp(v, lo, hi float64) float64 {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

// ComputeAdherence scores a single planned-vs-actual session on 0..100.
// Weights: distance adherence 45%, time-in-zone 35%, pace fidelity 20%.
func ComputeAdherence(p PlanDay, a ActualSession) AdherenceRow {
	row := AdherenceRow{
		Date:          p.Date,
		ActivityID:    a.ActivityID,
		PlannedKm:     p.PlannedKm,
		ActualKm:      a.ActualKm,
		PlannedS:      p.PlannedS,
		ActualS:       a.ActualS,
		TimeInZonePct: clamp(a.TimeInZonePct, 0, 100),
	}
	if p.PlannedKm <= 0 {
		if a.ActualKm == 0 {
			row.Score = 100
		} else {
			row.Score = 70
		}
		return row
	}
	if a.ActualKm <= 0 {
		row.Score = 0
		return row
	}

	distRatio := a.ActualKm / p.PlannedKm
	distErr := math.Abs(distRatio - 1.0)
	distScore := clamp(100*(1-distErr/0.5), 0, 100)

	tizScore := row.TimeInZonePct

	paceScore := 100.0
	if p.TargetPaceSK > 0 && a.AvgPaceSK > 0 {
		// Negative = faster than target, positive = slower than target
		pctDiff := ((a.AvgPaceSK - p.TargetPaceSK) / p.TargetPaceSK) * 100
		row.PaceVsTargetPct = math.Round(pctDiff*10) / 10
		paceScore = clamp(100*(1-math.Abs(pctDiff)/15.0), 0, 100)
	}

	row.Score = math.Round((0.45*distScore+0.35*tizScore+0.20*paceScore)*10) / 10
	return row
}

// UpsertAdherence stores an adherence row into plan.adherence.
func UpsertAdherence(ctx context.Context, pool *pgxpool.Pool, r AdherenceRow) error {
	actID := r.ActivityID
	if actID == "" {
		actID = "none"
	}
	_, err := pool.Exec(ctx, `
		INSERT INTO plan.adherence (date, activity_id, planned_km, actual_km, planned_s, actual_s, time_in_zone_pct, pace_vs_target_pct, score)
		VALUES ($1::date, $2, $3, $4, $5, $6, $7, $8, $9)
		ON CONFLICT (date, activity_id) DO UPDATE SET
			planned_km = EXCLUDED.planned_km,
			actual_km = EXCLUDED.actual_km,
			planned_s = EXCLUDED.planned_s,
			actual_s = EXCLUDED.actual_s,
			time_in_zone_pct = EXCLUDED.time_in_zone_pct,
			pace_vs_target_pct = EXCLUDED.pace_vs_target_pct,
			score = EXCLUDED.score`,
		r.Date, actID, r.PlannedKm, r.ActualKm, r.PlannedS, r.ActualS, r.TimeInZonePct, r.PaceVsTargetPct, r.Score,
	)
	return err
}

// ListAdherence returns recent adherence rows newest first.
func ListAdherence(ctx context.Context, pool *pgxpool.Pool, limit int) ([]AdherenceRow, error) {
	if limit <= 0 {
		limit = 30
	}
	rows, err := pool.Query(ctx, `
		SELECT to_char(date,'YYYY-MM-DD'), activity_id, COALESCE(planned_km,0), COALESCE(actual_km,0),
		       COALESCE(planned_s,0), COALESCE(actual_s,0), COALESCE(time_in_zone_pct,0), COALESCE(pace_vs_target_pct,0), COALESCE(score,0)
		FROM plan.adherence ORDER BY date DESC, activity_id LIMIT $1`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []AdherenceRow{}
	for rows.Next() {
		var r AdherenceRow
		if err := rows.Scan(&r.Date, &r.ActivityID, &r.PlannedKm, &r.ActualKm, &r.PlannedS, &r.ActualS, &r.TimeInZonePct, &r.PaceVsTargetPct, &r.Score); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}
