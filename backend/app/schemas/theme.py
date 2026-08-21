"""主题 (Theme) Pydantic schemas

依据: docs/04b-数据模型.md §4.1
      docs/12-P2-决策.md §A2 (全局库) + §F2 (token sanitize)
"""
import re
import uuid
from datetime import datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

# 颜色格式白名单 (F2 决策: 注入防 XSS)
COLOR_PATTERN = re.compile(r"^(#[0-9a-fA-F]{3,8}|rgb\([^)]+\)|rgba\([^)]+\)|hsl\([^)]+\)|hsla\([^)]+\))$")
# font family 安全字符
FONT_FAMILY_PATTERN = re.compile(r"^[a-zA-Z0-9,\s\"\-_]+$")
# size: rem / em / px
SIZE_PATTERN = re.compile(r"^\d+(\.\d+)?(rem|em|px|%)$")
# 危险字符
FORBIDDEN_CHARS = re.compile(r"[<>'\"`/\\]")


class ThemeBase(BaseModel):
    code: Annotated[str, Field(min_length=1, max_length=64, pattern=r"^[a-z0-9-]+$")]
    display_name: Annotated[str, Field(min_length=1, max_length=128)]
    template_name: Annotated[str, Field(min_length=1, max_length=64)]
    preview_image: str | None = None


class ThemeCreate(ThemeBase):
    """创建主题 (custom)"""

    type: Literal["custom"] = "custom"
    base_theme_id: uuid.UUID | None = None
    default_tokens: dict[str, Any]
    tokens_schema: dict[str, Any] = Field(default_factory=dict)


class ThemeUpdate(BaseModel):
    """更新主题 (custom 可改, preset 不可改)"""

    display_name: str | None = Field(default=None, min_length=1, max_length=128)
    preview_image: str | None = None


class ThemeRead(ThemeBase):
    """主题详情"""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    type: str
    base_theme_id: uuid.UUID | None
    is_default: bool
    default_tokens: dict[str, Any]
    tokens_schema: dict[str, Any]
    created_at: datetime
    updated_at: datetime


class ThemeListItem(BaseModel):
    """主题列表项 (含预览 + 颜色统计)"""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    code: str
    display_name: str
    type: str
    template_name: str
    preview_image: str | None
    is_default: bool
    color_count: int = 0
    primary_color: str | None = None
    # P3.10.4: layout edit 页 AI theme 兑底需要 default_tokens (site 未应用主题时用)
    default_tokens: dict[str, Any] = Field(default_factory=dict)


# === Token sanitize (F2 决策) ===
def validate_tokens(tokens: dict[str, Any]) -> dict[str, Any]:
    """递归校验 token 值, 拒绝包含 < > ' \" ` / \\ 等字符

    用于 PUT /themes/current 写入前
    """
    def _check(v: Any, path: str) -> None:
        if isinstance(v, str):
            if FORBIDDEN_CHARS.search(v):
                raise ValueError(f"{path}: 含禁用字符 (< > ' \" ` / \\)")
            # color.* 必须是合法颜色
            if path.startswith("color."):
                if not COLOR_PATTERN.match(v):
                    raise ValueError(f"{path}: 颜色格式必须为 hex/rgb/rgba/hsl")
            # typography.fontSize.* / spacing.* / radius.* / shadow.* 长度限制
            if path.startswith(("typography.fontSize.", "spacing.", "radius.")):
                if not SIZE_PATTERN.match(v) and not v.startswith("0"):
                    # 允许 "0" 作为半径
                    if not (path.startswith("radius.") and v == "0"):
                        raise ValueError(f"{path}: 尺寸必须为 rem/em/px/%")
            # typography.fontFamily.* 限制字符集
            if path.startswith("typography.fontFamily."):
                if not FONT_FAMILY_PATTERN.match(v):
                    raise ValueError(f"{path}: 字体名含非法字符")
        elif isinstance(v, dict):
            for k, vv in v.items():
                _check(vv, f"{path}.{k}" if path else k)
        elif isinstance(v, list):
            for i, vv in enumerate(v):
                _check(vv, f"{path}[{i}]")

    _check(tokens, "")
    return tokens
