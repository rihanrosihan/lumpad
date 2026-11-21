#!/usr/bin/env bash
# Turn the web login (Caddy basic auth) off or on without editing files by hand. Run as root on the server:
#   sudo bash /opt/lumpad/deploy/login.sh off     # site opens without a password (public!)
#   sudo bash /opt/lumpad/deploy/login.sh on      # login back, with the saved user and password (or a new one)
#   sudo bash /opt/lumpad/deploy/login.sh status
# Always validates the new config first and keeps a dated backup of /etc/caddy/Caddyfile. The machine-to-machine sync (/api/ingest, token-protected)
# is not affected either way.
set -euo pipefail
CUR=${CADDYFILE:-/etc/caddy/Caddyfile}; TPL=${TEMPLATE:-/opt/lumpad/deploy/Caddyfile}; SAVED=${LOGIN_SAVED:-/etc/caddy/login.saved}
CADDY=${CADDY_BIN:-caddy}; RELOAD=${RELOAD_CMD:-systemctl reload caddy}
has_auth() { grep -qE '^[[:space:]]*basicauth[[:space:]]*\{' "$CUR"; }
domain() { awk '/\{[[:space:]]*$/{print $1; exit}' "$CUR"; }
# the template without its basicauth { ... } block (everything else identical)
strip_auth() { awk '/^[[:space:]]*basicauth[[:space:]]*\{/{skip=1; next} skip&&/^[[:space:]]*\}/{skip=0; next} !skip{print}' "$1"; }
install_cfg() { "$CADDY" validate --config "$1" --adapter caddyfile >/dev/null; cp "$CUR" "$CUR.bak.$(date +%Y%m%d-%H%M%S)"; cp "$1" "$CUR"; $RELOAD; }
case "${1:-status}" in
  status) if has_auth; then echo "login: ON (basic auth for user $(awk '/basicauth[[:space:]]*\{/{f=1;next} f&&NF{print $1; exit}' "$CUR"))"; else echo "login: OFF (site is public)"; fi ;;
  off)
    has_auth || { echo "login is already off"; exit 0; }
    D=$(domain); read -r U H < <(awk '/basicauth[[:space:]]*\{/{f=1;next} f&&NF{print $1, $2; exit}' "$CUR")
    (umask 077; printf '%s %s\n' "$U" "$H" > "$SAVED")   # kept so "on" can restore the same user and password
    T=$(mktemp); sed -e "s#__DOMAIN__#$D#" "$TPL" > "$T.in"; strip_auth "$T.in" > "$T"; rm -f "$T.in"
    install_cfg "$T"; rm -f "$T"; echo "login OFF for $D. Anyone with the address can open the site. Put it back with: sudo bash $0 on" ;;
  on)
    has_auth && { echo "login is already on"; exit 0; }
    D=$(domain)
    if [ -s "$SAVED" ]; then read -r U H < "$SAVED"; else read -rp "username: " U; echo "choose the password (hidden, twice):"; H=$("$CADDY" hash-password); fi
    T=$(mktemp); sed -e "s#__DOMAIN__#$D#" -e "s#__USER__#$U#" -e "s#__HASH__#$H#" "$TPL" > "$T"
    install_cfg "$T"; rm -f "$T"; echo "login ON for $D (user $U)" ;;
  *) echo "usage: $0 on|off|status" >&2; exit 2 ;;
esac
