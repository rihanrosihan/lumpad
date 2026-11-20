// lumpadd: the redesigned Lumpad backend. Phase 1 provides: migrate, load (SQLite → Postgres with verification), serve (health only).
package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"runtime"
	"strings"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rihanrosihan/lumpad/lumpadd/internal/coach"
	"github.com/rihanrosihan/lumpad/lumpadd/internal/db"
	"github.com/rihanrosihan/lumpad/lumpadd/internal/decision"
	"github.com/rihanrosihan/lumpad/lumpadd/internal/graph"
	"github.com/rihanrosihan/lumpad/lumpadd/internal/loader"
	"github.com/rihanrosihan/lumpad/lumpadd/internal/shadow"
)

var version = "0.3.0-auradb-rag"

func rssKB() int {
	b, err := os.ReadFile("/proc/self/status")
	if err != nil {
		return 0
	}
	for _, l := range strings.Split(string(b), "\n") {
		if strings.HasPrefix(l, "VmRSS:") {
			var kb int
			fmt.Sscanf(strings.TrimSpace(strings.TrimPrefix(l, "VmRSS:")), "%d", &kb)
			return kb
		}
	}
	return 0
}

func main() {
	if len(os.Args) < 2 {
		fmt.Fprintln(os.Stderr, "usage: lumpadd migrate | load <data dir> | serve   (DATABASE_URL required)")
		os.Exit(2)
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	url := os.Getenv("DATABASE_URL")
	if url == "" {
		fmt.Fprintln(os.Stderr, "DATABASE_URL is not set")
		os.Exit(2)
	}
	pool, err := db.Connect(ctx, url)
	if err != nil {
		fmt.Fprintln(os.Stderr, "connect:", err)
		os.Exit(1)
	}
	defer pool.Close()
	switch os.Args[1] {
	case "migrate":
		r, err := db.Migrate(ctx, pool)
		must(err)
		fmt.Printf("applied %d, already done %d, skipped %d\n", len(r.Applied), len(r.AlreadyDone), len(r.Skipped))
		for _, s := range r.Skipped {
			fmt.Println("  skipped:", s)
		}
	case "load":
		fs := flag.NewFlagSet("load", flag.ExitOnError)
		_ = fs.Parse(os.Args[2:])
		if fs.NArg() != 1 {
			fmt.Fprintln(os.Stderr, "usage: lumpadd load <server/data dir>")
			os.Exit(2)
		}
		reps, err := loader.Load(ctx, pool, fs.Arg(0))
		bad := 0
		for _, r := range reps {
			mark := "ok  "
			if !r.OK {
				mark, bad = "FAIL", bad+1
			}
			fmt.Printf("%s %-26s src %6d  dst %6d  %s %s\n", mark, r.Table, r.SrcRows, r.DstRows, short(r.SrcSum), r.Note)
		}
		must(err)
		if bad > 0 {
			fmt.Printf("%d table(s) failed verification\n", bad)
			os.Exit(1)
		}
		fmt.Printf("all %d tables verified (row counts and checksums identical)\n", len(reps))
	case "shadow":
		if len(os.Args) != 3 {
			fmt.Fprintln(os.Stderr, "usage: lumpadd shadow <server/data dir>")
			os.Exit(2)
		}
		sum, err := shadow.Run(ctx, pool, os.Args[2])
		if errors.Is(err, shadow.ErrBusy) {
			fmt.Println("skipped:", err) // not a failure: the other pass will record its own results
			return
		}
		must(err)
		bad := 0
		for kind, st := range sum.Counts() {
			fmt.Printf("%-7s %v\n", kind, st)
			bad += st["diff"] + st["error"]
		}
		for _, c := range sum.Checks {
			if c.Status == "diff" || c.Status == "error" {
				fmt.Printf("  %s %s %s: %d difference(s), first: %.300s\n", c.Kind, c.Ref, c.Status, len(c.Diffs), first(c.Diffs))
			}
		}
		fmt.Printf("shadow run %d: %d check(s), %d not identical\n", sum.RunID, len(sum.Checks), bad)
		if bad > 0 {
			os.Exit(1)
		}
	case "g3":
		days, streak, err := shadow.G3(ctx, pool)
		must(err)
		for _, d := range days {
			fmt.Printf("%s  %-4s  checks %3d  pulls %d  not identical %d  stale %d\n", d.Day, map[bool]string{true: "ok", false: "FAIL"}[d.OK], d.Checks, d.Pulls, d.Bad, d.Stale)
		}
		fmt.Printf("gate G3: %d consecutive identical day(s) with a replayed pull (needs 14) — %s\n", streak, map[bool]string{true: "PASS", false: "not yet"}[streak >= 14])
	case "retrieve":
		intent := "daily_brief"
		q := ""
		if len(os.Args) >= 3 {
			intent = os.Args[2]
		}
		if len(os.Args) >= 4 {
			q = strings.Join(os.Args[3:], " ")
		}
		aura, _ := graph.NewFromEnv()
		ret := &coach.PGRetriever{Pool: pool, Graph: aura}
		res, err := ret.Retrieve(ctx, coach.RunInput{Intent: intent, Question: q})
		must(err)
		fmt.Printf("retrieve %s (graph=%v): %d rules, %d items, ~%d tokens\n", intent, aura != nil, len(res.Ctx.Rules), len(res.ItemIDs), res.TokensEst)
	case "graph-sync":
		aura, err := graph.NewFromEnv()
		must(err)
		if aura == nil {
			fmt.Fprintln(os.Stderr, "NEO4J_URI is not set in environment")
			os.Exit(2)
		}
		must(aura.Ping(ctx))
		st, err := graph.SyncAll(ctx, pool, aura, coach.Redact)
		must(err)
		ov, err := graph.Overview(ctx, aura)
		must(err)
		b, _ := json.MarshalIndent(map[string]any{"synced": st, "overview": ov}, "", "  ")
		fmt.Println(string(b))
	case "sub4":
		rep, err := buildSub4Report(ctx, pool)
		must(err)
		b, _ := json.MarshalIndent(rep, "", "  ")
		fmt.Println(string(b))
	case "serve":
		serve(ctx, pool)
	default:
		fmt.Fprintln(os.Stderr, "unknown command", os.Args[1])
		os.Exit(2)
	}
}
func first(d []string) string {
	if len(d) == 0 {
		return ""
	}
	return d[0]
}
func short(s string) string {
	if len(s) > 12 {
		return s[:12]
	}
	return s
}
func must(err error) {
	if err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		os.Exit(1)
	}
}

func serve(ctx context.Context, pool *pgxpool.Pool) {
	addr := os.Getenv("LUMPADD_ADDR")
	if addr == "" {
		addr = "127.0.0.1:8788" // beside the current Node app on :8787
	}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/v2/health", func(w http.ResponseWriter, r *http.Request) {
		c, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()
		var one int
		dbOK := pool.QueryRow(c, `SELECT 1`).Scan(&one) == nil
		var ms runtime.MemStats
		runtime.ReadMemStats(&ms)
		w.Header().Set("content-type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": dbOK, "version": version, "rss_kb": rssKB(), "heap_kb": ms.HeapAlloc / 1024, "go": runtime.Version()})
	})
	mux.HandleFunc("GET /api/v2/decisions", func(w http.ResponseWriter, r *http.Request) {
		list, err := decision.ListDecisions(r.Context(), pool, 50)
		w.Header().Set("content-type", "application/json")
		if err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			_ = json.NewEncoder(w).Encode(map[string]any{"error": publicErr(err)})
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"decisions": list})
	})
	mux.HandleFunc("GET /api/v2/adherence", func(w http.ResponseWriter, r *http.Request) {
		list, err := decision.ListAdherence(r.Context(), pool, 50)
		w.Header().Set("content-type", "application/json")
		if err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			_ = json.NewEncoder(w).Encode(map[string]any{"error": publicErr(err)})
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"adherence": list})
	})
	mux.HandleFunc("POST /api/v2/coach/retrieve", func(w http.ResponseWriter, r *http.Request) {
		var in coach.RunInput
		_ = json.NewDecoder(r.Body).Decode(&in)
		aura, _ := graph.NewFromEnv()
		ret := &coach.PGRetriever{Pool: pool, Graph: aura}
		res, err := ret.Retrieve(r.Context(), in)
		w.Header().Set("content-type", "application/json")
		if err != nil {
			w.WriteHeader(http.StatusBadRequest)
			_ = json.NewEncoder(w).Encode(map[string]any{"error": publicErr(err)})
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"item_ids": res.ItemIDs, "tokens_est": res.TokensEst, "rules": len(res.Ctx.Rules), "volatile": res.Ctx.Volatile})
	})
	mux.HandleFunc("GET /api/v2/graph/overview", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("content-type", "application/json")
		aura, err := graph.NewFromEnv()
		if err != nil || aura == nil {
			_ = json.NewEncoder(w).Encode(map[string]any{"configured": false})
			return
		}
		ov, err := graph.Overview(r.Context(), aura)
		if err != nil {
			w.WriteHeader(http.StatusBadGateway)
			_ = json.NewEncoder(w).Encode(map[string]any{"configured": true, "error": publicErr(err)})
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"configured": true, "overview": ov})
	})
	mux.HandleFunc("GET /api/v2/sub4", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("content-type", "application/json")
		rep, err := buildSub4Report(r.Context(), pool)
		if err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			_ = json.NewEncoder(w).Encode(map[string]any{"error": publicErr(err)})
			return
		}
		_ = json.NewEncoder(w).Encode(rep)
	})
	srv := &http.Server{Addr: addr, Handler: guard(mux), ReadHeaderTimeout: 5 * time.Second}
	go func() {
		<-ctx.Done()
		sc, c := context.WithTimeout(context.Background(), 5*time.Second)
		defer c()
		_ = srv.Shutdown(sc)
	}()
	fmt.Println("lumpadd", version, "listening on", addr)
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		must(err)
	}
}

func buildSub4Report(ctx context.Context, pool *pgxpool.Pool) (map[string]any, error) {
	var stateStr string
	var ver int64
	_ = pool.QueryRow(ctx, `SELECT version, state FROM athlete.state_snapshot ORDER BY version DESC LIMIT 1`).Scan(&ver, &stateStr)
	vdot := 31.7
	runShare20 := 0.28
	if stateStr != "" {
		var tw map[string]any
		if json.Unmarshal([]byte(stateStr), &tw) == nil {
			if prof, ok := tw["profile"].(map[string]any); ok {
				if v, ok := prof["vdot"].(float64); ok && v > 20 {
					vdot = v
				}
			}
		}
	}
	jakim := decision.RaceReadinessRange(decision.RaceInput{
		RaceName: "Jakim FM 2027 (B-Race)", VDOT: vdot, RunShareAfter20K: runShare20,
		ForecastWBGT: 27.5, RealizationRatio: 0.59, LongRunsOver20K: 3, FMCount: 1,
	})
	jrfCurrent := decision.RaceReadinessRange(decision.RaceInput{
		RaceName: "myBCA JRF 2027 (Current Fitness)", VDOT: vdot, RunShareAfter20K: runShare20,
		ForecastWBGT: 26.5, RealizationRatio: 0.75, LongRunsOver20K: 3, FMCount: 1,
	})
	jrfTarget := decision.RaceReadinessRange(decision.RaceInput{
		RaceName: "myBCA JRF 2027 (Sub-4 Target State)", VDOT: 39.9, RunShareAfter20K: 0.92,
		ForecastWBGT: 26.5, RealizationRatio: 0.95, LongRunsOver20K: 10, FMCount: 3,
	})
	out := map[string]any{
		"twin_version": ver,
		"vdot_current": vdot,
		"vdot_needed":  39.9,
		"vdot_gap":     39.9 - vdot,
		"ranges":       []decision.RaceRange{jakim, jrfCurrent, jrfTarget},
	}
	if aura, err := graph.NewFromEnv(); err == nil && aura != nil {
		if ov, err := graph.Overview(ctx, aura); err == nil {
			out["auradb"] = ov
		}
	}
	return out, nil
}

// guard: browsers attach Basic-auth credentials to cross-site requests, so state-changing calls must carry the same custom header the Node app
// requires (a cross-site form or image cannot add it), and request bodies are capped so a stray client cannot make the server read without limit.
func guard(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead && r.Header.Get("X-Lumpad") != "1" {
			w.Header().Set("content-type", "application/json")
			w.WriteHeader(http.StatusForbidden)
			_, _ = w.Write([]byte(`{"error":"missing X-Lumpad header"}`))
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, 64<<10)
		next.ServeHTTP(w, r)
	})
}

// publicErr logs the real error on the server and returns a generic message: database and upstream error text can contain hosts, queries and paths.
func publicErr(err error) string {
	fmt.Fprintln(os.Stderr, "lumpadd:", err)
	return "internal error (see server log)"
}
