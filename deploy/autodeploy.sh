#!/usr/bin/env bash
# Auto-deploy: every few minutes (systemd timer) check origin/main; if there is a new fast-forward commit,
#   1. test + build it in a SEPARATE worktree (the live app is untouched while this runs),
#   2. snapshot the data (only when server/ changed, because that may carry a DB migration),
#   3. run deploy.sh, then poll /api/health,
#   4. on any failure roll the checkout back to the previous commit, redeploy it, and remember the bad commit so it is not retried.
# Disable:  touch /etc/lumpad-autodeploy.disabled   Enable again: rm it.   Log: journalctl -u lumpad-autodeploy -n 50
# Everything is overridable by env so the logic can be tested without a server (deploy/autodeploy.test.sh).
set -uo pipefail
APP=${APP_DIR:-/opt/lumpad}; STATE=${STATE_DIR:-/var/lib/lumpad-autodeploy}; BRANCH=${BRANCH:-main}
RUN_AS=${RUN_AS-lumpad}; DISABLE=${DISABLE_FILE:-/etc/lumpad-autodeploy.disabled}
HEALTH=${HEALTH_URL:-http://127.0.0.1:8787/api/health}; HEALTH_TRIES=${HEALTH_TRIES:-20}
DEPLOY=${DEPLOY_CMD:-bash $APP/deploy/deploy.sh}; BACKUP=${BACKUP_CMD:-bash $APP/deploy/backup.sh}
log() { echo "$(date '+%F %T') autodeploy: $*"; }
as() { if [ -n "$RUN_AS" ]; then sudo -u "$RUN_AS" "$@"; else "$@"; fi }
own() { [ -n "$RUN_AS" ] && chown -R "$RUN_AS:$RUN_AS" "$@"; return 0; }
healthy() { local i; for ((i = 0; i < HEALTH_TRIES; i++)); do curl -fsS -m 3 "$HEALTH" >/dev/null 2>&1 && return 0; sleep 1; done; return 1; }

main() {  # wrapped in a function so bash has read the whole script before git replaces this file
  mkdir -p "$STATE"; exec 9>"$STATE/lock"; flock -n 9 || exit 0
  [ -e "$DISABLE" ] && exit 0
  cd "$APP" || exit 1
  git fetch -q origin "$BRANCH" || { log "fetch gagal, coba lagi nanti"; exit 0; }
  local cur new; cur=$(git rev-parse HEAD); new=$(git rev-parse "origin/$BRANCH")
  [ "$cur" = "$new" ] && exit 0
  [ "$(cat "$STATE/failed" 2>/dev/null)" = "$new" ] && exit 0   # already tried and failed: wait for a newer commit
  git merge-base --is-ancestor "$cur" "$new" || { log "origin/$BRANCH bukan fast-forward dari $cur: tidak disentuh"; exit 0; }
  git diff --quiet && git diff --cached --quiet || { log "ada perubahan lokal di $APP: auto-deploy berhenti (cek git status)"; exit 0; }
  log "kandidat ${cur:0:7} -> ${new:0:7}: $(git log -1 --format=%s "$new")"

  # 1. verify in isolation
  local stage="$STATE/stage"; git worktree remove --force "$stage" 2>/dev/null; rm -rf "$stage"
  git worktree prune; git worktree add -q --detach "$stage" "$new" || { log "worktree gagal"; exit 1; }
  own "$stage"
  local tmp; tmp=$(as mktemp -d)
  if ! ( cd "$stage" && as npm ci --no-audit --no-fund >"$STATE/stage.log" 2>&1 && as env DATA_DIR="$tmp" npm test >>"$STATE/stage.log" 2>&1 && as npm run build >>"$STATE/stage.log" 2>&1 ); then
    log "GAGAL di tes/build — TIDAK di-deploy. Ekor log:"; tail -n 15 "$STATE/stage.log"
    echo "$new" >"$STATE/failed"; rm -rf "$tmp"; git worktree remove --force "$stage" 2>/dev/null; exit 1
  fi
  rm -rf "$tmp"; git worktree remove --force "$stage" 2>/dev/null; log "tes + build lulus"

  # 2. snapshot before a possible DB migration
  if git diff --name-only "$cur" "$new" | grep -q '^server/'; then eval "$BACKUP" >/dev/null 2>&1 && log "backup data dibuat" || log "PERINGATAN: backup gagal"; fi

  # 3. deploy + verify
  if git merge -q --ff-only "$new" && own "$APP" && eval "$DEPLOY" >>"$STATE/deploy.log" 2>&1 && healthy; then
    echo "$new" >"$STATE/deployed"; rm -f "$STATE/failed"; log "SELESAI: ${new:0:7} aktif dan sehat"; exit 0
  fi

  # 4. rollback
  log "deploy/health GAGAL — rollback ke ${cur:0:7}"; tail -n 10 "$STATE/deploy.log" 2>/dev/null
  git reset -q --hard "$cur"; own "$APP"
  if SKIP_PULL=1 eval "$DEPLOY" >>"$STATE/deploy.log" 2>&1 && healthy; then log "rollback berhasil, ${cur:0:7} aktif lagi"
  else log "ROLLBACK JUGA GAGAL — perlu tindakan manual (journalctl -u lumpad; backup di /var/backups/lumpad)"; fi
  echo "$new" >"$STATE/failed"; exit 1
}
main "$@"; exit $?
