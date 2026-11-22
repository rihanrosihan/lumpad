#!/usr/bin/env bash
# Re-render /etc/caddy/Caddyfile from deploy/Caddyfile, reusing the domain, user and password hash already in place.
# Validates first and keeps a backup, so a bad template can't take the site down.
set -euo pipefail
CUR=/etc/caddy/Caddyfile
DOMAIN=$(awk '/\{[[:space:]]*$/{print $1; exit}' $CUR)
read -r USER_NAME HASH < <(awk '/basicauth[[:space:]]*\{/{f=1;next} f&&NF{print $1, $2; exit}' $CUR)
# repair: the template was copied over the live file by mistake (still has the __PLACEHOLDERS__) -> pass the domain: sudo DOMAIN=example.com bash update-caddy.sh
if [ "$DOMAIN" = "__DOMAIN__" ] || [ -z "$DOMAIN" ]; then DOMAIN=${DOMAIN_NAME:-${SITE_DOMAIN:-}}; fi
[ -n "$DOMAIN" ] || { echo "The domain is not in $CUR any more. Run: sudo SITE_DOMAIN=your.domain bash $0"; exit 1; }
if [ "${USER_NAME:-}" = "__USER__" ] || [ "${HASH:-}" = "__HASH__" ]; then USER_NAME=""; HASH=""; fi
TMP=$(mktemp)
if [ -n "$USER_NAME" ] && [ -n "$HASH" ]; then
  sed -e "s#__DOMAIN__#$DOMAIN#" -e "s#__USER__#$USER_NAME#" -e "s#__HASH__#$HASH#" /opt/lumpad/deploy/Caddyfile > "$TMP"
else  # login switched off with deploy/login.sh: keep it off
  sed -e "s#__DOMAIN__#$DOMAIN#" /opt/lumpad/deploy/Caddyfile | awk '/^[[:space:]]*basicauth[[:space:]]*\{/{skip=1; next} skip&&/^[[:space:]]*\}/{skip=0; next} !skip{print}' > "$TMP"
  USER_NAME="(login off)"
fi
caddy validate --config "$TMP" --adapter caddyfile >/dev/null
cp $CUR $CUR.bak.$(date +%Y%m%d-%H%M); cp "$TMP" $CUR; rm "$TMP"
systemctl reload caddy && echo "Caddy updated for $DOMAIN (user $USER_NAME)"
