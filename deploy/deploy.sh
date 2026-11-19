#!/usr/bin/env bash
# Update: pull, build, restart. Run as root (or sudo) from anywhere.
set -euo pipefail
cd /opt/lumpad
[ "${SKIP_PULL:-}" = 1 ] || git pull --ff-only   # as root: only root holds the deploy key (SKIP_PULL=1: autodeploy rollback)
mkdir -p /opt/lumpad/server/data
chown -R lumpad:lumpad /opt/lumpad
sudo -u lumpad npm ci --no-audit --no-fund
sudo -u lumpad npm run build

# Ingest token for the daily sync (created once; never printed here)
if ! grep -q '^INGEST_TOKEN=.\{32,\}' .env; then
  sed -i '/^INGEST_TOKEN=/d' .env; echo "INGEST_TOKEN=$(openssl rand -hex 32)" >> .env
  echo ">> INGEST_TOKEN dibuat di /opt/lumpad/.env (tampilkan sendiri: grep INGEST_TOKEN /opt/lumpad/.env)"
fi
# Key that seals COROS OAuth tokens in the database (lives only in .env, so DB copies/backups hold ciphertext only)
if ! grep -q '^LUMPAD_TOKEN_KEY=[0-9a-f]\{64\}' .env; then
  sed -i '/^LUMPAD_TOKEN_KEY=/d' .env; echo "LUMPAD_TOKEN_KEY=$(openssl rand -hex 32)" >> .env
  echo ">> LUMPAD_TOKEN_KEY dibuat di /opt/lumpad/.env (jangan hilang: tanpa ini COROS harus dihubungkan ulang)"
fi
grep -q '^PUBLIC_URL=https://' .env || echo ">> PERINGATAN: PUBLIC_URL di .env belum https://… (dipakai untuk callback COROS)"
chown lumpad:lumpad .env; chmod 600 .env

# Caddy: re-render when the template changed (or the ingest bypass is missing). update-caddy.sh validates first and keeps a backup;
# a failure here is a warning, not a failed deploy.
CADDY_SUM=$(md5sum deploy/Caddyfile | cut -d' ' -f1)
if [ "$(cat /etc/caddy/.lumpad-template.md5 2>/dev/null || true)" != "$CADDY_SUM" ] || ! grep -q '@istatus' /etc/caddy/Caddyfile; then
  bash /opt/lumpad/deploy/update-caddy.sh && echo "$CADDY_SUM" > /etc/caddy/.lumpad-template.md5 || echo ">> PERINGATAN: update Caddy gagal — konfigurasi lama dipertahankan"
fi

cp deploy/lumpad.service /etc/systemd/system/lumpad.service && systemctl daemon-reload
[ -f /etc/cron.d/lumpad-backup ] || echo '15 3 * * * root /opt/lumpad/deploy/backup.sh' > /etc/cron.d/lumpad-backup
# Auto-deploy: timer checks origin/main every 5 min (disable: touch /etc/lumpad-autodeploy.disabled)
chmod +x deploy/autodeploy.sh
cp deploy/lumpad-autodeploy.service deploy/lumpad-autodeploy.timer /etc/systemd/system/ && systemctl daemon-reload
systemctl enable --now lumpad-autodeploy.timer >/dev/null 2>&1 || true
systemctl restart lumpad
sleep 1
# v2 (Go + Postgres, redesign): rebuild + migrate after each deploy once set up (deploy/v2/setup-v2.sh). Never fails the Node deploy.
if [ -f /etc/lumpad-v2.enabled ]; then bash deploy/v2/build.sh || echo ">> PERINGATAN: build v2 gagal — aplikasi Node tetap berjalan"; fi
systemctl is-active lumpad && curl -fsS http://127.0.0.1:8787/api/health && echo
