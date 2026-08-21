"""password_resets table (P5.2 自助找回密码)

Revision ID: 0038
Revises: 0037
Create Date: 2026-06-20 21:00:00

Add password_resets table for self-service password reset.
- token: 32-byte URL-safe unique token
- expires_at: 1h default
- used: prevent re-use
- ip_address: audit
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


# revision identifiers
revision: str = '0038'
down_revision: Union[str, None] = '0037'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "password_resets",
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
        sa.Column("token", sa.String(64), nullable=False, unique=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used", sa.Boolean, nullable=False, server_default=sa.text("false")),
        sa.Column("ip_address", sa.String(64), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("idx_password_resets_token", "password_resets", ["token"], unique=True)
    op.create_index("idx_password_resets_user", "password_resets", ["user_id"])


def downgrade() -> None:
    op.drop_index("idx_password_resets_user", table_name="password_resets")
    op.drop_index("idx_password_resets_token", table_name="password_resets")
    op.drop_table("password_resets")
