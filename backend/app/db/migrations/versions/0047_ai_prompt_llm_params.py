"""ai_prompts 增加 temperature / max_tokens

Revision ID: 0047
Revises: 0046
Create Date: 2026-08-24 11:40:00
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0047"
down_revision: Union[str, None] = "0046"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("ai_prompts", sa.Column("temperature", sa.Float(), nullable=True))
    op.add_column("ai_prompts", sa.Column("max_tokens", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("ai_prompts", "max_tokens")
    op.drop_column("ai_prompts", "temperature")
