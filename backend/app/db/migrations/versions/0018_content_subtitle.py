"""P3.5.2 副标题字段 (contents.subtitle)

依据: docs/13-P3-进度.md P3.5.2 (属性补全)
- 副标题: 可选, 255 字符上限
- 跟 title 一起展示, 也可作为 SEO meta description 的兜底
"""
from alembic import op
import sqlalchemy as sa

revision = "0018"
down_revision = "0017"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "contents",
        sa.Column("subtitle", sa.String(255), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("contents", "subtitle")
