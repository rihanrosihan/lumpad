#!/usr/bin/env bash
# Daily backup → /var/backups/lumpad (30 days kept). Same disk as the app: copy off-server if the data matters.
# SQLite is snapshotted with VACUUM INTO first (copying a live WAL database can be inconsistent).
set -euo pipefail
D=/var/backups/lumpad; mkdir -p "$D"; chmod 700 "$D"
cd /opt/lumpad
sudo -u lumpad env DATA_DIR=/opt/lumpad/server/data node --disable-warning=ExperimentalWarning server/snapshot.js >/dev/null
tar -czf "$D/lumpad-$(date +%Y%m%d-%H%M).tar.gz" -C /opt/lumpad/server --exclude='data/lumpad.db' --exclude='data/lumpad.db-wal' --exclude='data/lumpad.db-shm' data
find "$D" -name 'lumpad-*.tar.gz' -mtime +30 -delete
