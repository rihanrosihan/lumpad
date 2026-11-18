// Package db opens the PostgreSQL pool and applies the embedded SQL migrations.
// Migrations named *.optional.sql start with "-- optional: extension <name>"; they run only when that extension is installed on the server
// and are otherwise recorded as skipped, so the same binary works on a server with and without TimescaleDB / pgvector.
package db

import (
	"context"
	"embed"
	"fmt"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed migrations/*.sql
var migrationFS embed.FS

// Connect opens a small pool: this runs on a 2 GB server next to Postgres, so connections are kept few.
func Connect(ctx context.Context, url string) (*pgxpool.Pool, error) {
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		return nil, err
	}
	if cfg.MaxConns > 8 {
		cfg.MaxConns = 8
	}
	cfg.MaxConnIdleTime = 5 * time.Minute
	return pgxpool.NewWithConfig(ctx, cfg)
}

type Migration struct {
	Version  string
	Name     string
	SQL      string
	Optional string // extension required, "" for mandatory
}

var optRe = regexp.MustCompile(`(?m)^-- optional: extension (\w+)`)

// Migrations returns the embedded migrations in version order.
func Migrations() ([]Migration, error) {
	ents, err := migrationFS.ReadDir("migrations")
	if err != nil {
		return nil, err
	}
	var out []Migration
	for _, e := range ents {
		b, err := migrationFS.ReadFile("migrations/" + e.Name())
		if err != nil {
			return nil, err
		}
		m := Migration{Version: strings.SplitN(e.Name(), "_", 2)[0], Name: e.Name(), SQL: string(b)}
		if x := optRe.FindStringSubmatch(m.SQL); x != nil {
			m.Optional = x[1]
		}
		out = append(out, m)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Version < out[j].Version })
	return out, nil
}

// Result of one Migrate call.
type Result struct{ Applied, Skipped, AlreadyDone []string }

// Migrate applies every pending migration, each in its own transaction, and records it in public.schema_migrations.
func Migrate(ctx context.Context, pool *pgxpool.Pool) (Result, error) {
	var r Result
	if _, err := pool.Exec(ctx, `CREATE TABLE IF NOT EXISTS public.schema_migrations (version TEXT PRIMARY KEY, name TEXT NOT NULL, status TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`); err != nil {
		return r, err
	}
	ms, err := Migrations()
	if err != nil {
		return r, err
	}
	for _, m := range ms {
		var status string
		err := pool.QueryRow(ctx, `SELECT status FROM public.schema_migrations WHERE version=$1`, m.Version).Scan(&status)
		if err == nil && status == "applied" {
			r.AlreadyDone = append(r.AlreadyDone, m.Name)
			continue
		}
		if m.Optional != "" {
			var ok bool
			if err := pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM pg_available_extensions WHERE name=$1)`, m.Optional).Scan(&ok); err != nil {
				return r, err
			}
			if !ok {
				if _, err := pool.Exec(ctx, `INSERT INTO public.schema_migrations (version, name, status) VALUES ($1,$2,'skipped') ON CONFLICT (version) DO UPDATE SET status='skipped'`, m.Version, m.Name); err != nil {
					return r, err
				}
				r.Skipped = append(r.Skipped, m.Name+" (extension "+m.Optional+" not installed)")
				continue
			}
		}
		tx, err := pool.Begin(ctx)
		if err != nil {
			return r, err
		}
		if _, err := tx.Exec(ctx, m.SQL); err != nil {
			_ = tx.Rollback(ctx)
			return r, fmt.Errorf("migration %s: %w", m.Name, err)
		}
		if _, err := tx.Exec(ctx, `INSERT INTO public.schema_migrations (version, name, status) VALUES ($1,$2,'applied') ON CONFLICT (version) DO UPDATE SET status='applied', applied_at=now()`, m.Version, m.Name); err != nil {
			_ = tx.Rollback(ctx)
			return r, err
		}
		if err := tx.Commit(ctx); err != nil {
			return r, err
		}
		r.Applied = append(r.Applied, m.Name)
	}
	return r, nil
}
