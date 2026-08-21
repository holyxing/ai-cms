#!/bin/bash
# AI-CMS 一键启动：docker compose up -d + 等待健康 + 补跑迁移
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
DEPLOY_DIR="${ROOT_DIR}/deploy"

if [ ! -f "${DEPLOY_DIR}/docker-compose.yml" ]; then
  echo "错误: 找不到 ${DEPLOY_DIR}/docker-compose.yml" >&2
  exit 1
fi

cd "${DEPLOY_DIR}"
# 项目名由 docker-compose.yml 顶层 name: ai-cms 决定（与目录名无关）

# 从 deploy/.env 读端口（不 source，避免把密钥打进环境）
env_get() {
  local key="$1"
  local default="$2"
  local val=""
  if [ -f .env ]; then
    # grep 找不到键时退出码为 1，pipefail 下需吞掉
    val="$(grep -E "^${key}=" .env | tail -n 1 | cut -d= -f2- | tr -d '[:space:]' | tr -d '"' | tr -d "'" || true)"
  fi
  if [ -z "${val}" ]; then
    printf '%s' "${default}"
  else
    printf '%s' "${val}"
  fi
}

if [ ! -f .env ]; then
  cp .env.example .env
  echo "已从 deploy/.env.example 复制 deploy/.env"
  echo "请检查并按需修改: FERNET_KEY、SECRET_KEY、POSTGRES_PASSWORD、MINIO_ROOT_PASSWORD"
  echo "FERNET_KEY 生成: python -c \"from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())\""
  echo
fi

API_PORT="$(env_get API_PORT 8000)"
FRONTEND_PORT="$(env_get FRONTEND_PORT 5173)"
NGINX_PORT="$(env_get NGINX_PORT 80)"
MINIO_CONSOLE_PORT="$(env_get MINIO_CONSOLE_PORT 9001)"

echo "启动 Docker 服务 (deploy/) ..."
docker compose up -d

wait_postgres() {
  local id status
  local i=0
  local max=30
  id="$(docker compose ps -q postgres)"
  if [ -z "${id}" ]; then
    echo "错误: postgres 容器未创建" >&2
    exit 1
  fi
  echo "等待 postgres healthy ..."
  while [ "${i}" -lt "${max}" ]; do
    status="$(docker inspect --format='{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "${id}")"
    if [ "${status}" = "healthy" ]; then
      echo "postgres 已 healthy"
      return 0
    fi
    i=$((i + 1))
    sleep 2
  done
  echo "等待 postgres healthy 超时" >&2
  docker compose ps postgres
  exit 1
}

api_health_ok() {
  if command -v curl >/dev/null 2>&1; then
    curl -sf "http://127.0.0.1:${API_PORT}/healthz" >/dev/null
  else
    # 容器内 uvicorn 监听 8000，与 host 映射端口无关
    docker compose exec -T api python -c \
      "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/healthz', timeout=3)"
  fi
}

wait_api() {
  local i=0
  local max=60
  echo "等待 api 就绪 (curl /healthz) ..."
  while [ "${i}" -lt "${max}" ]; do
    if api_health_ok; then
      echo "api 已就绪"
      return 0
    fi
    i=$((i + 1))
    sleep 2
  done
  echo "等待 api /healthz 超时" >&2
  docker compose logs --tail=50 api
  exit 1
}

wait_postgres
wait_api

# compose 里 api 的 command 冷启动已执行 alembic upgrade head。
# 容器已在跑、未重建时 command 不会再跑；此处补一次（upgrade head 幂等）。
# 必须放在 api 健康之后，避免与冷启动中的 alembic 并发。
echo "执行 alembic upgrade head ..."
docker compose exec -T api alembic upgrade head

echo
echo "启动完成"
echo
echo "访问地址:"
echo "  后台:     http://localhost:${NGINX_PORT}/admin"
echo "  API:      http://localhost:${NGINX_PORT}/api/v1"
echo "  健康检查: http://localhost:${NGINX_PORT}/healthz"
echo "  API 直连: http://localhost:${API_PORT}"
echo "  Admin 直连: http://localhost:${FRONTEND_PORT}"
echo "  MinIO 控制台: http://localhost:${MINIO_CONSOLE_PORT}"
echo
echo "默认账号: admin@admin.com / admin123456"
echo
docker compose ps
