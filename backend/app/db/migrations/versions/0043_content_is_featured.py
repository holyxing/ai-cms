"""contents.is_featured — 头条标记（栏目 banner 用）

Revision ID: 0043
Revises: 0042
Create Date: 2026-08-19 14:20:00
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0043"
down_revision: Union[str, None] = "0042"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "contents",
        sa.Column(
            "is_featured",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )
    op.create_index(
        "ix_contents_site_featured",
        "contents",
        ["site_id", "is_featured"],
    )


def downgrade() -> None:
    op.drop_index("ix_contents_site_featured", table_name="contents")
    op.drop_column("contents", "is_featured")
