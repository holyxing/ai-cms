"""user_notifications 扩展：level / kind / duration_ms

Revision ID: 0046
Revises: 0045
Create Date: 2026-08-21 22:05:00
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0046"
down_revision: Union[str, None] = "0045"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "user_notifications",
        sa.Column("level", sa.String(length=20), nullable=False, server_default="info"),
    )
    op.add_column(
        "user_notifications",
        sa.Column("kind", sa.String(length=64), nullable=True),
    )
    op.add_column(
        "user_notifications",
        sa.Column("duration_ms", sa.Integer(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("user_notifications", "duration_ms")
    op.drop_column("user_notifications", "kind")
    op.drop_column("user_notifications", "level")
