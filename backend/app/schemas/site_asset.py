"""站点资源 (SiteAsset) Pydantic schemas"""
import re
import uuid
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

# 资源名约束: a-z A-Z 0-9 . _ -  (例: site.css, main.js, logo.svg, font-1.woff2)
_NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
# 黑名单: 不允许的扩展名 (避免可执行文件)
_BLOCKED_EXTS = (".exe", ".bat", ".sh", ".php", ".py", ".pl", ".cgi", ".js" )


class SiteAssetRead(BaseModel):
    """单个资源返回"""
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    # P3.6.5: 资源所在目录 (css / js / assets)
    category: str
    name: str
    original_filename: str
    content_type: str
    byte_size: int
    description: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    # 公开 URL 模板 (前端直接拼: {base_url}/sites/{site_slug}/assets/{name})
    # 后端组装完整 URL 放在 url 字段
    url: str


class SiteAssetListResponse(BaseModel):
    items: list[SiteAssetRead]
    total: int


# P3.6.5: 3 个内置目录及对应允许的文件类型
ASSET_CATEGORIES = ("css", "js", "assets")

# category → 允许的扩展名 (小写)
_CATEGORY_EXTS: dict[str, tuple[str, ...]] = {
    "css": (".css",),
    "js": (".js",),
    "assets": (
        # 图片
        ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".ico", ".bmp",
        # 字体
        ".woff", ".woff2", ".ttf", ".otf", ".eot",
        # 其他静态
        ".txt", ".json", ".xml", ".pdf", ".mp4", ".webm", ".mp3",
    ),
}

# category → 强制 MIME (上传时 file.content_type 必须匹配, 不一致走服务端推断)
_CATEGORY_MIME: dict[str, tuple[str, ...]] = {
    "css": ("text/css",),
    "js": ("application/javascript", "text/javascript"),
    "assets": (  # 匹配多种
        "image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml",
        "image/x-icon", "image/bmp",
        "font/woff", "font/woff2", "font/ttf", "font/otf", "application/font-woff",
        "application/x-font-ttf",
        "text/plain", "application/json", "application/xml",
        "application/pdf", "video/mp4", "video/webm", "audio/mpeg",
    ),
}


def validate_category_for_ext(category: str, name: str) -> None:
    """上传前按 category 校验文件扩展名"""
    from fastapi import HTTPException
    if category not in ASSET_CATEGORIES:
        raise HTTPException(400, f"category 必须是 {ASSET_CATEGORIES} 之一")
    name_lower = name.lower()
    if not any(name_lower.endswith(ext) for ext in _CATEGORY_EXTS[category]):
        raise HTTPException(
            400,
            f"目录 '{category}' 不接受该扩展名 (允许: {', '.join(_CATEGORY_EXTS[category])})",
        )


def validate_category_for_mime(category: str, content_type: str) -> None:
    """上传时校验 MIME 是否跟 category 兼容"""
    from fastapi import HTTPException
    if category not in ASSET_CATEGORIES:
        raise HTTPException(400, f"category 必须是 {ASSET_CATEGORIES} 之一")
    allowed = _CATEGORY_MIME[category]
    ct = (content_type or "").lower()
    if not any(ct == m or ct.startswith(m + ";") for m in allowed):
        raise HTTPException(
            400,
            f"目录 '{category}' 不接受 MIME '{content_type}' (允许: {', '.join(allowed[:5])}, ...)",
        )


class SiteAssetUpdate(BaseModel):
    """更新元数据 (name / description). name 不可跨 category (重命名保持同 category)"""
    name: Optional[str] = Field(default=None, max_length=128)
    description: Optional[str] = Field(default=None, max_length=512)

    @field_validator("name")
    @classmethod
    def _validate_name(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        v = v.strip()
        if not _NAME_RE.match(v):
            raise ValueError(
                "name 必须以字母/数字开头, 只能含 a-zA-Z0-9._-, 最长 128 字符"
            )
        if v.lower().endswith(_BLOCKED_EXTS):
            raise ValueError(f"不允许的扩展名: {v}")
        return v


# P3.6.3: 可在线编辑的 MIME (纯文本类)
EDITABLE_MIME_PREFIXES = (
    "text/",
    "application/javascript",
    "application/json",
    "application/xml",
    "image/svg+xml",  # SVG 本质是 XML
)
EDITABLE_MAX_BYTES = 1 * 1024 * 1024  # 1MB - 模板资源一般不大


class SiteAssetContentUpdate(BaseModel):
    """在线编辑资源内容 (纯文本类: CSS/JS/JSON/XML/SVG)"""
    content: str = Field(..., min_length=1, max_length=EDITABLE_MAX_BYTES)
