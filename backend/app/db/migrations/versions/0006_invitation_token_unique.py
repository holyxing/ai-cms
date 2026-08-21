"""add unique constraint on invitations.token

Revision ID: 0006
Revises: 0005
Create Date: 2026-06-05
"""
from alembic import op

revision = "0006"
down_revision = "0005_member_timestamps"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # token 必须全局唯一 (一次性令牌, 防 race / 重复)
    op.create_index(
        "ix_invitations_token",
        "invitations",
        ["token"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("ix_invitations_token", table_name="invitations")
