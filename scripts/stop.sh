#!/bin/bash
# AI-CMS 一键停止：默认 docker compose stop（保留容器与数据）
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
DEPLOY_DIR="${ROOT_DIR}/deploy"

if [ ! -f "${DEPLOY_DIR}/docker-compose.yml" ]; then
  echo "错误: 找不到 ${DEPLOY_DIR}/docker-compose.yml" >&2
  exit 1
fi

if [ $# -gt 0 ] && [ "$1" != "--down" ]; then
  echo "用法: $0 [--down]" >&2
  echo "  默认: docker compose stop（停止进程，保留容器与 volume）" >&2
  echo "  --down: docker compose down（移除容器与网络，不带 -v，保护数据）" >&2
  exit 1
fi

cd "${DEPLOY_DIR}"
# 项目名由 docker-compose.yml 顶层 name: ai-cms 决定（与目录名无关）

if [ "${1:-}" = "--down" ]; then
  # 不带 -v，named volume（pg_data / minio_data 等）保留
  docker compose down
  echo "已停止并移除容器（volume / 数据已保留）"
else
  docker compose stop
  echo "已停止（容器与数据均保留，可用 ./scripts/start.sh 再启动）"
fi
