#!/usr/bin/env bash
# Update: pull, build, restart. Run as root (or sudo) from anywhere.
set -euo pipefail
cd /opt/lumpad
git pull --ff-only   # as root: only root holds the deploy key
mkdir -p /opt/lumpad/server/data
chown -R lumpad:lumpad /opt/lumpad
sudo -u lumpad npm ci --no-audit --no-fund
sudo -u lumpad npm run build
[ -f /etc/cron.d/lumpad-backup ] || echo '15 3 * * * root /opt/lumpad/deploy/backup.sh' > /etc/cron.d/lumpad-backup
systemctl restart lumpad
systemctl is-active lumpad && curl -fsS http://127.0.0.1:8787/api/health && echo
