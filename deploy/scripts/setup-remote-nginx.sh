#!/usr/bin/env bash
# 在远程 Ubuntu 服务器上安装 Nginx 并启用霍因静态站配置
# 用法（在本机执行）:
#   REMOTE_HOST=172.16.17.61 REMOTE_USER=root PEM=/keys/hy-hf-k8s.pem bash deploy/scripts/setup-remote-nginx.sh
set -euo pipefail

REMOTE_HOST="${REMOTE_HOST:-172.16.17.61}"
REMOTE_USER="${REMOTE_USER:-root}"
REMOTE_PORT="${REMOTE_PORT:-22}"
PEM="${PEM:-/Users/holy/holy_svn/Historage/腾讯密钥/hy-hf-k8s.pem}"
CONF_LOCAL="$(cd "$(dirname "$0")/.." && pwd)/nginx/remote/huoyinkeji.conf"

SSH_OPTS=(-o StrictHostKeyChecking=accept-new -o BatchMode=yes)
SCP_OPTS=(-o StrictHostKeyChecking=accept-new -o BatchMode=yes)
[[ -n "$REMOTE_PORT" && "$REMOTE_PORT" != "22" ]] && SSH_OPTS+=(-p "$REMOTE_PORT") && SCP_OPTS+=(-P "$REMOTE_PORT")
[[ -f "$PEM" ]] && SSH_OPTS+=(-i "$PEM") && SCP_OPTS+=(-i "$PEM")

echo ">>> 上传 Nginx 配置到 ${REMOTE_USER}@${REMOTE_HOST}"
scp "${SCP_OPTS[@]}" "$CONF_LOCAL" "${REMOTE_USER}@${REMOTE_HOST}:/tmp/huoyinkeji.conf"

echo ">>> 安装并启用 Nginx"
ssh "${SSH_OPTS[@]}" "${REMOTE_USER}@${REMOTE_HOST}" bash -s <<'REMOTE'
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
if ! command -v nginx >/dev/null 2>&1; then
  apt-get update -qq
  apt-get install -y -qq nginx
fi
mkdir -p /var/www/sites/huoyinkeji/public
cp /tmp/huoyinkeji.conf /etc/nginx/sites-available/huoyinkeji
ln -sf /etc/nginx/sites-available/huoyinkeji /etc/nginx/sites-enabled/huoyinkeji
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl enable nginx
systemctl restart nginx
echo ">>> Nginx 已启动，监听 80"
curl -s -o /dev/null -w "HTTP %{http_code}\n" http://127.0.0.1/ || true
REMOTE

echo ">>> 完成。浏览器访问: http://${REMOTE_HOST}/"
