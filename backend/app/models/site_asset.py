"""站点资源 (SiteAsset) - 模板级 CSS/JS/字体/Logo/图标等

依据: docs/19-标签使用手册.md + P3.6.2 资源管理

跟 Media 表的差异:
- Media: 用户上传的**内容资源** (文章配图/PDF),走 MinIO presigned,
        详情页/列表页引用,带 alt 文字,媒体库管理
- SiteAsset: **模板/主题级静态资源** (site.css, main.js, logo.svg, swiper.js),
            随站点发布,公开 URL,被 layout/模板直接引用

字段:
- id, site_id, name (唯一名, 用于模板引用: HY_ASSET_URL site.css)
- file_path: 实际存储路径 (相对 SITE_ASSETS_DIR)
- content_type, byte_size, original_filename
- created_at, updated_at
"""
import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import (
    BigInteger, DateTime, ForeignKey, Integer, String, Text,
    UniqueConstraint, CheckConstraint, func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base
from app.models.base import TimestampMixin


def public_relpath(asset: object) -> str:
    """发布到 public/ 下的相对路径，优先 ZIP 原路径。

    例: css/main.css、assets/images/banners/hero.webp
    旧数据（只有 basename）仍落到 assets/{name}。
    """
    original = str(getattr(asset, "original_filename", "") or "").replace("\\", "/").lstrip("/")
    if original and "/" in original and ".." not in original.split("/"):
        return original
    file_path = str(getattr(asset, "file_path", "") or "").replace("\\", "/")
    site_id = str(getattr(asset, "site_id", "") or "")
    marker = f"/{site_id}/" if site_id else ""
    if marker and marker in file_path:
        rel = file_path.split(marker, 1)[1]
        if rel and ".." not in rel.split("/"):
            return rel
    name = str(getattr(asset, "name", "") or "file")
    return f"assets/{name}"


class SiteAsset(Base, TimestampMixin):
    """站点级静态资源

    存储位置: backend/ssg/site_assets/{site_id}/{category}/{name}
    公开 URL (静态发布后): /sites/{slug}/assets/{name}  (不暴露 category 子目录, 模板不感知)

    P3.6.5: 3 个内置目录
    - css/    - 样式表 (.css)
    - js/     - 脚本 (.js)
    - assets/ - 其他 (图片/字体/图标)
    """

    __tablename__ = "site_assets"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True,
        server_default="gen_random_uuid()",
    )
    site_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sites.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    # P3.6.5: 资源目录 ('css' / 'js' / 'assets')
    # 同站点 + 同 category 内 name 唯一
    category: Mapped[str] = mapped_column(
        String(16), nullable=False, default="assets",
    )
    # 资源名 (slug-style, 模板里写 HY_ASSET_URL site.css 引用)
    name: Mapped[str] = mapped_column(
        String(128), nullable=False,
    )
    # 原始文件名 (用户上传时的)
    original_filename: Mapped[str] = mapped_column(
        String(256), nullable=False,
    )
    # 相对 SITE_ASSETS_DIR 的路径
    file_path: Mapped[str] = mapped_column(
        String(512), nullable=False,
    )
    content_type: Mapped[str] = mapped_column(
        String(128), nullable=False, default="application/octet-stream",
    )
    byte_size: Mapped[int] = mapped_column(
        BigInteger, nullable=False, default=0,
    )
    # 可选: 描述/备注 (给前端显示)
    description: Mapped[Optional[str]] = mapped_column(
        Text, nullable=True,
    )

    __table_args__ = (
        UniqueConstraint("site_id", "category", "name", name="uq_site_assets_site_cat_name"),
        CheckConstraint(
            "category IN ('css', 'js', 'assets')",
            name="ck_site_assets_category",
        ),
    )
