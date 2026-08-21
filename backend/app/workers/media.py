"""媒体 worker 任务 (P3.6.2 E)

- generate_thumbnails: 拉取原图 -> Pillow 生成 webp 200/800 -> 上传 MinIO -> 更新 DB
"""
import logging
from io import BytesIO

from sqlalchemy import select
from PIL import Image, ImageOps

from app.core.config import get_settings
from app.db.session import AsyncSessionLocal, engine
from app.models.media import Media
from app.services import minio_client
from app.workers.celery_app import celery_app

settings = get_settings()
log = logging.getLogger(__name__)

# 缩略图规格: (name, max_size_px)
THUMB_SPECS = [
    ("small", 200),
    ("large", 800),
]

# 只对图像 mime 处理
IMAGE_MIME_PREFIX = "image/"


def _make_webp(src_bytes: bytes, max_size: int) -> bytes:
    """Pillow 处理: 自动旋转 EXIF, 等比缩放, 编码 webp 80%"""
    img = Image.open(BytesIO(src_bytes))
    img = ImageOps.exif_transpose(img)  # 修正 iPhone 竖图方向
    img.thumbnail((max_size, max_size), Image.LANCZOS)
    # 统一转 RGB (RGBA/P 模式 webp 也支持, 这里稳一点 RGB)
    if img.mode not in ("RGB", "RGBA"):
        img = img.convert("RGB")
    buf = BytesIO()
    img.save(buf, format="WEBP", quality=80, method=6)
    return buf.getvalue()


async def _run_generate(media_id: str) -> dict:
    """async 主体: 缩略图生成全流程 (单独 event loop 跑)"""
    async with AsyncSessionLocal() as db:
        r = await db.execute(select(Media).where(Media.id == media_id))
        m = r.scalar_one_or_none()
        if not m or m.deleted_at:
            log.info(f"media {media_id} 不存在或已删, 跳过")
            return {"skipped": "deleted"}

        if not m.mime_type.startswith(IMAGE_MIME_PREFIX):
            # 非图片 (pdf/zip/mp4 等) 不生成缩略图
            m.thumb_status = "done"
            m.thumb_small_key = None
            m.thumb_large_key = None
            await db.commit()
            log.info(f"media {media_id} 非图片 ({m.mime_type}), 标记 done")
            return {"skipped": "non_image"}

        # 1. 拉原图
        client = minio_client.get_minio()
        resp = client.get_object(settings.MINIO_BUCKET, m.object_key)
        src_bytes = resp.read()
        resp.close()
        resp.release_conn()

        # 2. 生成 200/800 (Pillow 是 sync, 不冲突)
        try:
            small_key = minio_client.thumb_object_key(m.object_key, 200)
            large_key = minio_client.thumb_object_key(m.object_key, 800)
            minio_client.put_bytes(small_key, _make_webp(src_bytes, 200), "image/webp")
            minio_client.put_bytes(large_key, _make_webp(src_bytes, 800), "image/webp")
        except Exception as e:
            # AVIF/HEIC 等 Pillow 无法解码时明确失败, 不 500
            log.warning(f"media {media_id} 缩略图解码失败 ({m.mime_type}): {e}")
            m.thumb_status = "failed"
            await db.commit()
            return {"failed": f"无法解码该图片格式: {e}"}

        # 3. 更新 DB
        m.thumb_small_key = small_key
        m.thumb_large_key = large_key
        m.thumb_status = "done"
        await db.commit()
        log.info(f"media {media_id} 缩略图生成完成: small={small_key}, large={large_key}")
        return {"small": small_key, "large": large_key}


async def _mark_failed(media_id: str) -> None:
    async with AsyncSessionLocal() as db:
        r = await db.execute(select(Media).where(Media.id == media_id))
        m = r.scalar_one_or_none()
        if m and not m.deleted_at:
            m.thumb_status = "failed"
            await db.commit()


@celery_app.task(
    name="app.workers.media.generate_thumbnails",
    bind=True,
    max_retries=2,
    default_retry_delay=30,
)
def generate_thumbnails(self, media_id: str) -> dict:
    """为单个 media 记录生成缩略图 (用独立 event loop 避 celery 冲突)"""
    import asyncio
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        # dispose engine 避免上个 loop 的连接池残留
        try:
            loop.run_until_complete(engine.dispose())
        except Exception:
            pass
        result = loop.run_until_complete(_run_generate(media_id))
        # 任务完成后再次 dispose, 主动关闭连接 (避免 'Event loop is closed')
        try:
            loop.run_until_complete(engine.dispose())
        except Exception:
            pass
        return result
    except Exception as exc:
        log.exception(f"media {media_id} 缩略图生成失败: {exc}")
        try:
            self.retry(exc=exc)
        except self.MaxRetriesExceededError:
            # 标记 failed (独立小 loop)
            try:
                loop2 = asyncio.new_event_loop()
                asyncio.set_event_loop(loop2)
                loop2.run_until_complete(_mark_failed(media_id))
                loop2.close()
            except Exception as e:
                log.error(f"标记 failed 也失败: {e}")
            log.error(f"media {media_id} 缩略图生成最终失败, 已标记 failed")
            return {"failed": str(exc)}
    finally:
        try:
            loop.close()
        except Exception:
            pass
