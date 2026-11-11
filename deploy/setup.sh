#!/usr/bin/env bash
# One-time server setup (Ubuntu). Run as root:  bash deploy/setup.sh <domain> <basic-auth-user>
# Domain: use your own, or <ip-with-dashes>.nip.io (e.g. 43-173-30-236.nip.io) for a real HTTPS cert without buying one.
set -euo pipefail
DOMAIN="${1:?usage: setup.sh <domain> <user>}"; USER_NAME="${2:?usage: setup.sh <domain> <user>}"
APP=/opt/lumpad

apt-get update -y
apt-get install -y curl git caddy
# Node 22 (NodeSource)
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

id lumpad &>/dev/null || useradd --system --home $APP --shell /usr/sbin/nologin lumpad
[ -d $APP ] || { echo "Clone the repo to $APP first (see README)"; exit 1; }
chown -R lumpad:lumpad $APP
[ -f $APP/.env ] || { cp $APP/.env.example $APP/.env; chmod 600 $APP/.env; chown lumpad:lumpad $APP/.env; }
sed -i "s#^PUBLIC_URL=.*#PUBLIC_URL=https://$DOMAIN#" $APP/.env

read -rsp "Password for web login ($USER_NAME): " PW; echo
HASH=$(caddy hash-password --plaintext "$PW")
sed -e "s#__DOMAIN__#$DOMAIN#" -e "s#__USER__#$USER_NAME#" -e "s#__HASH__#$HASH#" $APP/deploy/Caddyfile > /etc/caddy/Caddyfile
cp $APP/deploy/lumpad.service /etc/systemd/system/lumpad.service
systemctl daemon-reload; systemctl enable --now lumpad; systemctl restart caddy
bash $APP/deploy/deploy.sh
echo "Done: https://$DOMAIN  (ports 80/443 already open in UFW; API stays on 127.0.0.1)"
