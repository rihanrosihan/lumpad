#!/usr/bin/env bash
# Offline test of the off-server backup scripts with a stub restic (no network, no bucket): bash deploy/backup/offsite-backup.test.sh
set -uo pipefail
S=$(cd "$(dirname "$0")" && pwd); W=$(mktemp -d); trap 'rm -rf "$W"' EXIT
ok() { echo "ok   $1"; }; die() { echo "FAIL $1"; exit 1; }
mkdir -p "$W/app/server/data" "$W/local"; echo '{}' > "$W/app/server/data/kv.json"; echo 'X=1' > "$W/app/.env"
printf 'RESTIC_REPOSITORY=s3:https://example.invalid/b/lumpad\nRESTIC_PASSWORD_FILE=%s/pw\nAWS_ACCESS_KEY_ID=a\nAWS_SECRET_ACCESS_KEY=b\n' "$W" > "$W/env"; echo pw > "$W/pw"
cat > "$W/restic" <<'R'
#!/usr/bin/env bash
echo "$*" >> "$STUB_LOG"; [ "$1" = "${STUB_FAIL:-}" ] && exit 1; exit 0
R
chmod +x "$W/restic"
run() { STUB_LOG="$W/log" BACKUP_ENV="$W/env" APP_DIR="$W/app" LOCAL_BACKUP_DIR="$W/local" RESTIC_BIN="$W/restic" SKIP_LOCAL_SNAPSHOT=1 bash "$S/offsite-backup.sh" 2>&1; }
: > "$W/log"; out=$(run); rc=$?
[ $rc = 0 ] && ok "full run succeeds" || die "full run rc=$rc: $out"
[ "$(sed -n 1p "$W/log" | cut -d' ' -f1)" = backup ] && [ "$(sed -n 2p "$W/log" | cut -d' ' -f1)" = forget ] && [ "$(sed -n 3p "$W/log" | cut -d' ' -f1)" = check ] && ok "order: backup, forget, check" || die "order: $(cat "$W/log")"
grep -q -- "--keep-daily 30" "$W/log" && grep -q -- "--prune" "$W/log" && ok "retention 30 daily + prune" || die "retention flags"
grep -q "$W/local" "$W/log" && grep -q "$W/app/.env" "$W/log" && grep -q "kv.json" "$W/log" && ok "backs up local snapshots, .env and kv.json" || die "paths: $(cat "$W/log")"
echo "$out" | grep -q 'AWS_SECRET\|SecretKey\|=b$' && die "secret printed" || ok "no secret in the output"
for step in backup forget check; do : > "$W/log"; STUB_FAIL=$step out=$(STUB_FAIL=$step run); rc=$?; [ $rc != 0 ] && ok "failed $step makes the run fail (rc $rc)" || die "failed $step ignored"; done
BACKUP_ENV="$W/none" bash "$S/offsite-backup.sh" >/dev/null 2>&1; [ $? = 2 ] && ok "missing settings file: exit 2" || die "missing env"
