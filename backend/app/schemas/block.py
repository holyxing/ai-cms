"""首页块配置 schemas (P3.6.5+)

依据: Holy 反馈"块入口要可点击, 能编辑修改, 跟模板放一起"
设计: 4 个块存在 site.settings JSON 字段, 模板用 <HY_SITE_HERO /> 等标签读
- hero: 首页顶部 Hero 区 (标题/描述/2 个 CTA 按钮)
- stats: 4 个数字 (数字/后缀/标签)
- products: 3 个产品卡 (名称/描述/链接/图标)
- cta: 底部 CTA (标题/描述/按钮)

修改流程: 前端 LayoutEditPage 右侧栏表单 → PUT /sites/{id}/blocks/{name}
         → 写 site.settings.{name} → 改完调 /sites/{id}/publish 才生效
"""
from __future__ import annotations

from typing import Annotated, Literal, Optional

from pydantic import BaseModel, Field, field_validator


# ===========================================================================
# Hero
# ===========================================================================

class HeroCtaButton(BaseModel):
    """Hero 区的 CTA 按钮"""
    label: Annotated[str, Field(min_length=1, max_length=64)]
    href: Annotated[str, Field(min_length=1, max_length=512)]
    style: Literal["primary", "ghost"] = "primary"
    target: Literal["_self", "_blank"] = "_self"


class SiteHeroConfig(BaseModel):
    """首页 Hero 块"""
    badge: Annotated[str, Field(default="", max_length=128)] = ""
    title: Annotated[str, Field(min_length=1, max_length=128)]
    subtitle: Annotated[str, Field(default="", max_length=256)] = ""
    desc: Annotated[str, Field(default="", max_length=512)] = ""
    cta_primary: Optional[HeroCtaButton] = None
    cta_secondary: Optional[HeroCtaButton] = None

    @field_validator("title")
    @classmethod
    def no_html(cls, v: str) -> str:
        if "<" in v and ">" in v:
            raise ValueError("title 不能含 HTML 标签")
        return v.strip()


# ===========================================================================
# Stats (4 个数字)
# ===========================================================================

class StatItem(BaseModel):
    """单个数字 (data-count / data-suffix / label)"""
    value: Annotated[int, Field(ge=0, le=10_000_000)]
    suffix: Annotated[str, Field(default="", max_length=8)] = ""
    label: Annotated[str, Field(min_length=1, max_length=32)]


class SiteStatsConfig(BaseModel):
    """首页 4 个数字块"""
    items: Annotated[list[StatItem], Field(min_length=1, max_length=6)]

    @field_validator("items")
    @classmethod
    def min_one(cls, v: list[StatItem]) -> list[StatItem]:
        if not v:
            raise ValueError("stats.items 至少 1 个")
        return v


# ===========================================================================
# Products (3 个产品卡)
# ===========================================================================

class ProductItem(BaseModel):
    """单个产品卡"""
    name: Annotated[str, Field(min_length=1, max_length=32)]
    desc: Annotated[str, Field(default="", max_length=128)] = ""
    href: Annotated[str, Field(default="", max_length=512)] = ""
    icon: Annotated[str, Field(default="", max_length=8)] = ""  # emoji 或短字符


class SiteProductsConfig(BaseModel):
    """首页 3 个产品卡"""
    items: Annotated[list[ProductItem], Field(min_length=1, max_length=6)]


# ===========================================================================
# CTA (底部行动召唤)
# ===========================================================================

class SiteCtaConfig(BaseModel):
    """首页底部 CTA 块"""
    title: Annotated[str, Field(min_length=1, max_length=128)]
    desc: Annotated[str, Field(default="", max_length=256)] = ""
    cta_label: Annotated[str, Field(default="", max_length=64)] = ""
    cta_href: Annotated[str, Field(default="", max_length=512)] = ""


# ===========================================================================
# 通用: 单块更新入参
# ===========================================================================

class SiteBlockUpdate(BaseModel):
    """PUT /sites/{id}/blocks/{name} body

    content: 块配置 dict (按 name 不同 schema 不同, 这里用 dict 透传)
             Pydantic 在端点层按 name 二次验证
    """
    content: dict
