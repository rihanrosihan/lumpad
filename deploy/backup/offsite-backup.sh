#!/usr/bin/env bash
# Nightly off-server backup: local snapshot (deploy/backup.sh) + PostgreSQL dump -> restic -> Tencent COS (S3-compatible), encrypted client-side.
# Settings live in /etc/lumpad-backup.env (root, mode 600): RESTIC_REPOSITORY, RESTIC_PASSWORD_FILE, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY.
# Exit status is non-zero on any failed step, so systemd shows the unit as failed (systemctl --failed / journalctl -u lumpad-offsite-backup).
set -euo pipefail
ENV=${BACKUP_ENV:-/etc/lumpad-backup.env}; APP=${APP_DIR:-/opt/lumpad}; LOCAL=${LOCAL_BACKUP_DIR:-/var/backups/lumpad}; RESTIC=${RESTIC_BIN:-restic}
[ -r "$ENV" ] || { echo "backup: $ENV missing; run deploy/backup/setup-offsite.sh" >&2; exit 2; }
set -a; . "$ENV"; set +a
: "${RESTIC_REPOSITORY:?}" "${RESTIC_PASSWORD_FILE:?}"
log() { echo "$(date '+%F %T') backup: $*"; }

# 1. local snapshot of the SQLite files (consistent VACUUM INTO copies) and the FIT mirror; skipped in tests
if [ -z "${SKIP_LOCAL_SNAPSHOT:-}" ]; then log "local snapshot"; bash "$APP/deploy/backup.sh"; fi

# 2. PostgreSQL (custom format: compressed, restorable table by table). The password is in .env.v2 and never printed.
if [ -r "$APP/.env.v2" ] && command -v pg_dump >/dev/null 2>&1; then
  OUT="$LOCAL/pg-$(date +%Y%m%d-%H%M).dump"; mkdir -p "$LOCAL"; chmod 700 "$LOCAL"
  log "pg_dump"
  sudo -u lumpad bash -c "set -a; . '$APP/.env.v2'; set +a; pg_dump --format=custom --no-owner \"\$DATABASE_URL\"" > "$OUT.tmp"
  [ -s "$OUT.tmp" ] || { echo "backup: empty pg_dump" >&2; rm -f "$OUT.tmp"; exit 3; }
  mv "$OUT.tmp" "$OUT"; find "$LOCAL" -name 'pg-*.dump' -mtime +7 -delete
fi

# 3. encrypted, deduplicated upload (the repository password is NOT in this file; keep a copy in your own password manager)
PATHS=("$LOCAL"); for f in "$APP/.env" "$APP/.env.v2" "$APP/server/data/kv.json" "$APP/server/data/kv_history.json" "$APP/Running_project_export.zip"; do [ -e "$f" ] && PATHS+=("$f"); done
log "restic backup ${#PATHS[@]} paths"
"$RESTIC" backup --tag lumpad --host lumpad --one-file-system "${PATHS[@]}"

# 4. retention, then a spot check of the stored data (5 % each night, so everything is verified over about three weeks)
"$RESTIC" forget --tag lumpad --keep-daily 30 --keep-weekly 8 --keep-monthly 6 --prune
"$RESTIC" check --read-data-subset=5%
log "done"
