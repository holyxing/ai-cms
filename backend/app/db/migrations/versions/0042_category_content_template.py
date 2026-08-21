"""add category content_template (P3.9.5)

Revision ID: 0042
Revises: 0041
Create Date: 2026-08-18 17:50:00
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0042"
down_revision: Union[str, None] = "0041"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "categories",
        sa.Column("content_template", sa.String(length=64), nullable=False, server_default="default"),
    )


def downgrade() -> None:
    op.drop_column("categories", "content_template")
