"""0026_media_global: 全局素材库 (跨站共享)

P3.6.2 G 决策:
- media.is_shared BOOL default false
- is_shared=true 的媒体对所有站可见, 但 site_id 仍存"来源站" (用于统计 + 引用来源)
- 普通用户在自己 site 可读共享池 (只读)
- super_admin 可上传/删除共享池媒体
"""
from alembic import op
import sqlalchemy as sa

revision = "0026"
down_revision = "0025"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "media",
        sa.Column(
            "is_shared",
            sa.Boolean,
            nullable=False,
            server_default=sa.text("false"),
        ),
    )
    op.create_index(
        "ix_media_is_shared",
        "media", ["is_shared"],
        postgresql_where=sa.text("is_shared = true"),
    )


def downgrade() -> None:
    op.drop_index("ix_media_is_shared", table_name="media")
    op.drop_column("media", "is_shared")
