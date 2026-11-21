#!/usr/bin/env bash
# Proves the backup can be restored: restores the newest snapshot to a temporary directory and checks the SQLite files and the PostgreSQL dump.
# Safe: it never writes to /opt/lumpad or to any live database.  bash /opt/lumpad/deploy/backup/restore-test.sh
set -euo pipefail
ENV=${BACKUP_ENV:-/etc/lumpad-backup.env}; RESTIC=${RESTIC_BIN:-restic}
set -a; . "$ENV"; set +a
T=$(mktemp -d /var/tmp/lumpad-restore.XXXXXX); trap 'rm -rf "$T"' EXIT
"$RESTIC" snapshots --tag lumpad --latest 1 --compact
"$RESTIC" restore latest --tag lumpad --target "$T"
n=0; bad=0
for db in $(find "$T" -name '*.db' -size +0 2>/dev/null); do n=$((n+1)); r=$(sqlite3 "$db" 'PRAGMA integrity_check' 2>&1 | head -1); [ "$r" = ok ] || { echo "BAD sqlite: $db: $r"; bad=$((bad+1)); }; done
d=$(find "$T" -name 'pg-*.dump' | sort | tail -1)
if [ -n "$d" ]; then t=$(pg_restore --list "$d" | grep -c ' TABLE DATA '); echo "postgres dump: $(basename "$d"), $t tables with data"; else echo "no postgres dump in the snapshot"; bad=$((bad+1)); fi
tar_n=$(find "$T" -name 'lumpad-*.tar.gz' | wc -l)
echo "sqlite files checked: $n, bad: $bad, local tar archives: $tar_n"
[ "$bad" = 0 ] && echo "RESTORE TEST PASSED" || { echo "RESTORE TEST FAILED" >&2; exit 1; }
