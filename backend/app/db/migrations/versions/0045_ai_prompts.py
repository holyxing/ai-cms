"""ai_prompts 表 — Prompt 统一管理

Revision ID: 0045
Revises: 0044
Create Date: 2026-08-21 16:50:00
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "0045"
down_revision: Union[str, None] = "0044"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "ai_prompts",
        sa.Column("id", postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), primary_key=True),
        sa.Column("key", sa.String(128), nullable=False),
        sa.Column("label", sa.String(128), nullable=False),
        sa.Column("description", sa.String(512), nullable=True),
        sa.Column("category", sa.String(32), nullable=False, server_default="task"),
        sa.Column("task_type", sa.String(64), nullable=True),
        sa.Column("content", sa.Text(), nullable=False, server_default=""),
        sa.Column("builtin_content", sa.Text(), nullable=False, server_default=""),
        sa.Column("variables", postgresql.JSONB(), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("is_customized", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("updated_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("ix_ai_prompts_key", "ai_prompts", ["key"], unique=True)
    op.create_index("ix_ai_prompts_category", "ai_prompts", ["category"])


def downgrade() -> None:
    op.drop_index("ix_ai_prompts_category", table_name="ai_prompts")
    op.drop_index("ix_ai_prompts_key", table_name="ai_prompts")
    op.drop_table("ai_prompts")
