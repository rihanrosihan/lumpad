#!/usr/bin/env bash
# Daily backup of /opt/lumpad/server/data → /var/backups/lumpad (30 days kept). Same disk as the app:
# copy these off the server too (see README) if the data matters to you.
set -euo pipefail
D=/var/backups/lumpad; mkdir -p "$D"; chmod 700 "$D"
tar -czf "$D/lumpad-$(date +%Y%m%d-%H%M).tar.gz" -C /opt/lumpad/server data
find "$D" -name 'lumpad-*.tar.gz' -mtime +30 -delete
