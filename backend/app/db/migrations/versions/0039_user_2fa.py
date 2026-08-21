"""user_2fa table (P5.4 2FA TOTP)

Revision ID: 0039
Revises: 0038
Create Date: 2026-06-20 23:40:00

Add user_2fa table for TOTP-based two-factor authentication.
- secret_encrypted: Fernet-encrypted base32 TOTP secret (32 chars)
- is_enabled: only effective after verify-setup; before that it's just a pending setup
- enabled_at: timestamp of verify-setup
- recovery_codes: bcrypt hashes of 8 single-use recovery codes (JSON list of strings)
- last_used_step: last TOTP step consumed (replay protection)
- failed_attempts: brute force counter (5 attempts = lock 5min)
- locked_until: timestamp until which verify is rejected
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


# revision identifiers
revision: str = '0039'
down_revision: Union[str, None] = '0038'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "user_2fa",
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
            unique=True,
        ),
        # Fernet-encrypted base32 secret (encrypt-then-base64, ~140 chars)
        sa.Column("secret_encrypted", sa.String(512), nullable=False),
        # True only after verify-setup. Setup phase has is_enabled=False
        sa.Column("is_enabled", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("enabled_at", sa.DateTime(timezone=True), nullable=True),
        # bcrypt hashes of 8 recovery codes (JSON list of ~60-char bcrypt strings)
        sa.Column("recovery_codes", sa.Text(), nullable=False, server_default="[]"),
        # Last TOTP step consumed (int, 30-second steps since epoch, replay protection)
        sa.Column("last_used_step", sa.BigInteger(), nullable=False, server_default=sa.text("0")),
        # Brute force protection
        sa.Column("failed_attempts", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("locked_until", sa.DateTime(timezone=True), nullable=True),
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
    op.create_index("idx_user_2fa_user", "user_2fa", ["user_id"], unique=True)


def downgrade() -> None:
    op.drop_index("idx_user_2fa_user", table_name="user_2fa")
    op.drop_table("user_2fa")