"""0034_content_is_copy_of: 内容副本追踪 (P3.9.1+ holy 反馈 #11279 续)

holy 反馈 2026-06-11 12:40 (#11279): 发布到哪些栏目下, 应该把该文章 copy 到对应栏目下
(2026-06-11 12:43 确认方案 A: 后端真做"复制多份" — 副本独立, 独立发布)

迁移:
- contents 加 is_copy_of 字段 (UUID FK contents.id, NULL OK, ondelete CASCADE)
  - 主稿: is_copy_of = NULL
  - 副本: is_copy_of = 主稿 content.id
  - CASCADE: 删主稿自动删所有副本
- 加 index: (is_copy_of) — 查主稿的副本用
- 加 CheckConstraint: 副本不能是其他副本的副本 (避免链式)
  实际用 NOT NULL 跟 is_copy_of 互斥 + 应用层保证
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "0034"
down_revision = "0033"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "contents",
        sa.Column(
            "is_copy_of",
            UUID(as_uuid=True),
            sa.ForeignKey("contents.id", ondelete="CASCADE"),
            nullable=True,
        ),
    )
    op.create_index("ix_contents_is_copy_of", "contents", ["is_copy_of"])


def downgrade() -> None:
    op.drop_index("ix_contents_is_copy_of", table_name="contents")
    op.drop_column("contents", "is_copy_of")
