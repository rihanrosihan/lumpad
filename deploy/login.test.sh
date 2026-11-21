#!/usr/bin/env bash
# Offline test of deploy/login.sh with a fake caddy and reload (no server): bash deploy/login.test.sh
set -uo pipefail
S=$(cd "$(dirname "$0")" && pwd); W=$(mktemp -d); trap 'rm -rf "$W"' EXIT
ok() { echo "ok   $1"; }; die() { echo "FAIL $1"; exit 1; }
sed -e 's#__DOMAIN__#example.test#' -e 's#__USER__#rihan#' -e 's#__HASH__#$2a$14$abcdefghijklmnopqrstuv#' "$S/Caddyfile" > "$W/Caddyfile"
printf '#!/usr/bin/env bash\nexit 0\n' > "$W/caddy"; chmod +x "$W/caddy"
run() { CADDYFILE="$W/Caddyfile" TEMPLATE="$S/Caddyfile" LOGIN_SAVED="$W/saved" CADDY_BIN="$W/caddy" RELOAD_CMD=true bash "$S/login.sh" "$@" 2>&1; }
run status | grep -q "login: ON (basic auth for user rihan)" && ok "status on" || die "status on"
run off >/dev/null; run status | grep -q "login: OFF" && ok "off removes basic auth" || die "off"
grep -q basicauth "$W/Caddyfile" && die "basicauth still there"; grep -q "reverse_proxy 127.0.0.1:8787" "$W/Caddyfile" && grep -q "/api/ingest" "$W/Caddyfile" && grep -q "file_server" "$W/Caddyfile" && ok "proxy, ingest token route and static files kept" || die "routes lost"
a=$(tr -cd '{' < "$W/Caddyfile" | wc -c); b=$(tr -cd '}' < "$W/Caddyfile" | wc -c); [ "$a" = "$b" ] && ok "braces balanced ($a)" || die "braces $a vs $b"
grep -q "example.test {" "$W/Caddyfile" && ok "domain kept" || die "domain"
[ "$(stat -c %a "$W/saved")" = 600 ] && grep -q '^rihan ' "$W/saved" && ok "user and hash saved (mode 600)" || die "saved file"
ls "$W"/Caddyfile.bak.* >/dev/null 2>&1 && ok "backup kept" || die "no backup"
run on >/dev/null; run status | grep -q "user rihan" && grep -q 'rihan \$2a\$14\$abcdefghijklmnopqrstuv' "$W/Caddyfile" && ok "on restores the same user and hash" || die "on"
run off | grep -q "already" ; run off >/dev/null; run off | grep -q "already off" && ok "off twice is harmless" || die "idempotent"
run bogus >/dev/null; [ $? = 2 ] && ok "bad argument: exit 2" || die "usage"
