#!/bin/bash
# AI-CMS 一键初始化脚本
set -e

cd "$(dirname "$0")/.."

echo "🚀 AI-CMS 初始化"

# 1. 检查 .env
if [ ! -f deploy/.env ]; then
    echo "📝 创建 .env (从 .env.example)"
    cp deploy/.env.example deploy/.env
    echo "⚠️  请编辑 deploy/.env 修改密码和密钥"
fi

# 2. 启动基础服务（不含 ai）
echo "🐳 启动 Docker 容器..."
cd deploy
docker compose up -d postgres redis minio

echo "⏳ 等待服务就绪..."
sleep 5

# 3. 启动应用
echo "🚀 启动应用服务..."
docker compose up -d --build

echo ""
echo "✅ 启动完成！"
echo ""
echo "📍 访问地址:"
echo "  - 后台:  http://localhost/admin/"
echo "  - API:   http://localhost/api/v1/"
echo "  - 健康:  http://localhost/healthz"
echo "  - MinIO: http://localhost:9001 (控制台)"
echo ""
echo "🔑 默认账号: 见首次启动日志 (admin@admin.com / admin)"
