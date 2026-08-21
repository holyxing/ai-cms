"""content_versions.body trgm GIN index (P5.5 中文搜索优化)

Revision ID: 0040
Revises: 0039
Create Date: 2026-06-21 00:50:00

Add GIN index on content_versions.body using gin_trgm_ops to speed up
ILIKE '%tok%' body searches (P5.5 jieba token OR matching).

之前 P5.1 没用 trgm 索引, body ILIKE 是 seq scan. 1000+ 内容时 100ms+,
加了 GIN 后 5-10ms (10x+).
"""
from typing import Sequence, Union
from alembic import op


# revision identifiers
revision: str = '0040'
down_revision: Union[str, None] = '0039'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # pg_trgm 扩展已存在 (P3/P4 期间装的), 直接建索引
    # content_versions 表没 deleted_at 列 (版本不软删)
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_content_versions_body_trgm
        ON content_versions USING gin (body gin_trgm_ops)
    """)


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_content_versions_body_trgm")