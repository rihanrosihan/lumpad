#!/usr/bin/env bash
# Tune the 4 GB RAM / 60 GB disk server: PostgreSQL settings, memory limits for every service, journald size limit.
# Safe by default: installs the files and reloads systemd, but does NOT restart PostgreSQL (shared_buffers needs a restart).
#   sudo bash deploy/v2/tune-4gb.sh                     install + report what a restart will change
#   sudo bash deploy/v2/tune-4gb.sh --restart-postgres  also restart PostgreSQL (do this right after a morning shadow pass; ~5 s of downtime)
#   sudo bash deploy/v2/tune-4gb.sh --check             only show whether this machine qualifies and what is installed
# Refuses on a machine with less than 3.5 GB RAM: these limits would overcommit a 2 GB server.
set -euo pipefail
APP=/opt/lumpad; PGV=16; D="$APP/deploy/v2"; MODE="${1:-install}"
mem_mb=$(awk '/MemTotal/ {printf "%d", $2/1024}' /proc/meminfo)
echo "RAM ${mem_mb} MB, disk free $(df -h / | awk 'NR==2{print $4}')"
if [ "$mem_mb" -lt 3500 ]; then echo "this machine has under 3.5 GB RAM: the 4 GB profile is not for it (keeping the 2 GB settings)"; exit 2; fi
[ "$MODE" = --check ] && { for f in /etc/postgresql/$PGV/main/conf.d/lumpad.conf; do grep -H "^shared_buffers" "$f" || true; done; systemctl show -p MemoryMax postgresql@$PGV-main lumpad lumpadd-serve 2>/dev/null; exit 0; }
[ "$(id -u)" = 0 ] || { echo "run as root"; exit 1; }
conf=/etc/postgresql/$PGV/main/conf.d/lumpad.conf
[ -f "$conf" ] && cp -p "$conf" "$conf.bak-$(date +%Y%m%d%H%M)"
install -m 644 "$D/postgresql-4gb.conf" "$conf"
dropin() { mkdir -p "/etc/systemd/system/$1.d"; install -m 644 "$2" "/etc/systemd/system/$1.d/limits.conf"; }
dropin postgresql@$PGV-main.service "$D/systemd/4gb/postgresql-limits.conf"
dropin lumpad.service "$D/systemd/4gb/lumpad-limits.conf"
for u in lumpadd-serve lumpadd-shadow lumpadd-graph-sync lumpadd; do [ -f "$D/systemd/$u.service" ] && dropin $u.service "$D/systemd/4gb/limits-oneshot.conf"; done
mkdir -p /etc/systemd/journald.conf.d; install -m 644 "$D/systemd/4gb/journald-lumpad.conf" /etc/systemd/journald.conf.d/lumpad.conf
systemctl daemon-reload; systemctl restart systemd-journald
journalctl --vacuum-size=500M >/dev/null 2>&1 || true
echo "installed. Postgres still runs with the OLD shared_buffers until it is restarted."
if [ "$MODE" = --restart-postgres ]; then
  systemctl restart postgresql@$PGV-main; sleep 3
  sudo -u postgres psql -qtAc "SHOW shared_buffers" | sed 's/^/shared_buffers now: /'
  for s in lumpad lumpadd-serve; do printf '%s: ' "$s"; systemctl is-active "$s"; done
else echo "restart later with:  sudo bash $D/tune-4gb.sh --restart-postgres   (right after a morning shadow pass)"; fi
free -m | sed -n 1,2p
