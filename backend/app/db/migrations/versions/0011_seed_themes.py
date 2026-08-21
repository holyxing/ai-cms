"""seed 5 preset themes (P2)

Revision ID: 0011
Revises: 0010
Create Date: 2026-06-05

依据: docs/04a-主题与Block-规范.md §3.1 (token shape) + §5 (5 themes)
依据: docs/12-P2-决策.md §A2 (全局库, 1 个 is_default=true)

5 主题: default / business / tech / magazine / minimal
- is_default=true 仅 default
- 4 个 token 不同 (color.*, 其他公共)
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0011"
down_revision = "0010"
branch_labels = None
depends_on = None


# 公共 token 骨架 (5 主题共用, 每个主题只覆盖 color 即可)
def _common_tokens():
    return {
        "version": 1,
        "typography": {
            "fontFamily": {
                "sans": "Inter, \"PingFang SC\", \"Microsoft YaHei\", sans-serif",
                "serif": "Georgia, \"Source Han Serif SC\", serif",
                "mono": "JetBrains Mono, Consolas, monospace",
            },
            "fontSize": {
                "xs": "0.75rem", "sm": "0.875rem", "base": "1rem",
                "lg": "1.125rem", "xl": "1.25rem", "2xl": "1.5rem",
                "3xl": "1.875rem", "4xl": "2.25rem", "5xl": "3rem",
            },
            "fontWeight": {
                "normal": 400, "medium": 500, "semibold": 600, "bold": 700,
            },
            "lineHeight": {
                "tight": "1.25", "normal": "1.5", "relaxed": "1.75",
            },
        },
        "spacing": {
            "xs": "0.25rem", "sm": "0.5rem", "md": "1rem",
            "lg": "1.5rem", "xl": "2rem", "2xl": "3rem", "3xl": "4rem",
        },
        "radius": {
            "none": "0", "sm": "0.25rem", "md": "0.5rem",
            "lg": "0.75rem", "xl": "1rem", "full": "9999px",
        },
        "shadow": {
            "sm": "0 1px 2px 0 rgba(0,0,0,0.05)",
            "md": "0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -1px rgba(0,0,0,0.06)",
            "lg": "0 10px 15px -3px rgba(0,0,0,0.1), 0 4px 6px -2px rgba(0,0,0,0.05)",
        },
    }


# AI 可改字段白名单 (JSON Schema 子集)
TOKENS_SCHEMA = {
    "editable_paths": [
        "color.*",
        "typography.fontSize.*",
        "typography.fontWeight.*",
        "typography.fontFamily.*",
        "spacing.*",
        "radius.*",
        "shadow.*",
    ],
    "color_format": "hex|rgb|rgba",
    "font_format": "css-identifier-list",
    "size_format": "rem|em|px",
}


# 5 主题 color 差异
THEMES = [
    {
        "code": "default",
        "display_name": "默认蓝",
        "is_default": True,
        "color": {
            "primary": "#3b82f6",
            "primary_hover": "#2563eb",
            "primary_foreground": "#ffffff",
            "secondary": "#8b5cf6",
            "accent": "#06b6d4",
            "background": "#ffffff",
            "surface": "#f9fafb",
            "surface_elevated": "#ffffff",
            "text": "#111827",
            "text_muted": "#6b7280",
            "text_inverse": "#ffffff",
            "border": "#e5e7eb",
            "border_strong": "#d1d5db",
            "success": "#10b981",
            "warning": "#f59e0b",
            "danger": "#ef4444",
            "info": "#3b82f6",
        },
    },
    {
        "code": "business",
        "display_name": "企业深蓝",
        "is_default": False,
        "color": {
            "primary": "#1e40af",
            "primary_hover": "#1e3a8a",
            "primary_foreground": "#ffffff",
            "secondary": "#475569",
            "accent": "#0891b2",
            "background": "#f8fafc",
            "surface": "#f1f5f9",
            "surface_elevated": "#ffffff",
            "text": "#0f172a",
            "text_muted": "#64748b",
            "text_inverse": "#ffffff",
            "border": "#cbd5e1",
            "border_strong": "#94a3b8",
            "success": "#059669",
            "warning": "#d97706",
            "danger": "#dc2626",
            "info": "#0284c7",
        },
    },
    {
        "code": "tech",
        "display_name": "极客暗色",
        "is_default": False,
        "color": {
            "primary": "#0ea5e9",
            "primary_hover": "#0284c7",
            "primary_foreground": "#ffffff",
            "secondary": "#a855f7",
            "accent": "#22d3ee",
            "background": "#0b1120",
            "surface": "#111827",
            "surface_elevated": "#1f2937",
            "text": "#e5e7eb",
            "text_muted": "#9ca3af",
            "text_inverse": "#0b1120",
            "border": "#1f2937",
            "border_strong": "#374151",
            "success": "#10b981",
            "warning": "#f59e0b",
            "danger": "#ef4444",
            "info": "#0ea5e9",
        },
    },
    {
        "code": "magazine",
        "display_name": "杂志红",
        "is_default": False,
        "color": {
            "primary": "#dc2626",
            "primary_hover": "#b91c1c",
            "primary_foreground": "#ffffff",
            "secondary": "#f59e0b",
            "accent": "#db2777",
            "background": "#ffffff",
            "surface": "#fef2f2",
            "surface_elevated": "#ffffff",
            "text": "#1c1917",
            "text_muted": "#78716c",
            "text_inverse": "#ffffff",
            "border": "#e7e5e4",
            "border_strong": "#d6d3d1",
            "success": "#16a34a",
            "warning": "#f59e0b",
            "danger": "#dc2626",
            "info": "#0ea5e9",
        },
    },
    {
        "code": "minimal",
        "display_name": "极简灰",
        "is_default": False,
        "color": {
            "primary": "#525252",
            "primary_hover": "#404040",
            "primary_foreground": "#ffffff",
            "secondary": "#737373",
            "accent": "#a3a3a3",
            "background": "#fafafa",
            "surface": "#f5f5f5",
            "surface_elevated": "#ffffff",
            "text": "#171717",
            "text_muted": "#737373",
            "text_inverse": "#ffffff",
            "border": "#e5e5e5",
            "border_strong": "#d4d4d4",
            "success": "#22c55e",
            "warning": "#eab308",
            "danger": "#ef4444",
            "info": "#3b82f6",
        },
    },
]


def upgrade() -> None:
    """插入 5 主题"""
    table = sa.table(
        "themes",
        sa.column("id", postgresql.UUID),
        sa.column("code", sa.String),
        sa.column("display_name", sa.String),
        sa.column("type", sa.String),
        sa.column("template_name", sa.String),
        sa.column("is_default", sa.Boolean),
        sa.column("default_tokens", postgresql.JSONB),
        sa.column("tokens_schema", postgresql.JSONB),
    )

    for t in THEMES:
        tokens = _common_tokens()
        tokens["color"] = t["color"]
        op.execute(
            table.insert().values(
                code=t["code"],
                display_name=t["display_name"],
                type="preset",
                template_name="default",
                is_default=t["is_default"],
                default_tokens=sa.func.cast(tokens, postgresql.JSONB),
                tokens_schema=sa.func.cast(TOKENS_SCHEMA, postgresql.JSONB),
            )
        )


def downgrade() -> None:
    """删 5 主题"""
    op.execute("DELETE FROM themes WHERE code IN ('default', 'business', 'tech', 'magazine', 'minimal')")
