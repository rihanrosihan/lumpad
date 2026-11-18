#!/usr/bin/env bash
# Phase 1 gate G1 — memory benchmark for the 2 GB VPS. Run on the server AFTER installing PostgreSQL 16 (see deploy/v2/README.md).
# It starts a THROWAWAY Postgres cluster in /tmp on port 5545 with deploy/v2/postgresql-2gb.conf, loads a copy of today's data with the Go loader,
# runs queries and the FIT decode benchmark while sampling system memory every second, then removes everything. Running services are not touched.
# Usage: sudo bash deploy/v2/bench-memory.sh [DATA_DIR=/opt/lumpad/server/data] [LUMPADD=/opt/lumpad/lumpadd/lumpadd] [FITBENCH=/opt/lumpad/lumpadd/fitbench]
set -euo pipefail
DATA=${1:-/opt/lumpad/server/data}; BIN=${2:-/opt/lumpad/lumpadd/lumpadd}; FITB=${3:-/opt/lumpad/lumpadd/fitbench}
PGBIN=$(ls -d /usr/lib/postgresql/*/bin | sort -V | tail -1); CONF="$(cd "$(dirname "$0")" && pwd)/postgresql-2gb.conf"
W=$(mktemp -d /tmp/lumpad-bench.XXXXXX); chown postgres "$W"; PORT=5545; LOG="$W/mem.log"
cleanup() { sudo -u postgres "$PGBIN/pg_ctl" -D "$W/pg" -m immediate stop >/dev/null 2>&1 || true; kill "${SAMPLER:-0}" 2>/dev/null || true; rm -rf "$W"; }
trap cleanup EXIT
echo "== before: $(free -m | awk 'NR==2{print "RAM total "$2" MB, used "$3" MB, available "$7" MB"}'); swap $(free -m | awk 'NR==3{print $3" of "$2" MB used"}')"
echo "== top memory users now:"; ps -eo rss,comm --sort=-rss | head -6 | awk '{printf "   %6.0f MB  %s\n",$1/1024,$2}'
[ -x "$BIN" ] || { echo "missing $BIN (build: cd lumpadd && CGO_ENABLED=0 go build -o lumpadd ./cmd/lumpadd)"; exit 1; }
sudo -u postgres "$PGBIN/initdb" -D "$W/pg" -A trust >/dev/null
cat "$CONF" | grep -v '^#' | grep -v '^$' >> "$W/pg/postgresql.conf"
echo "port = $PORT"            >> "$W/pg/postgresql.conf"
echo "unix_socket_directories = '$W'" >> "$W/pg/postgresql.conf"; echo "listen_addresses = '127.0.0.1'" >> "$W/pg/postgresql.conf"
sudo -u postgres "$PGBIN/pg_ctl" -D "$W/pg" -l "$W/pg.log" -w start >/dev/null
( while true; do echo "$(date +%s) $(free -m | awk 'NR==2{print $3, $7} NR==3{print $3}' | tr '\n' ' ')" >> "$LOG"; sleep 1; done ) & SAMPLER=$!
export DATABASE_URL="postgres://postgres@127.0.0.1:$PORT/postgres?sslmode=disable"
"$BIN" migrate | head -5
echo "== load"; T0=$(date +%s.%N); "$BIN" load "$DATA" | tail -2; echo "   loaded in $(awk -v a="$T0" -v b="$(date +%s.%N)" 'BEGIN{printf "%.1f", b-a}') s"
echo "== queries (3 rounds)"; for i in 1 2 3; do psql "$DATABASE_URL" -qAtc "select count(*) from train.session_metric; select count(*) from memory.item where tsv @@ plainto_tsquery('simple','durability fade'); select avg(ef) from train.session_metric where date > '2026-01-01'" >/dev/null; done
if [ -x "$FITB" ]; then echo "== FIT decode"; "$FITB" "$DATA/fit" | tail -1; fi
sleep 3; kill "$SAMPLER" 2>/dev/null || true
awk '{u=$2; a=$3; s=$4; if(u>pu)pu=u; if(mn==""||a<mn)mn=a; if(s>ps)ps=s} END{printf "== peak: used %d MB, lowest available %d MB, swap used %d MB (during the benchmark, with the live app running)\n",pu,mn,ps}' "$LOG"
PEAK=$(awk '{if($2>m)m=$2} END{print m}' "$LOG"); TOTAL=$(free -m | awk 'NR==2{print $2}')
[ "$PEAK" -lt $((TOTAL * 75 / 100)) ] && echo "RESULT: PASS — peak used $PEAK MB is under 75% of $TOTAL MB" || { echo "RESULT: FAIL — peak used $PEAK MB is over 75% of $TOTAL MB; see the fallback in the plan"; exit 1; }
