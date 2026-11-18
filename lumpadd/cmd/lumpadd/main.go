// lumpadd: the redesigned Lumpad backend. Phase 1 provides: migrate, load (SQLite → Postgres with verification), serve (health only).
package main

import (
	"context"
	"encoding/json"
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
	"github.com/rihanrosihan/lumpad/lumpadd/internal/db"
	"github.com/rihanrosihan/lumpad/lumpadd/internal/loader"
)

var version = "0.1.0-phase1"

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
	case "serve":
		serve(ctx, pool)
	default:
		fmt.Fprintln(os.Stderr, "unknown command", os.Args[1])
		os.Exit(2)
	}
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
	srv := &http.Server{Addr: addr, Handler: mux, ReadHeaderTimeout: 5 * time.Second}
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
