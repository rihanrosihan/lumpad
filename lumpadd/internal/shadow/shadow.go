// Package shadow runs the Go system beside the Node app and proves it produces the same rows (redesign Phase 3, gate G3).
// One pass: mirror SQLite → Postgres (verified) · replay new Node pull traces · recompute new/reprocessed FIT sessions · compare the twin and
// the correlation edges of each newly finished Node intel job. Every comparison is written to analytics.shadow_check.
package shadow

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"path/filepath"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/rihanrosihan/lumpad/lumpadd/internal/analytics"
	"github.com/rihanrosihan/lumpad/lumpadd/internal/coros"
	"github.com/rihanrosihan/lumpad/lumpadd/internal/engine"
	"github.com/rihanrosihan/lumpad/lumpadd/internal/jsondiff"
	"github.com/rihanrosihan/lumpad/lumpadd/internal/loader"
)

type Check struct {
	Kind, Ref, Status string
	Diffs             []string
}
type Summary struct {
	RunID  int64
	Checks []Check
}

func (s Summary) Counts() map[string]map[string]int {
	out := map[string]map[string]int{}
	for _, c := range s.Checks {
		if out[c.Kind] == nil {
			out[c.Kind] = map[string]int{}
		}
		out[c.Kind][c.Status]++
	}
	return out
}

type runner struct {
	ctx context.Context
	pg  *pgxpool.Pool
	dir string
	sum Summary
}

func (r *runner) add(kind, ref, status string, diffs []string) {
	if status == "ok" && len(diffs) > 0 {
		status = "diff"
	}
	r.sum.Checks = append(r.sum.Checks, Check{kind, ref, status, diffs})
}
func (r *runner) state(k string) string {
	var v string
	_ = r.pg.QueryRow(r.ctx, `SELECT v FROM analytics.shadow_state WHERE k=$1`, k).Scan(&v)
	return v
}
func (r *runner) setState(k, v string) {
	_, _ = r.pg.Exec(r.ctx, `INSERT INTO analytics.shadow_state (k, v) VALUES ($1,$2) ON CONFLICT (k) DO UPDATE SET v=excluded.v`, k, v)
}

// Run does one shadow pass over dataDir (the Node app's server/data).
// ErrBusy: another shadow pass holds the lock (the timer and a manual run, or two timers, must never overlap: both reload the mirror tables).
var ErrBusy = errors.New("another shadow pass is running")

const lockKey = 7461001 // arbitrary application-wide advisory lock id

func Run(ctx context.Context, pg *pgxpool.Pool, dataDir string) (Summary, error) {
	conn, err := pg.Acquire(ctx) // advisory locks belong to a session: hold one connection for the whole pass
	if err != nil {
		return Summary{}, err
	}
	defer conn.Release()
	var got bool
	if err := conn.QueryRow(ctx, `SELECT pg_try_advisory_lock($1)`, lockKey).Scan(&got); err != nil {
		return Summary{}, err
	}
	if !got {
		return Summary{}, ErrBusy
	}
	defer func() { _, _ = conn.Exec(context.Background(), `SELECT pg_advisory_unlock($1)`, lockKey) }()
	r := &runner{ctx: ctx, pg: pg, dir: dataDir}
	if err := pg.QueryRow(ctx, `SELECT COALESCE(MAX(run_id), 0) + 1 FROM analytics.shadow_check`).Scan(&r.sum.RunID); err != nil {
		return r.sum, err
	}
	r.mirror()
	r.pulls()
	r.fit()
	r.intel()
	for _, c := range r.sum.Checks {
		var d any
		if len(c.Diffs) > 0 {
			d = c.Diffs[:min(len(c.Diffs), 50)]
		}
		dj, _ := json.Marshal(d)
		if _, err := pg.Exec(ctx, `INSERT INTO analytics.shadow_check (run_id, kind, ref, status, n_diffs, diffs) VALUES ($1,$2,$3,$4,$5,$6)`,
			r.sum.RunID, c.Kind, c.Ref, c.Status, len(c.Diffs), string(dj)); err != nil {
			return r.sum, err
		}
	}
	return r.sum, nil
}

// 1. mirror: the verified loader (row counts + checksums for every table)
func (r *runner) mirror() {
	reps, err := loader.Load(r.ctx, r.pg, r.dir)
	if err != nil {
		r.add("mirror", "load", "error", []string{err.Error()})
		return
	}
	var d []string
	for _, x := range reps {
		if !x.OK {
			d = append(d, fmt.Sprintf("%s: src %d dst %d %s", x.Table, x.SrcRows, x.DstRows, x.Note))
		}
	}
	r.add("mirror", fmt.Sprintf("%d tables", len(reps)), "ok", d)
}

// 2. pull traces recorded by the Node pull since the last pass
func (r *runner) pulls() {
	db, err := loader.OpenSQLite(r.dir, "lumpad.db")
	if err != nil {
		r.add("pull", "open", "error", []string{err.Error()})
		return
	}
	defer db.Close()
	last := r.state("pull_trace_id")
	if last == "" {
		last = "0"
	}
	rows, err := db.QueryContext(r.ctx, `SELECT id, body FROM pull_trace WHERE id > ? ORDER BY id`, last)
	if err != nil {
		return // no trace table yet (no pull since the instrumented Node deploy)
	}
	defer rows.Close()
	maxID := last
	for rows.Next() {
		var id string
		var body []byte
		if err := rows.Scan(&id, &body); err != nil {
			r.add("pull", "scan", "error", []string{err.Error()})
			return
		}
		maxID = id
		var t coros.Trace
		raw, err := gunzip(body)
		if err == nil {
			err = json.Unmarshal(raw, &t)
		}
		if err != nil {
			r.add("pull", id, "error", []string{err.Error()})
			continue
		}
		r.add("pull", fmt.Sprintf("%s %s..%s %s", id, t.From, t.To, t.Trigger), "ok", coros.Replay(&t))
	}
	r.setState("pull_trace_id", maxID)
}

// 3. FIT sessions Node (re)processed since the last pass: recompute in Go from the same FIT file and diff metrics + per-km rows.
// Once per WIB day the pass covers EVERY session, not only the changed ones: a change to the Node or Go engine then cannot slip through unseen
// just because the other side did not happen to reprocess a file that day.
func (r *runner) fit() {
	pointer := r.state("fit_processed_at")
	since, today := pointer, time.Now().In(time.FixedZone("WIB", 7*3600)).Format("2006-01-02")
	full := r.state("fit_full_day") != today
	if full {
		since = ""
	}
	rows, err := r.pg.Query(r.ctx, `SELECT s.label_id, s.processed_at, s.metrics, s.km, f.path FROM train.session_metric s JOIN raw.fit_file f ON f.label_id = s.label_id
		WHERE s.processed_at > $1 ORDER BY s.processed_at`, since)
	if err != nil {
		r.add("fit", "query", "error", []string{err.Error()})
		return
	}
	type job struct{ label, at, metrics, km, path string }
	var jobs []job
	for rows.Next() {
		var j job
		if err := rows.Scan(&j.label, &j.at, &j.metrics, &j.km, &j.path); err != nil {
			rows.Close()
			r.add("fit", "scan", "error", []string{err.Error()})
			return
		}
		jobs = append(jobs, j)
	}
	rows.Close()
	maxAt := pointer
	for _, j := range jobs {
		maxAt = max(maxAt, j.at)
		S, err := engine.ReadFIT(filepath.Join(r.dir, j.path))
		if err != nil {
			r.add("fit", j.label, "error", []string{err.Error()})
			continue
		}
		res := engine.SessionMetrics(S, engine.DefaultBaseline)
		var wantM, wantK any
		_ = json.Unmarshal([]byte(j.metrics), &wantM)
		_ = json.Unmarshal([]byte(j.km), &wantK)
		var d []string
		jsondiff.Diff("metrics", jsondiff.Roundtrip(res.Metrics), wantM, 1e-9, &d)
		jsondiff.Diff("km", jsondiff.Roundtrip(engine.KmRows(res.Km)), wantK, 1e-9, &d)
		r.add("fit", j.label, "ok", d)
	}
	r.setState("fit_processed_at", maxAt)
	if full {
		r.setState("fit_full_day", today)
	}
}

// 4. twin + correlation edges of each Node intel job that finished since the last pass. When synced data or the morning check-in changed
// after the job started, Node's output is older than the data and the comparison is marked stale instead of failed.
func (r *runner) intel() {
	last := r.state("intel_job_id")
	if last == "" {
		last = "0"
	}
	var id int64
	var kind, started string
	err := r.pg.QueryRow(r.ctx, `SELECT id, kind, started_at FROM analytics.intel_job WHERE status='done' AND id > $1::bigint ORDER BY id DESC LIMIT 1`, last).Scan(&id, &kind, &started)
	if err != nil {
		return // nothing new
	}
	r.setState("intel_job_id", fmt.Sprint(id))
	ref := fmt.Sprintf("job %d (%s)", id, kind)
	var changed string
	_ = r.pg.QueryRow(r.ctx, `SELECT GREATEST((SELECT MAX(received_at) FROM raw.sync_run), (SELECT MAX(updated_at) FROM app.kv WHERE key LIKE 'lumpad.daily.%' OR key IN ('lumpad.settings','lumpad.results')))`).Scan(&changed)
	if changed > started {
		r.add("twin", ref, "stale", []string{"data changed after the job started: " + changed})
		return
	}
	// twin: the job's date (WIB); saveTwin keeps the previous version when only as_of would change, so as_of is not compared
	t0, _ := time.Parse(time.RFC3339Nano, started)
	asOf := t0.Add(7 * time.Hour).Format("2006-01-02")
	var state string
	if err := r.pg.QueryRow(r.ctx, `SELECT state FROM athlete.state_snapshot ORDER BY version DESC LIMIT 1`).Scan(&state); err != nil {
		r.add("twin", ref, "error", []string{err.Error()})
	} else if got, err := analytics.BuildTwin(r.ctx, r.pg, asOf); err != nil {
		r.add("twin", ref, "error", []string{err.Error()})
	} else {
		var want map[string]any
		_ = json.Unmarshal([]byte(state), &want)
		g := jsondiff.Roundtrip(got).(map[string]any)
		delete(g, "as_of")
		delete(want, "as_of")
		var d []string
		jsondiff.Diff("twin", g, want, 1e-9, &d)
		r.add("twin", ref, "ok", d)
	}
	if kind != "full" {
		return
	}
	ds, err := analytics.SessionDataset(r.ctx, r.pg)
	if err != nil {
		r.add("corr", ref, "error", []string{err.Error()})
		return
	}
	got := []map[string]any{}
	for _, e := range analytics.ComputeEdges(ds, 300, 7, 0).Edges {
		if e.Status != "none" {
			got = append(got, edgeKey(e.Exposure, e.Outcome, e.LagLo, e.LagHi, e.Status, e.PartialRho, e.Q))
		}
	}
	want := []map[string]any{}
	rows, err := r.pg.Query(r.ctx, `SELECT exposure, outcome, lag_lo, lag_hi, status, partial_rho, q FROM analytics.corr_edge WHERE status IN ('supported','candidate') ORDER BY exposure, outcome, lag_lo`)
	if err == nil {
		for rows.Next() {
			var ex, out, st string
			var lo, hi int
			var pr, q *float64
			if rows.Scan(&ex, &out, &lo, &hi, &st, &pr, &q) == nil {
				want = append(want, edgeKey(ex, out, lo, hi, st, pr, q))
			}
		}
		rows.Close()
	}
	var d []string
	jsondiff.Diff("edges", jsondiff.Roundtrip(sortEdges(got)), jsondiff.Roundtrip(sortEdges(want)), 1e-9, &d)
	r.add("corr", ref, "ok", d)
}

func edgeKey(ex, out string, lo, hi int, st string, pr, q any) map[string]any {
	return map[string]any{"exposure": ex, "outcome": out, "lag_lo": lo, "lag_hi": hi, "status": st, "partial_rho": pr, "q": q}
}
func sortEdges(e []map[string]any) []map[string]any {
	k := func(m map[string]any) string {
		return fmt.Sprint(m["exposure"], "|", m["outcome"], "|", m["lag_lo"], "|", m["lag_hi"])
	}
	for i := 1; i < len(e); i++ {
		for j := i; j > 0 && k(e[j]) < k(e[j-1]); j-- {
			e[j], e[j-1] = e[j-1], e[j]
		}
	}
	return e
}

func gunzip(b []byte) ([]byte, error) {
	r, err := gzip.NewReader(bytes.NewReader(b))
	if err != nil {
		return nil, err
	}
	return io.ReadAll(r)
}
