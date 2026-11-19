package decision

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Phase 5 (P1-3): Coaching decision ledger (coach.decision) & plan overlays (plan.overlay) + outcome evaluation.

type DecisionRecord struct {
	ID          int64           `json:"id"`
	CreatedAt   time.Time       `json:"created_at"`
	Source      string          `json:"source"`
	ScopeFrom   *string         `json:"scope_from,omitempty"`
	ScopeTo     *string         `json:"scope_to,omitempty"`
	Change      json.RawMessage `json:"change"`
	Reason      string          `json:"reason"`
	EvidenceIDs []int64         `json:"evidence_ids"`
	Expected    json.RawMessage `json:"expected,omitempty"`
	Status      string          `json:"status"`
	Outcome     json.RawMessage `json:"outcome,omitempty"`
	Verdict     *string         `json:"verdict,omitempty"`
}

// StoreProposal persists a rule or coach proposal into coach.decision (status='proposed') and plan.overlay.
func StoreProposal(ctx context.Context, pool *pgxpool.Pool, source string, p Proposal, evidenceIDs []int64) (int64, error) {
	if evidenceIDs == nil {
		evidenceIDs = []int64{}
	}
	chJSON, err := json.Marshal(p.Changes)
	if err != nil {
		return 0, err
	}
	expJSON, err := json.Marshal(p.Expected)
	if err != nil {
		return 0, err
	}
	var sf, st *string
	if p.ScopeFrom != "" {
		sf = &p.ScopeFrom
	}
	if p.ScopeTo != "" {
		st = &p.ScopeTo
	}
	var id int64
	err = pool.QueryRow(ctx, `
		INSERT INTO coach.decision (source, scope_from, scope_to, change, reason, evidence_ids, expected, status)
		VALUES ($1, $2::date, $3::date, $4::jsonb, $5, $6, $7::jsonb, 'proposed')
		RETURNING id`,
		source, sf, st, string(chJSON), p.Reason, evidenceIDs, string(expJSON),
	).Scan(&id)
	if err != nil {
		return 0, err
	}
	for _, c := range p.Changes {
		fromB, _ := json.Marshal(c.From)
		toB, _ := json.Marshal(c.To)
		_, _ = pool.Exec(ctx, `
			INSERT INTO plan.overlay (date, from_session, to_session, decision_id, status)
			VALUES ($1::date, $2::jsonb, $3::jsonb, $4, 'proposed')`,
			c.Date, string(fromB), string(toB), id,
		)
	}
	return id, nil
}

// DecideProposal marks a proposed decision accepted or rejected and updates matching overlays.
func DecideProposal(ctx context.Context, pool *pgxpool.Pool, id int64, accept bool) error {
	status := "rejected"
	if accept {
		status = "accepted"
	}
	tag, err := pool.Exec(ctx, `UPDATE coach.decision SET status=$1 WHERE id=$2 AND status='proposed'`, status, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return errors.New("decision not found or not in proposed state")
	}
	_, err = pool.Exec(ctx, `UPDATE plan.overlay SET status=$1, decided_at=now() WHERE decision_id=$2`, status, id)
	return err
}

// OutcomeInput holds observed metrics 3–14 days after a decision was executed.
type OutcomeInput struct {
	PainMax      *float64 `json:"pain_max,omitempty"`
	AvgHR        *float64 `json:"avg_hr,omitempty"`
	HR800Delta   *float64 `json:"hr800_delta,omitempty"`
	Compliance   *float64 `json:"compliance_pct,omitempty"`
	Executed     bool     `json:"executed"`
}

// EvaluateOutcome compares expected checks against observed metrics and returns helped | neutral | harmed | unknown.
func EvaluateOutcome(expected map[string]any, obs OutcomeInput) (string, map[string]any) {
	if !obs.Executed {
		return "unknown", map[string]any{"executed": false}
	}
	detail := map[string]any{"executed": true}
	helped, harmed := 0, 0
	if obs.PainMax != nil {
		detail["pain_max"] = *obs.PainMax
		if *obs.PainMax >= 2 {
			harmed++
		} else if *obs.PainMax == 0 {
			helped++
		}
	}
	if obs.Compliance != nil {
		detail["compliance_pct"] = *obs.Compliance
		if *obs.Compliance >= 75 {
			helped++
		} else if *obs.Compliance < 50 {
			harmed++
		}
	}
	if obs.HR800Delta != nil {
		detail["hr800_delta"] = *obs.HR800Delta
		if *obs.HR800Delta <= 2 {
			helped++
		} else if *obs.HR800Delta > 5 {
			harmed++
		}
	}
	if maxHR, ok := expected["easy_avg_hr_max"].(float64); ok && obs.AvgHR != nil {
		detail["avg_hr"] = *obs.AvgHR
		if *obs.AvgHR <= maxHR {
			helped++
		} else {
			harmed++
		}
	}
	if harmed > 0 {
		return "harmed", detail
	}
	if helped > 0 {
		return "helped", detail
	}
	if len(detail) <= 1 {
		return "unknown", detail
	}
	return "neutral", detail
}

// RecordOutcome writes the evaluated outcome and verdict back to coach.decision.
func RecordOutcome(ctx context.Context, pool *pgxpool.Pool, id int64, verdict string, outcome map[string]any) error {
	b, err := json.Marshal(outcome)
	if err != nil {
		return err
	}
	_, err = pool.Exec(ctx, `UPDATE coach.decision SET status='evaluated', verdict=$1, outcome=$2::jsonb WHERE id=$3`, verdict, string(b), id)
	return err
}

// ListDecisions returns recent coaching decisions newest first.
func ListDecisions(ctx context.Context, pool *pgxpool.Pool, limit int) ([]DecisionRecord, error) {
	if limit <= 0 {
		limit = 30
	}
	rows, err := pool.Query(ctx, `
		SELECT id, created_at, source, to_char(scope_from,'YYYY-MM-DD'), to_char(scope_to,'YYYY-MM-DD'),
		       change, reason, evidence_ids, expected, status, outcome, verdict
		FROM coach.decision ORDER BY id DESC LIMIT $1`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []DecisionRecord{}
	for rows.Next() {
		var r DecisionRecord
		if err := rows.Scan(&r.ID, &r.CreatedAt, &r.Source, &r.ScopeFrom, &r.ScopeTo, &r.Change, &r.Reason, &r.EvidenceIDs, &r.Expected, &r.Status, &r.Outcome, &r.Verdict); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}
