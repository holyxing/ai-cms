"""MinIO 客户端封装

用于: 媒体上传 (presigned URL)
"""
import secrets
from datetime import timedelta
from typing import Optional
from urllib.parse import urlparse

from minio import Minio
from minio.error import S3Error

from app.core.config import get_settings

settings = get_settings()

_client: Optional[Minio] = None


def get_minio() -> Minio:
    global _client
    if _client is None:
        _client = Minio(
            settings.MINIO_ENDPOINT,
            access_key=settings.MINIO_ACCESS_KEY,
            secret_key=settings.MINIO_SECRET_KEY,
            secure=settings.MINIO_SECURE,
        )
    return _client


def ensure_bucket() -> None:
    """确保 bucket 存在, 不存在则创建"""
    client = get_minio()
    if not client.bucket_exists(settings.MINIO_BUCKET):
        client.make_bucket(settings.MINIO_BUCKET)


def make_object_key(site_id: str, ext: str) -> str:
    """生成 MinIO object key, 避免冲突

    格式: sites/<site_id>/<yyyy>/<mm>/<random>.<ext>
    """
    from datetime import datetime
    now = datetime.utcnow()
    rand = secrets.token_urlsafe(8)
    return f"sites/{site_id}/{now.year}/{now.month:02d}/{rand}{ext}"


def presign_put_url(object_key: str, content_type: str, expires_seconds: int = 600) -> dict:
    """生成 presigned PUT URL, 客户端用此 URL 直传文件"""
    client = get_minio()
    url = client.presigned_put_object(
        settings.MINIO_BUCKET, object_key,
        expires=timedelta(seconds=expires_seconds),
    )
    return {
        "upload_url": url,
        "method": "PUT",
        "expires_in": expires_seconds,
        "public_url": f"{settings.MINIO_PUBLIC_URL}/{settings.MINIO_BUCKET}/{object_key}",
        "headers": {"Content-Type": content_type},
    }


def presign_get_url(object_key: str, expires_seconds: int = 3600) -> str:
    """生成 presigned GET URL (用于下载/预览)

    签名用 MINIO_ENDPOINT (minio:9000),
    URL 返回时换 host 为 MINIO_PUBLIC_URL (可为相对路径如 /media)
    nginx /media/ -> minio:9000 时设 Host=minio:9000 (匹配签名)
    """
    from urllib.parse import urlparse
    client = get_minio()
    url = client.presigned_get_object(
        settings.MINIO_BUCKET, object_key,
        expires=timedelta(seconds=expires_seconds),
    )
    p = urlparse(settings.MINIO_PUBLIC_URL)
    parsed = urlparse(url)
    # MINIO_PUBLIC_URL 可为绝对 URL (http://host/media) 或相对路径 (/media)
    # 相对路径时 p.scheme/p.netloc 为空, 跳前缀
    if p.scheme and p.netloc:
        prefix = f"{p.scheme}://{p.netloc}"
    elif p.scheme:
        prefix = p.scheme + ":"
    else:
        prefix = ""
    return f"{prefix}{parsed.path}{'?' + parsed.query if parsed.query else ''}"


def remove_object(object_key: str) -> None:
    """删除 MinIO 中的对象 (软删表 + 真删文件)"""
    client = get_minio()
    try:
        client.remove_object(settings.MINIO_BUCKET, object_key)
    except S3Error as e:
        import logging
        logging.warning(f"MinIO 删除失败 {object_key}: {e}")


def object_exists(object_key: str) -> bool:
    """检查 object 是否存在 (confirm 时验证客户端真的上传了)"""
    client = get_minio()
    try:
        client.stat_object(settings.MINIO_BUCKET, object_key)
        return True
    except S3Error:
        return False


def put_bytes(object_key: str, data: bytes, content_type: str) -> None:
    """直接 put 字节流 (P3.6.2 缩略图: worker 生成 webp 后上传)"""
    from io import BytesIO
    client = get_minio()
    client.put_object(
        settings.MINIO_BUCKET, object_key,
        BytesIO(data), length=len(data),
        content_type=content_type,
    )


def thumb_object_key(original_key: str, size: int) -> str:
    """缩略图 key 规则: 替换扩展名为 .thumb.<size>.webp
    例: sites/abc/2026/06/xyz.png -> sites/abc/2026/06/xyz.thumb.200.webp
    """
    import os
    base, _ = os.path.splitext(original_key)
    return f"{base}.thumb.{size}.webp"
