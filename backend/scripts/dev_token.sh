#!/usr/bin/env bash
# 生成/读取开发用 access token (24h 有效, 缓存到 .dev_token 文件避免重复生成)
#
# 用法:
#   source backend/scripts/dev_token.sh                  # 设 $DEV_TOKEN
#   bash backend/scripts/dev_token.sh                    # 打印
#   $(bash backend/scripts/dev_token.sh)                 # 取值
#   export DEV_TOKEN=$(bash backend/scripts/dev_token.sh)
#
# 缓存位置: /Users/mini_holy/.openclaw/workspace/.dev_token (项目根)
# 失效: 超过 23h 自动重生成; 容器重建后需要重生成 (detect by checking token 解码)
#
# 邮件: 默认 holy@aicms.io (可覆盖: DEV_USER_EMAIL=xxx bash dev_token.sh)
set -e

# 项目根 = 脚本所在目录的 ../
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
TOKEN_FILE="$PROJECT_ROOT/.dev_token"
EMAIL="${DEV_USER_EMAIL:-holy@aicms.io}"
MAX_AGE=82800  # 23 小时 (24h - 1h buffer)

# === 1. 检查缓存 ===
if [ -f "$TOKEN_FILE" ]; then
    file_mtime=$(stat -f %m "$TOKEN_FILE" 2>/dev/null || stat -c %Y "$TOKEN_FILE" 2>/dev/null || echo 0)
    now=$(date +%s)
    age=$((now - file_mtime))
    if [ "$age" -lt "$MAX_AGE" ]; then
        TOKEN=$(cat "$TOKEN_FILE")
        # 快速验证 token 还能用 (要查 token 的端点, 不要用 /healthz, 不查 token 永远 200)
        if curl -sf -o /dev/null -H "Authorization: Bearer $TOKEN" "http://localhost:18888/api/v1/auth/me" 2>/dev/null; then
            export DEV_TOKEN="$TOKEN"
            # 总是输出 token 到 stdout (source 模式也方便取值)
            echo "$TOKEN"
            return 0 2>/dev/null || exit 0
        fi
        # 失败 → 删除缓存, 重生成
        rm -f "$TOKEN_FILE"
    else
        rm -f "$TOKEN_FILE"
    fi
fi

# === 2. 生成新 token ===
TOKEN=$(docker compose -f "$PROJECT_ROOT/deploy/docker-compose.yml" exec -T api python -c "
import asyncio
from app.core.security import create_access_token
from app.models.user import User
from app.db.session import AsyncSessionLocal
from sqlalchemy import select

async def main():
    async with AsyncSessionLocal() as db:
        rs = await db.execute(select(User).where(User.email=='$EMAIL'))
        u = rs.scalar_one()
        print(create_access_token(str(u.id)))

asyncio.run(main())
" 2>/dev/null | tail -1)

if [ -z "$TOKEN" ]; then
    echo "[error] token 生成失败 (容器未起来? 用户不存在?)" >&2
    exit 1
fi

# 缓存
echo "$TOKEN" > "$TOKEN_FILE"
chmod 600 "$TOKEN_FILE"

export DEV_TOKEN="$TOKEN"
# 输出 token 到 stdout
echo "$TOKEN"
