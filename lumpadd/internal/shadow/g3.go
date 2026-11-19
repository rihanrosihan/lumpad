package shadow

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
)

type Day struct {
	Day                       string
	Checks, Pulls, Bad, Stale int
	OK                        bool
}

// G3 lists the last 30 days (WIB) and the current streak: a day counts when every check was identical (stale is allowed) and at least one
// real Node pull was replayed. Any day without a shadow run breaks the streak.
func G3(ctx context.Context, pg *pgxpool.Pool) ([]Day, int, error) {
	rows, err := pg.Query(ctx, `
		WITH d AS (SELECT generate_series((now() AT TIME ZONE 'Asia/Jakarta')::date - 29, (now() AT TIME ZONE 'Asia/Jakarta')::date, '1 day')::date AS day)
		SELECT to_char(d.day, 'YYYY-MM-DD'), COUNT(c.id), COUNT(c.id) FILTER (WHERE c.kind = 'pull' AND c.status = 'ok'),
		       COUNT(c.id) FILTER (WHERE c.status IN ('diff','error')), COUNT(c.id) FILTER (WHERE c.status = 'stale')
		FROM d LEFT JOIN analytics.shadow_check c ON (c.ran_at AT TIME ZONE 'Asia/Jakarta')::date = d.day
		GROUP BY d.day ORDER BY d.day`)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	var days []Day
	for rows.Next() {
		var d Day
		if err := rows.Scan(&d.Day, &d.Checks, &d.Pulls, &d.Bad, &d.Stale); err != nil {
			return nil, 0, err
		}
		d.OK = d.Checks > 0 && d.Pulls > 0 && d.Bad == 0
		days = append(days, d)
	}
	streak := 0
	for i := len(days) - 1; i >= 0; i-- {
		if !days[i].OK {
			if i == len(days)-1 && days[i].Checks == 0 { // today has not run yet: do not break the streak
				continue
			}
			break
		}
		streak++
	}
	return days, streak, rows.Err()
}
