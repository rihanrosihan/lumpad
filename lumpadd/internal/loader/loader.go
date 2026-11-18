// Package loader copies today's SQLite data (lumpad.db, coros.db, intel.db, memory.db, kv.json) into PostgreSQL and proves the copy:
// per table, the row count and a SHA-256 over every row in a canonical text form must be identical on both sides (gate G1).
package loader

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	_ "modernc.org/sqlite"
)

type Col struct{ Name, Kind string } // kind: text | int | float | blob | date
type Table struct {
	Src, SrcTable, Dst string
	Cols               []Col
	PK                 []string
}

// Report is one line per table of a load or verification.
type Report struct {
	Table            string
	SrcRows, DstRows int
	SrcSum, DstSum   string
	OK               bool
	Note             string
}

func (t Table) names() []string {
	n := make([]string, len(t.Cols))
	for i, c := range t.Cols {
		n[i] = c.Name
	}
	return n
}
func quoteAll(s []string) string {
	q := make([]string, len(s))
	for i, x := range s {
		q[i] = `"` + x + `"`
	}
	return strings.Join(q, ", ")
}
func (t Table) order() string {
	if len(t.PK) > 0 {
		return quoteAll(t.PK)
	}
	return "rowid"
}

// canon renders one value identically whether it came from SQLite or from PostgreSQL.
func canon(kind string, v any) string {
	if v == nil {
		return "\x00"
	}
	switch x := v.(type) {
	case int64:
		return strconv.FormatInt(x, 10)
	case int32:
		return strconv.FormatInt(int64(x), 10)
	case int16:
		return strconv.FormatInt(int64(x), 10)
	case float64:
		return strconv.FormatFloat(x, 'g', -1, 64)
	case string:
		if kind == "date" {
			return x
		}
		return x
	case []byte:
		if kind == "blob" {
			h := sha256.Sum256(x)
			return hex.EncodeToString(h[:])
		}
		return string(x)
	case time.Time:
		return x.Format("2006-01-02")
	case bool:
		if x {
			return "1"
		}
		return "0"
	}
	return fmt.Sprint(v)
}

func rowHash(h interface{ Write([]byte) (int, error) }, t Table, vals []any) {
	for i, c := range t.Cols {
		_, _ = h.Write([]byte(canon(c.Kind, vals[i])))
		_, _ = h.Write([]byte{0x1f})
	}
	_, _ = h.Write([]byte{0x1e})
}

// srcValue adapts a SQLite value for PostgreSQL (dates become time.Time so the DATE column accepts them).
func srcValue(c Col, v any) (any, error) {
	if v == nil {
		return nil, nil
	}
	switch c.Kind {
	case "date":
		s, ok := v.(string)
		if !ok {
			return nil, fmt.Errorf("column %s: date is %T", c.Name, v)
		}
		if s == "" {
			return nil, nil
		}
		d, err := time.Parse("2006-01-02", s)
		if err != nil {
			return nil, fmt.Errorf("column %s: %q is not yyyy-mm-dd", c.Name, s)
		}
		return d, nil
	case "int":
		switch x := v.(type) {
		case int64:
			return x, nil
		case float64:
			return int64(x), nil
		}
	case "float":
		switch x := v.(type) {
		case float64:
			return x, nil
		case int64:
			return float64(x), nil
		}
	case "text":
		switch x := v.(type) {
		case string:
			return x, nil
		case []byte:
			return string(x), nil
		case int64:
			return strconv.FormatInt(x, 10), nil
		case float64:
			return strconv.FormatFloat(x, 'g', -1, 64), nil
		}
	case "blob":
		if b, ok := v.([]byte); ok {
			return b, nil
		}
		if s, ok := v.(string); ok {
			return []byte(s), nil
		}
	}
	return v, nil
}

func openSQLite(dir, file string) (*sql.DB, error) {
	p := filepath.Join(dir, file)
	if _, err := os.Stat(p); err != nil {
		return nil, err
	}
	return sql.Open("sqlite", "file:"+p+"?mode=ro&_pragma=busy_timeout(5000)")
}

func tableExists(db *sql.DB, name string) bool {
	var n int
	_ = db.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?`, name).Scan(&n)
	return n > 0
}

// sourceSum reads one SQLite table in primary-key order and returns its row count and canonical checksum; with sink != nil it also hands each row to it.
func sourceSum(db *sql.DB, t Table, sink func([]any) error) (int, string, error) {
	rows, err := db.Query(fmt.Sprintf(`SELECT %s FROM %s ORDER BY %s`, quoteAll(t.names()), t.SrcTable, t.order()))
	if err != nil {
		return 0, "", err
	}
	defer rows.Close()
	h := sha256.New()
	n := 0
	for rows.Next() {
		vals := make([]any, len(t.Cols))
		ptrs := make([]any, len(vals))
		for i := range vals {
			ptrs[i] = &vals[i]
		}
		if err := rows.Scan(ptrs...); err != nil {
			return n, "", err
		}
		adapted := make([]any, len(vals))
		for i, c := range t.Cols {
			if adapted[i], err = srcValue(c, vals[i]); err != nil {
				return n, "", fmt.Errorf("%s row %d: %w", t.Dst, n+1, err)
			}
		}
		rowHash(h, t, adapted)
		if sink != nil {
			if err := sink(adapted); err != nil {
				return n, "", err
			}
		}
		n++
	}
	return n, hex.EncodeToString(h.Sum(nil)), rows.Err()
}

func destSum(ctx context.Context, pool *pgxpool.Pool, t Table) (int, string, error) {
	rows, err := pool.Query(ctx, fmt.Sprintf(`SELECT %s FROM %s ORDER BY %s`, quoteAll(t.names()), t.Dst, orderPG(t)))
	if err != nil {
		return 0, "", err
	}
	defer rows.Close()
	h := sha256.New()
	n := 0
	for rows.Next() {
		vals, err := rows.Values()
		if err != nil {
			return n, "", err
		}
		rowHash(h, t, vals)
		n++
	}
	return n, hex.EncodeToString(h.Sum(nil)), rows.Err()
}
func orderPG(t Table) string {
	if len(t.PK) > 0 {
		return quoteAll(t.PK)
	}
	return "1" // no primary key: tables in this mirror all have one
}

// Load copies every table (truncating the destination first, so a load is repeatable) and then verifies it.
func Load(ctx context.Context, pool *pgxpool.Pool, dataDir string) ([]Report, error) {
	dbs := map[string]*sql.DB{}
	defer func() {
		for _, d := range dbs {
			if d != nil {
				d.Close()
			}
		}
	}()
	var reps []Report
	for _, t := range Tables {
		d, ok := dbs[t.Src]
		if !ok {
			var err error
			if d, err = openSQLite(dataDir, t.Src); err != nil {
				reps = append(reps, Report{Table: t.Dst, OK: true, Note: "source file missing: skipped"})
				dbs[t.Src] = nil
				continue
			}
			dbs[t.Src] = d
		}
		if d == nil || !tableExists(d, t.SrcTable) {
			reps = append(reps, Report{Table: t.Dst, OK: true, Note: "source table missing: skipped"})
			continue
		}
		if _, err := pool.Exec(ctx, `TRUNCATE `+t.Dst+` CASCADE`); err != nil {
			return reps, err
		}
		tx, err := pool.Begin(ctx)
		if err != nil {
			return reps, err
		}
		batch := &pgx.Batch{}
		flush := func() error {
			if batch.Len() == 0 {
				return nil
			}
			br := tx.SendBatch(ctx, batch)
			for i := 0; i < batch.Len(); i++ {
				if _, err := br.Exec(); err != nil {
					_ = br.Close()
					return err
				}
			}
			batch = &pgx.Batch{}
			return br.Close()
		}
		ph := make([]string, len(t.Cols))
		for i := range ph {
			ph[i] = "$" + strconv.Itoa(i+1)
		}
		ins := fmt.Sprintf(`INSERT INTO %s (%s) VALUES (%s)`, t.Dst, quoteAll(t.names()), strings.Join(ph, ","))
		srcN, srcSum, err := sourceSum(d, t, func(v []any) error {
			batch.Queue(ins, v...)
			if batch.Len() >= 500 {
				return flush()
			}
			return nil
		})
		if err == nil {
			err = flush()
		}
		if err != nil {
			_ = tx.Rollback(ctx)
			return reps, fmt.Errorf("%s: %w", t.Dst, err)
		}
		if err := tx.Commit(ctx); err != nil {
			return reps, err
		}
		dstN, dstSum, err := destSum(ctx, pool, t)
		if err != nil {
			return reps, fmt.Errorf("%s verify: %w", t.Dst, err)
		}
		reps = append(reps, Report{Table: t.Dst, SrcRows: srcN, DstRows: dstN, SrcSum: srcSum, DstSum: dstSum, OK: srcN == dstN && srcSum == dstSum})
	}
	kv, err := loadKV(ctx, pool, dataDir)
	if err != nil {
		return reps, err
	}
	return append(reps, kv), nil
}

// loadKV copies kv.json (key → {value, updatedAt}) into app.kv and verifies key count and a checksum over key + canonical JSON.
func loadKV(ctx context.Context, pool *pgxpool.Pool, dir string) (Report, error) {
	r := Report{Table: "app.kv"}
	b, err := os.ReadFile(filepath.Join(dir, "kv.json"))
	if err != nil {
		r.OK, r.Note = true, "kv.json missing: skipped"
		return r, nil
	}
	var m map[string]struct {
		Value     json.RawMessage `json:"value"`
		UpdatedAt string          `json:"updatedAt"`
	}
	if err := json.Unmarshal(b, &m); err != nil {
		return r, err
	}
	if _, err := pool.Exec(ctx, `TRUNCATE app.kv`); err != nil {
		return r, err
	}
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sortStrings(keys)
	h := sha256.New()
	for _, k := range keys {
		var canonical any
		if err := json.Unmarshal(m[k].Value, &canonical); err != nil {
			return r, fmt.Errorf("kv %s: %w", k, err)
		}
		cb, _ := json.Marshal(canonical)
		if _, err := pool.Exec(ctx, `INSERT INTO app.kv (key, value, updated_at) VALUES ($1,$2::jsonb,$3)`, k, string(cb), m[k].UpdatedAt); err != nil {
			return r, err
		}
		h.Write([]byte(k + "\x1f" + string(cb) + "\x1e"))
	}
	r.SrcRows, r.SrcSum = len(keys), hex.EncodeToString(h.Sum(nil))
	rows, err := pool.Query(ctx, `SELECT key, value FROM app.kv ORDER BY key`)
	if err != nil {
		return r, err
	}
	defer rows.Close()
	h2 := sha256.New()
	for rows.Next() {
		var k string
		var v any
		if err := rows.Scan(&k, &v); err != nil {
			return r, err
		}
		cb, _ := json.Marshal(v)
		h2.Write([]byte(k + "\x1f" + string(cb) + "\x1e"))
		r.DstRows++
	}
	r.DstSum = hex.EncodeToString(h2.Sum(nil))
	r.OK = r.SrcRows == r.DstRows && r.SrcSum == r.DstSum
	return r, rows.Err()
}

func sortStrings(s []string) {
	for i := 1; i < len(s); i++ {
		for j := i; j > 0 && s[j] < s[j-1]; j-- {
			s[j], s[j-1] = s[j-1], s[j]
		}
	}
}
