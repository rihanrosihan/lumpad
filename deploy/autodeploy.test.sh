#!/usr/bin/env bash
# Offline test of autodeploy.sh against a throwaway git remote (no server needed): bash deploy/autodeploy.test.sh
set -euo pipefail
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null GIT_CONFIG_COUNT=0   # ignore signing/proxy settings of the host
SRC=$(cd "$(dirname "$0")" && pwd); W=$(mktemp -d); trap 'rm -rf "$W"' EXIT
git init -q --bare -b main "$W/origin.git"; git clone -q "$W/origin.git" "$W/work" 2>/dev/null; cd "$W/work"; git config user.email t@t; git config user.name t; git checkout -qb main
mkdir deploy; cp "$SRC/autodeploy.sh" deploy/
cat > package.json <<'J'
{"name":"t","version":"1.0.0","scripts":{"test":"test ! -e FAIL_TEST","build":"true"}}
J
npm install --package-lock-only --silent 2>/dev/null
cat > deploy/deploy.sh <<'D'
#!/usr/bin/env bash
cd "$(dirname "$0")/.."; [ -e BREAK_HEALTH ] && { rm -f "$HEALTHFILE"; exit 0; }; git rev-parse HEAD > "$HEALTHFILE"
D
git add -A; git commit -qm v1; git push -q origin main; git clone -q "$W/origin.git" "$W/app" 2>/dev/null
export APP_DIR="$W/app" STATE_DIR="$W/state" RUN_AS= HEALTHFILE="$W/health" HEALTH_URL="file://$W/health" HEALTH_TRIES=2 DEPLOY_CMD="bash $W/app/deploy/deploy.sh" BACKUP_CMD="touch $W/backup" DISABLE_FILE="$W/off"
run() { bash "$SRC/autodeploy.sh" 2>&1 || true; }
head() { git -C "$W/app" rev-parse HEAD; }
push() { cd "$W/work"; "$@"; git add -A; git commit -qm "$MSG"; git push -q origin main; }
ok() { echo "ok  $1"; }; die() { echo "FAIL $1"; exit 1; }

# 1 nothing new
o=$(run); [ -z "$o" ] && ok "no change = silent" || die "no change: $o"
# 2 good commit
MSG=v2; push touch feature; v2=$(git -C "$W/work" rev-parse HEAD); run >/dev/null
[ "$(head)" = "$v2" ] && [ "$(cat "$W/state/deployed")" = "$v2" ] && ok "good commit deployed" || die "good commit"
[ ! -e "$W/backup" ] && ok "no backup when server/ untouched" || die "unexpected backup"
# 3 failing tests: not deployed
MSG=bad-test; push touch FAIL_TEST; bad=$(git -C "$W/work" rev-parse HEAD); out=$(run)
[ "$(head)" = "$v2" ] && [ "$(cat "$W/state/failed")" = "$bad" ] && echo "$out" | grep -q GAGAL && ok "failing tests blocked, app stays on v2" || die "failing tests: $out"
[ -z "$(run)" ] && ok "bad commit not retried" || die "retried"
# 4 server/ change that breaks health: rolled back + backup taken
MSG=fix; push git rm -q FAIL_TEST; mkdir -p server; touch server/x BREAK_HEALTH; MSG=broken-health; push true; brk=$(git -C "$W/work" rev-parse HEAD); out=$(run)
echo "$out" | grep -q "rollback berhasil" && [ "$(head)" = "$v2" ] && [ -e "$W/backup" ] && ok "unhealthy deploy rolled back, backup taken" || die "rollback: $out"
[ "$(cat "$W/health")" = "$(head)" ] && ok "health restored on rolled-back commit" || die "health not restored"
# 5 fixed follow-up deploys
MSG=heal; push git rm -q BREAK_HEALTH; run >/dev/null; [ "$(head)" = "$(git -C "$W/work" rev-parse HEAD)" ] && ok "fix after rollback deployed" || die "fix"
# 6 kill switch + dirty tree
MSG=v7; push touch f7; touch "$W/off"; [ -z "$(run)" ] && ok "kill switch respected" || die "kill switch"; rm "$W/off"
echo dirty >> "$W/app/package.json"; run | grep -q "perubahan lokal" && ok "dirty tree stops auto-deploy" || die "dirty"
# 7 repo owned by another user (as on the server: app dir belongs to "lumpad", timer runs as root) must not trip "dubious ownership"
if [ "$(id -u)" = 0 ] && id nobody >/dev/null 2>&1; then
  git -C "$W/app" checkout -q package.json; rm -f "$W/state/failed"; MSG=v8; push touch f8; chown -R nobody "$W/app"; v8=$(git -C "$W/work" rev-parse HEAD); out=$(run)
  echo "$out" | grep -q SELESAI && ok "works when the repo is owned by another user" || die "ownership: $out"
else echo "skip  ownership scenario (needs root + user nobody)"; fi
echo all passed
