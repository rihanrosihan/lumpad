#!/usr/bin/env bash
# Re-render /etc/caddy/Caddyfile from deploy/Caddyfile, reusing the domain, user and password hash already in place.
# Validates first and keeps a backup, so a bad template can't take the site down.
set -euo pipefail
CUR=/etc/caddy/Caddyfile
DOMAIN=$(awk '/\{[[:space:]]*$/{print $1; exit}' $CUR)
read -r USER_NAME HASH < <(awk '/basicauth[[:space:]]*\{/{f=1;next} f&&NF{print $1, $2; exit}' $CUR)
[ -n "$DOMAIN" ] && [ -n "$USER_NAME" ] && [ -n "$HASH" ] || { echo "Could not read domain/user/hash from $CUR"; exit 1; }
TMP=$(mktemp); sed -e "s#__DOMAIN__#$DOMAIN#" -e "s#__USER__#$USER_NAME#" -e "s#__HASH__#$HASH#" /opt/lumpad/deploy/Caddyfile > "$TMP"
caddy validate --config "$TMP" --adapter caddyfile >/dev/null
cp $CUR $CUR.bak.$(date +%Y%m%d-%H%M); cp "$TMP" $CUR; rm "$TMP"
systemctl reload caddy && echo "Caddy updated for $DOMAIN (user $USER_NAME)"
