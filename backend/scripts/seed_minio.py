"""初始化 MinIO bucket (启动时执行)"""
import sys

from loguru import logger
from minio import Minio
from minio.error import S3Error

from app.core.config import get_settings


def ensure_bucket(bucket: str):
    settings = get_settings()
    client = Minio(
        settings.MINIO_ENDPOINT,
        access_key=settings.MINIO_ACCESS_KEY,
        secret_key=settings.MINIO_SECRET_KEY,
        secure=settings.MINIO_SECURE,
    )
    try:
        if not client.bucket_exists(bucket):
            client.make_bucket(bucket)
            logger.info(f"✅ 创建 MinIO bucket: {bucket}")
        else:
            logger.info(f"✅ MinIO bucket 已存在: {bucket}")
    except S3Error as e:
        logger.error(f"❌ MinIO 错误: {e}")
        sys.exit(1)
    except Exception as e:
        logger.error(f"❌ MinIO 连接失败: {e}")
        # 不强制退出, 让服务先起来
        logger.warning("⚠️  跳过 MinIO 初始化")


if __name__ == "__main__":
    settings = get_settings()
    logger.info(f"MinIO: {settings.MINIO_ENDPOINT}")
    ensure_bucket(settings.MINIO_BUCKET)
