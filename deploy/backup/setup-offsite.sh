#!/usr/bin/env bash
# One-time setup of the off-server backup (run as root on the server): bash /opt/lumpad/deploy/backup/setup-offsite.sh
# Needs: a Tencent COS bucket and a COS SecretId/SecretKey (the keys are typed at the prompt, never put in chat or in the repository).
set -euo pipefail
APP=/opt/lumpad; ENV=/etc/lumpad-backup.env; PASSF=/root/.lumpad-restic-password
[ "$(id -u)" = 0 ] || { echo "run as root" >&2; exit 1; }
command -v restic >/dev/null 2>&1 || { apt-get update -qq && apt-get install -y -qq restic; }
if [ ! -s "$ENV" ]; then
  read -rp "COS region (e.g. ap-jakarta): " REGION
  read -rp "COS bucket name incl. appid (e.g. lumpad-backup-1250000000): " BUCKET
  read -rp "COS SecretId: " SID
  read -rsp "COS SecretKey (hidden): " SKEY; echo
  [[ "$REGION" =~ ^[a-z0-9-]+$ && "$BUCKET" =~ ^[a-z0-9-]+$ ]] || { echo "region/bucket: lowercase letters, digits and dashes only" >&2; exit 1; }
  umask 077
  printf 'RESTIC_REPOSITORY=s3:https://cos.%s.myqcloud.com/%s/lumpad\nRESTIC_PASSWORD_FILE=%s\nAWS_ACCESS_KEY_ID=%s\nAWS_SECRET_ACCESS_KEY=%s\nAWS_DEFAULT_REGION=%s\n' "$REGION" "$BUCKET" "$PASSF" "$SID" "$SKEY" "$REGION" > "$ENV"
fi
chmod 600 "$ENV"
if [ ! -s "$PASSF" ]; then (umask 077; openssl rand -base64 32 > "$PASSF"); NEW=1; fi
chmod 600 "$PASSF"
set -a; . "$ENV"; set +a
if ! restic cat config >/dev/null 2>&1; then echo "initialising repository"; restic init; fi
install -m 644 "$APP/deploy/backup/lumpad-offsite-backup.service" "$APP/deploy/backup/lumpad-offsite-backup.timer" /etc/systemd/system/
systemctl daemon-reload; systemctl enable --now lumpad-offsite-backup.timer >/dev/null
echo "timer: $(systemctl list-timers lumpad-offsite-backup.timer --no-pager | sed -n 2p)"
if [ -n "${NEW:-}" ]; then
  echo; echo "IMPORTANT: copy the repository password into your own password manager NOW. Without it the backups cannot be opened:"; cat "$PASSF"
fi
echo "first run:  systemctl start lumpad-offsite-backup.service   (then: journalctl -u lumpad-offsite-backup -n 30 --no-pager)"
