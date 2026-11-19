#!/usr/bin/env bash
# One-time setup of the v2 side on the 2 GB VPS (redesign Phase 3). Run as root after PostgreSQL 16 and Go are installed
# (deploy/v2/README.md). Idempotent: safe to run again. Nothing here touches the running Node app or its data.
set -euo pipefail
APP=/opt/lumpad; PGV=16
[ "$(id -u)" = 0 ] || { echo "run as root"; exit 1; }
[ -d /usr/lib/postgresql/$PGV/bin ] || { echo "PostgreSQL $PGV not installed"; exit 1; }
[ -x /usr/local/go/bin/go ] || { echo "Go not installed at /usr/local/go"; exit 1; }

# 1. memory settings + limits (Postgres ≤ ~450 MB, killed instead of taking the server down)
install -m 644 "$APP/deploy/v2/postgresql-2gb.conf" /etc/postgresql/$PGV/main/conf.d/lumpad.conf
mkdir -p /etc/systemd/system/postgresql@$PGV-main.service.d /etc/systemd/system/lumpad.service.d
install -m 644 "$APP/deploy/v2/systemd/postgresql-limits.conf" /etc/systemd/system/postgresql@$PGV-main.service.d/limits.conf
install -m 644 "$APP/deploy/v2/systemd/lumpad-limits.conf" /etc/systemd/system/lumpad.service.d/limits.conf
systemctl daemon-reload
systemctl enable postgresql >/dev/null 2>&1
systemctl restart postgresql@$PGV-main
sleep 2

# 2. role + database; the app user connects over the local socket with peer auth (no password exists)
q() { sudo -u postgres psql -qtAc "$1"; }
[ "$(q "SELECT 1 FROM pg_roles WHERE rolname='lumpad'")" = 1 ] || sudo -u postgres psql -qc "CREATE ROLE lumpad LOGIN"
[ "$(q "SELECT 1 FROM pg_database WHERE datname='lumpad'")" = 1 ] || sudo -u postgres createdb -O lumpad lumpad
for ext in vector timescaledb; do sudo -u postgres psql -d lumpad -qc "CREATE EXTENSION IF NOT EXISTS $ext" 2>/dev/null || true; done
# the value is quoted: an unquoted & would end the assignment when the file is sourced by a shell (systemd accepts the quotes too)
printf 'DATABASE_URL="postgres://lumpad@/lumpad?host=/var/run/postgresql&sslmode=disable"\n' > "$APP/.env.v2"
chown lumpad:lumpad "$APP/.env.v2"; chmod 600 "$APP/.env.v2"
# fail early, with a clear message, if the file does not give the programs a database
sudo -u lumpad bash -c "set -a; . $APP/.env.v2; set +a; [ -n \"\$DATABASE_URL\" ]" || { echo ".env.v2 does not set DATABASE_URL"; exit 1; }
sudo -u lumpad psql "postgres://lumpad@/lumpad?host=/var/run/postgresql" -qtAc "SELECT 'database ok: ' || current_user" || { echo "the lumpad role cannot connect to the lumpad database"; exit 1; }

# 3. build, migrate, shadow timer; from now on deploy.sh rebuilds after every auto-deploy
touch /etc/lumpad-v2.enabled
bash "$APP/deploy/v2/build.sh"

# 4. first shadow pass now (loads all data into Postgres and verifies it), then the gate report
sudo -u lumpad bash -c "set -a; . $APP/.env.v2; set +a; $APP/lumpadd/lumpadd shadow $APP/server/data" || true
sudo -u lumpad bash -c "set -a; . $APP/.env.v2; set +a; $APP/lumpadd/lumpadd g3" | tail -3
echo; echo "Memory now:"; free -m | sed -n 1,3p
echo "Done. Shadow runs every 15 min:  systemctl list-timers lumpadd-shadow.timer   log: journalctl -u lumpadd-shadow -n 30"
