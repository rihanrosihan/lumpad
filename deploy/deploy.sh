#!/usr/bin/env bash
# Update: pull, build, restart. Run as root (or sudo) from anywhere.
set -euo pipefail
cd /opt/lumpad
git pull --ff-only   # as root: only root holds the deploy key
mkdir -p /opt/lumpad/server/data
chown -R lumpad:lumpad /opt/lumpad
sudo -u lumpad npm ci --no-audit --no-fund
sudo -u lumpad npm run build

# Ingest token for the daily sync (created once; never printed here)
if ! grep -q '^INGEST_TOKEN=.\{32,\}' .env; then
  sed -i '/^INGEST_TOKEN=/d' .env; echo "INGEST_TOKEN=$(openssl rand -hex 32)" >> .env
  echo ">> INGEST_TOKEN dibuat di /opt/lumpad/.env (tampilkan sendiri: grep INGEST_TOKEN /opt/lumpad/.env)"
fi
chown lumpad:lumpad .env; chmod 600 .env

# Caddy: ensure the ingest bypass exists (idempotent)
grep -q '@ingest' /etc/caddy/Caddyfile || bash /opt/lumpad/deploy/update-caddy.sh

cp deploy/lumpad.service /etc/systemd/system/lumpad.service && systemctl daemon-reload
[ -f /etc/cron.d/lumpad-backup ] || echo '15 3 * * * root /opt/lumpad/deploy/backup.sh' > /etc/cron.d/lumpad-backup
systemctl restart lumpad
sleep 1
systemctl is-active lumpad && curl -fsS http://127.0.0.1:8787/api/health && echo
