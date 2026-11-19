#!/usr/bin/env bash
# Build the Go binaries, apply migrations and refresh the shadow timer. Run as root. Called by deploy.sh when /etc/lumpad-v2.enabled exists;
# any failure here is reported but never fails the Node deploy.
set -euo pipefail
APP=/opt/lumpad; GO=${GO:-/usr/local/go/bin/go}
[ -x "$GO" ] || { echo "v2: Go not found at $GO (install: see deploy/v2/README.md)"; exit 1; }
cd "$APP/lumpadd"
export GOCACHE=/var/cache/lumpad-go GOMODCACHE=/var/cache/lumpad-gomod GOFLAGS=-mod=mod
mkdir -p "$GOCACHE" "$GOMODCACHE"
CGO_ENABLED=0 "$GO" build -ldflags="-s -w" -o lumpadd.new ./cmd/lumpadd && mv lumpadd.new lumpadd
CGO_ENABLED=0 "$GO" build -ldflags="-s -w" -o fitbench.new ./cmd/fitbench && mv fitbench.new fitbench
chown lumpad:lumpad lumpadd fitbench
sudo -u lumpad bash -c "set -a; . $APP/.env.v2; set +a; $APP/lumpadd/lumpadd migrate" | sed 's/^/v2 migrate: /'
cp "$APP/deploy/v2/systemd/lumpadd-shadow.service" "$APP/deploy/v2/systemd/lumpadd-shadow.timer" "$APP/deploy/v2/systemd/lumpadd-graph-sync.service" "$APP/deploy/v2/systemd/lumpadd-graph-sync.timer" /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now lumpadd-shadow.timer lumpadd-graph-sync.timer >/dev/null
echo "v2: built $(git -C $APP rev-parse --short HEAD), migrated, shadow timer active"
