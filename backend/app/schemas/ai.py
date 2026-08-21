"""AI 模块 Pydantic schemas (P3.0)

依据: docs/02-API-规范.md (统一响应格式)
"""
from datetime import datetime
from decimal import Decimal
from typing import Any, Optional, Union
from uuid import UUID

from pydantic import BaseModel, Field, field_validator


# ====== Provider ======
class AIProviderCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=64)
    provider: str = Field(..., pattern="^(openai|anthropic|ollama|minimax|custom)$")
    model: str = Field(..., min_length=1, max_length=128)
    base_url: Optional[str] = None
    api_key: Optional[str] = None
    is_default: bool = False
    extra_config: Optional[dict] = None


class AIProviderOut(BaseModel):
    id: UUID
    name: str
    provider: str
    model: str
    base_url: Optional[str]
    is_default: bool
    is_configured: bool = False  # P3.1: 是否配置了 api_key (不返明文)
    extra_config: Optional[dict] = None
    created_at: datetime

    class Config:
        from_attributes = True


# ====== Run ======
class AIRewriteStart(BaseModel):
    """AI 改写 启动请求 (P3.0 兼容)"""
    site_id: Optional[UUID] = None
    original_text: str = Field(..., min_length=1, max_length=8000)
    operation: str = Field(default="rewrite")
    target_language: Optional[str] = None
    content_id: Optional[UUID] = None
    provider_id: Optional[UUID] = None
    model: Optional[str] = None

    @field_validator("operation")
    @classmethod
    def _check_op(cls, v: str) -> str:
        valid = ("rewrite", "expand", "shorten", "polish", "translate")
        if v not in valid:
            raise ValueError(f"operation 必须是 {valid} 之一")
        return v


class AITaskStart(BaseModel):
    """AI 任务 启动请求 (P3.1 通用: rewrite/expand/shorten/polish/translate/draft)

    P3.1 简化: 不再分多个端点, 一律走 POST /ai/tasks/{task_type}/start
    各任务的 input schema 略有差异 (draft 要 word_count, translate 要 target_language)
    用 extra='allow' 接收多余字段, worker 端按 task_type 校验
    """
    site_id: Optional[UUID] = None
    content_id: Optional[UUID] = None
    provider_id: Optional[UUID] = None
    model: Optional[str] = None
    # 任务参数 (根据 task_type 不同而不同)
    # P3.1 兼容: 前端 wrapper 可能传 string (裸文本) 或 dict ({original_text, ...})
    input: Union[str, dict] = Field(default_factory=dict)
    # P3.9 redesign 专用 (optimize_design/responsive/a11y/seo)
    layout_id: Optional[UUID] = None
    design_lang: Optional[str] = Field(default=None, max_length=32)  # github/linear/notion/transwarp
    # P3.9.6+ (holy 反馈 #12444): site_agent 多轮对话关联 ID
    conversation_id: Optional[UUID] = None

    class Config:
        extra = "allow"


class AIRunOut(BaseModel):
    id: UUID
    task_type: str
    status: str
    current_step: Optional[str] = None
    steps_total: Optional[int] = None
    steps_done: int
    input: dict
    output: Optional[dict] = None
    model: Optional[str] = None
    prompt_tokens: Optional[int] = None
    completion_tokens: Optional[int] = None
    cost_usd: Optional[Decimal] = None
    error_message: Optional[str] = None
    started_at: Optional[datetime] = None
    finished_at: Optional[datetime] = None
    layout_id: Optional[UUID] = None  # P3.9
    design_lang: Optional[str] = None  # P3.9
    diff_html: Optional[str] = None  # P3.9
    diff_stats: Optional[dict] = None  # P3.9
    created_at: datetime

    class Config:
        from_attributes = True


class AIRunListOut(BaseModel):
    items: list[AIRunOut]
    total: int
    page: int
    page_size: int


class AIRunAcceptIn(BaseModel):
    """接受 AI 改写结果 — 写入 content_versions"""
    content_id: Optional[UUID] = None
    title: Optional[str] = None  # 仅新建内容时用


class AIRunRejectOut(BaseModel):
    """拒绝 AI 结果"""
    run_id: UUID
    status: str


class AIRunAcceptOut(BaseModel):
    run_id: UUID
    content_id: UUID
    version: int
    accepted_text: str
