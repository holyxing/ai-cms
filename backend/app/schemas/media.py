"""媒体 (Media) Pydantic schemas"""
import uuid
from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

ALLOWED_MIME = (
    "image/jpeg", "image/png", "image/gif", "image/webp", "image/svg+xml",
    "image/avif", "image/heic", "image/heif",
    "application/pdf",
    "video/mp4", "video/webm",
    "audio/mpeg", "audio/wav",
    "application/zip", "text/plain",
    # P3.9.4+ (holy 反馈 #12096): Word 文档导入 (入媒体库仅作为临时, 后端解析后入库的是图片不是 docx)
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",  # .docx
    "application/msword",  # .doc (旧版)
)

MAX_SIZE = 50 * 1024 * 1024  # 50 MB


class MediaRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    site_id: uuid.UUID
    folder_id: Optional[uuid.UUID]
    uploader_id: uuid.UUID
    uploader_name: Optional[str] = None
    filename: str
    object_key: str
    mime_type: str
    size_bytes: int
    width: Optional[int]
    height: Optional[int]
    alt_text: Optional[str]
    url: str  # public URL or presigned GET
    created_at: datetime
    updated_at: datetime


class MediaListItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    site_id: uuid.UUID
    folder_id: Optional[uuid.UUID]
    filename: str
    mime_type: str
    size_bytes: int
    width: Optional[int]
    height: Optional[int]
    alt_text: Optional[str]
    url: str
    uploader_id: uuid.UUID
    uploader_name: Optional[str] = None
    created_at: datetime


# 上传请求: 客户端先 POST 拿到 presigned URL, 然后 PUT 到 MinIO
class PresignRequest(BaseModel):
    filename: str = Field(..., min_length=1, max_length=255)
    mime_type: str = Field(..., min_length=1, max_length=128)
    size_bytes: int = Field(..., gt=0, le=MAX_SIZE)
    folder_id: Optional[uuid.UUID] = None


class PresignResponse(BaseModel):
    """客户端用此 URL PUT 文件"""

    object_key: str
    upload_url: str
    method: str = "PUT"
    expires_in: int
    public_url: str
    headers: dict = {}  # MinIO 要求的 header (e.g. Content-Type)


class MediaConfirm(BaseModel):
    """客户端上传完成后调用, 创建 Media 记录"""

    object_key: str
    filename: str
    mime_type: str
    size_bytes: int
    width: Optional[int] = None
    height: Optional[int] = None
    alt_text: Optional[str] = None
    folder_id: Optional[uuid.UUID] = None


class MediaUpdate(BaseModel):
    filename: Optional[str] = Field(None, min_length=1, max_length=255)
    alt_text: Optional[str] = None
    folder_id: Optional[uuid.UUID] = None
    is_shared: Optional[bool] = None  # P3.6.2 G


# === 引用计数 (P3.6.1) ===
class MediaUsageItem(BaseModel):
    """一个引用 (文章/模板). type 是 'content' 或 'layout'."""
    type: str
    id: str
    title: str
    # 引用上下文 (HTML 片段, 周围 30 字符)
    context: str


class MediaUsageResponse(BaseModel):
    """所有引用 + 总数 (后端在删除时检查 count > 0 要二次确认)"""
    media_id: str
    object_key: str
    count: int
    references: list[MediaUsageItem]


class MediaFolderRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    site_id: uuid.UUID
    parent_id: Optional[uuid.UUID]
    name: str
    path: str


class MediaFolderCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=128)
    parent_id: Optional[uuid.UUID] = None


# ====== P3.6.2 F: 媒体标签 ======

class MediaTagCreate(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    color: Optional[str] = Field(default=None, max_length=16)


class MediaTagUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=64)
    color: Optional[str] = Field(default=None, max_length=16)


class MediaTagRead(BaseModel):
    id: str
    site_id: str
    name: str
    color: Optional[str]
    media_count: int = 0
    created_at: datetime


class MediaTagAttach(BaseModel):
    tag_ids: list[str]  # 全量替换 (传 [] 表示清空)
