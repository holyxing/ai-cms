"""contents.banner_image — Banner 图（与缩略图 cover_image 分离）

Revision ID: 0044
Revises: 0043
Create Date: 2026-08-19 14:40:00
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0044"
down_revision: Union[str, None] = "0043"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "contents",
        sa.Column("banner_image", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("contents", "banner_image")
