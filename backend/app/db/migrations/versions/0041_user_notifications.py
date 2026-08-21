"""user_notifications table (G5 通知中心远端同步 MVP)

Revision ID: 0041
Revises: 0040
Create Date: 2026-08-17 10:40:00
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


revision: str = '0041'
down_revision: Union[str, None] = '0040'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "user_notifications",
        sa.Column(
            "id",
            UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "user_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("body", sa.Text(), nullable=True),
        sa.Column("link", sa.String(500), nullable=True),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    op.create_index(
        "idx_user_notifications_user_created",
        "user_notifications",
        ["user_id", "created_at"],
    )
    op.create_index(
        "idx_user_notifications_user_unread",
        "user_notifications",
        ["user_id", "read_at"],
    )


def downgrade() -> None:
    op.drop_index("idx_user_notifications_user_unread", table_name="user_notifications")
    op.drop_index("idx_user_notifications_user_created", table_name="user_notifications")
    op.drop_table("user_notifications")
