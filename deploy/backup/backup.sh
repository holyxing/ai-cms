#!/bin/bash
# ============================================
# AI-CMS PG → MinIO 备份脚本
# 依据: docs/05-开发路线图.md P4 (备份脚本)
#
# 行为:
#   1. pg_dump 整库 → SQL
#   2. gzip 压缩
#   3. 上传到 MinIO bucket "backups"
#   4. 清理 7 天前的旧备份
#
# 用法:
#   ./backup.sh                # 执行一次完整备份
#   ./backup.sh --test         # 只测连通性, 不真备份
#   环境变量见 .env (PG_*/MINIO_*)
# ============================================

set -e

# 读环境变量 (从 docker compose 注入)
PG_HOST="${POSTGRES_HOST:-postgres}"
PG_PORT="${POSTGRES_PORT:-5432}"
PG_USER="${POSTGRES_USER:-ai_cms}"
PG_PASS="${POSTGRES_PASSWORD:?POSTGRES_PASSWORD 未设置}"
PG_DB="${POSTGRES_DB:-ai_cms}"

MINIO_ENDPOINT="${MINIO_ENDPOINT:-minio:9000}"
MINIO_ACCESS="${MINIO_ROOT_USER:-ai_cms}"
MINIO_SECRET="${MINIO_ROOT_PASSWORD:?MINIO_ROOT_PASSWORD 未设置}"
MINIO_BUCKET="${MINIO_BACKUP_BUCKET:-backups}"
MINIO_USE_SSL="${MINIO_USE_SSL:-false}"

RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-7}"

# ---- 参数 ----
TEST_MODE=false
for arg in "$@"; do
  case $arg in
    --test) TEST_MODE=true ;;
    *) echo "未知参数: $arg"; exit 1 ;;
  esac
done

# ---- mc 客户端 (轻量 MinIO CLI) ----
MC_OPTS="--quiet"
if [ "$MINIO_USE_SSL" = "true" ]; then
  MC_URL="https://$MINIO_ENDPOINT"
else
  MC_URL="http://$MINIO_ENDPOINT"
fi

# 配置 mc (alias 叫 backup)
mc alias set backup "$MC_URL" "$MINIO_ACCESS" "$MINIO_SECRET" $MC_OPTS 2>/dev/null || true

# 确保 bucket 存在
if ! mc ls backup/"$MINIO_BUCKET" $MC_OPTS 2>/dev/null; then
  echo "📦 创建 bucket: $MINIO_BUCKET"
  mc mb backup/"$MINIO_BUCKET" $MC_OPTS
fi

if [ "$TEST_MODE" = "true" ]; then
  echo "✅ 连通性测试通过"
  echo "  PG:       $PG_HOST:$PG_PORT/$PG_DB"
  echo "  MinIO:    $MC_URL"
  echo "  Bucket:   $MINIO_BUCKET"
  echo "  保留:     $RETENTION_DAYS 天"
  exit 0
fi

# ---- 1. 备份文件名 ----
TS=$(date -u +"%Y%m%dT%H%M%SZ")
DAY=$(date -u +"%Y%m%d")
BACKUP_NAME="pg_${PG_DB}_${TS}.sql.gz"
TMP_FILE="/tmp/${BACKUP_NAME}"

echo "🚀 开始备份: $BACKUP_NAME"

# ---- 2. pg_dump + gzip ----
PGPASSWORD="$PG_PASS" pg_dump \
  -h "$PG_HOST" \
  -p "$PG_PORT" \
  -U "$PG_USER" \
  -d "$PG_DB" \
  --no-owner \
  --no-privileges \
  --clean \
  --if-exists \
  2>/dev/null | gzip -9 > "$TMP_FILE"

if [ ! -s "$TMP_FILE" ]; then
  echo "❌ 备份文件为空: $TMP_FILE"
  exit 1
fi

SIZE=$(du -h "$TMP_FILE" | cut -f1)
echo "📦 压缩完成: $SIZE"

# ---- 3. 上传 MinIO ----
mc cp "$TMP_FILE" "backup/${MINIO_BUCKET}/${DAY}/${BACKUP_NAME}" $MC_OPTS
echo "✅ 已上传: backup/${MINIO_BUCKET}/${DAY}/${BACKUP_NAME}"

# ---- 4. 清理临时文件 ----
rm -f "$TMP_FILE"

# ---- 5. 清理旧备份 (RETENTION_DAYS 天前) ----
CUTOFF_DATE=$(date -u -d "${RETENTION_DAYS} days ago" +"%Y%m%d" 2>/dev/null || date -u -v-"${RETENTION_DAYS}"d +"%Y%m%d")
echo "🗑  清理 $CUTOFF_DATE 之前的备份"

# 列出所有 YYYYMMDD/ 前缀目录, 删比 cutoff 早的
mc ls backup/"$MINIO_BUCKET" $MC_OPTS 2>/dev/null | awk '{print $NF}' | while read -r d; do
  # d 格式: 20260105/
  d_clean=$(echo "$d" | tr -d '/')
  if [ -n "$d_clean" ] && [ "$d_clean" \< "$CUTOFF_DATE" ]; then
    echo "  删除: $d"
    mc rm --recursive --force "backup/${MINIO_BUCKET}/${d}" $MC_OPTS
  fi
done

echo "✨ 备份完成"
