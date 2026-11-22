#!/usr/bin/env bash
# Post-deploy guard (audit C1/M8): personal-data routes must refuse anonymous requests and data files must not be world-readable.
# Prints warnings only (never fails the deploy). Usage: deploy/authcheck.sh [domain]
D=${1:-$(awk '/\{[[:space:]]*$/{print $1; exit}' /etc/caddy/Caddyfile 2>/dev/null)}; bad=0
if [ -n "$D" ]; then
  for p in /api/twin /api/memory '/api/export?what=health&format=csv' /api/v2/health; do
    c=$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 --resolve "$D:443:127.0.0.1" "https://$D$p" 2>/dev/null)
    [ "$c" = 401 ] || { echo ">> PERINGATAN: $p answers $c without credentials (expected 401) — run: sudo bash deploy/login.sh on"; bad=1; }
  done
fi
n=$(find /opt/lumpad/server/data -maxdepth 1 -type f -perm /o+r 2>/dev/null | wc -l); [ "$n" = 0 ] || { echo ">> PERINGATAN: $n data files are world-readable: chmod 600 /opt/lumpad/server/data/*"; bad=1; }
exit $bad
