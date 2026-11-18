package loader

import (
	"context"
	"database/sql"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/rihanrosihan/lumpad/lumpadd/internal/db"
)

func TestCanonIsIdenticalForSQLiteAndPostgresValues(t *testing.T) {
	a, b := 0.1, 0.2
	d := time.Date(2026, 11, 15, 0, 0, 0, 0, time.UTC)
	cases := []struct {
		kind string
		a, b any
	}{{"date", "2026-11-15", d}, {"float", 0.789, 0.789}, {"int", int64(5), int64(5)}, {"text", "abc", "abc"}, {"blob", []byte("x"), []byte("x")}, {"text", nil, nil}}
	for _, c := range cases {
		if canon(c.kind, c.a) != canon(c.kind, c.b) {
			t.Errorf("%s: %v vs %v", c.kind, canon(c.kind, c.a), canon(c.kind, c.b))
		}
	}
	if canon("float", 1.0) != "1" || canon("float", a+b) == canon("float", 0.3) {
		t.Errorf("float canonical form must be exact round-trip text")
	}
}

func TestEveryGeneratedTableHasPrimaryKeyAndColumns(t *testing.T) {
	for _, tb := range Tables {
		if len(tb.Cols) == 0 || len(tb.PK) == 0 {
			t.Errorf("%s: cols=%d pk=%d", tb.Dst, len(tb.Cols), len(tb.PK))
		}
	}
}

// Integration: needs TEST_DATABASE_URL (an empty scratch database). Builds tiny SQLite files, loads, verifies, then corrupts one row and expects a failure.
func TestLoadVerifiesAndDetectsCorruption(t *testing.T) {
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL not set")
	}
	ctx := context.Background()
	pool, err := db.Connect(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	for _, s := range []string{"raw", "train", "health", "athlete", "plan", "coach", "memory", "analytics", "app"} {
		_, _ = pool.Exec(ctx, "DROP SCHEMA IF EXISTS "+s+" CASCADE")
	}
	_, _ = pool.Exec(ctx, "DROP TABLE IF EXISTS public.schema_migrations")
	if _, err := db.Migrate(ctx, pool); err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	lite, err := sql.Open("sqlite", filepath.Join(dir, "lumpad.db"))
	if err != nil {
		t.Fatal(err)
	}
	mk := func(dst string) {
		var tb Table
		for _, x := range Tables {
			if x.Dst == dst {
				tb = x
			}
		}
		ty := map[string]string{"text": "TEXT", "date": "TEXT", "int": "INTEGER", "float": "REAL", "blob": "BLOB"}
		var cols []string
		for _, c := range tb.Cols {
			cols = append(cols, c.Name+" "+ty[c.Kind])
		}
		if _, err := lite.Exec("CREATE TABLE " + tb.SrcTable + " (" + strings.Join(cols, ",") + ", PRIMARY KEY (" + strings.Join(tb.PK, ",") + "))"); err != nil {
			t.Fatal(err)
		}
	}
	mk("train.gear")
	mk("health.daily")
	for _, q := range []string{
		`INSERT INTO gear (id, name, brand, model, distance_m, retired, pulled_at) VALUES ('g1','Mach X2','HOKA','Mach X2',425123.5,0,'2026-11-18T00:00:00Z'),('g2','Clifton 10','HOKA',NULL,313000,1,NULL)`,
		`INSERT INTO health_daily (date, hrv_avg, hrv_status, resting_hr, source, pulled_at) VALUES ('2026-11-17', 87.0, 'Normal', 53, 'coros', 'x')`,
	} {
		if _, err := lite.Exec(q); err != nil {
			t.Fatal(err)
		}
	}
	lite.Close()
	reps, err := Load(ctx, pool, dir)
	if err != nil {
		t.Fatal(err)
	}
	got := map[string]Report{}
	for _, r := range reps {
		got[r.Table] = r
	}
	if g := got["train.gear"]; !g.OK || g.SrcRows != 2 || g.DstRows != 2 {
		t.Fatalf("gear not verified: %+v", g)
	}
	if h := got["health.daily"]; !h.OK || h.DstRows != 1 {
		t.Fatalf("health not verified: %+v", h)
	}
	// corrupt one value in Postgres: the verifier must notice
	if _, err := pool.Exec(ctx, `UPDATE train.gear SET distance_m = distance_m + 0.001 WHERE id='g1'`); err != nil {
		t.Fatal(err)
	}
	n, sum, err := destSum(ctx, pool, gearTable())
	if err != nil || n != 2 || sum == got["train.gear"].SrcSum {
		t.Fatalf("corruption not detected: n=%d same=%v err=%v", n, sum == got["train.gear"].SrcSum, err)
	}
}

func gearTable() Table {
	for _, t := range Tables {
		if t.Dst == "train.gear" {
			return t
		}
	}
	panic("train.gear not in Tables")
}
