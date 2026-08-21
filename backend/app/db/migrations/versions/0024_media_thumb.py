"""0024_media_thumb: 媒体缩略图

P3.6.2 E 决策: 上传时 worker 异步生成 webp 200/800 缩略图
- media.thumb_small_key  : 200px (列表/卡片)
- media.thumb_large_key  : 800px (详情/预览)
- media.thumb_status     : 'pending' / 'done' / 'failed'
- media.width / height 已存在, 复用存原图尺寸
"""
from alembic import op
import sqlalchemy as sa

revision = "0024"
down_revision = "0023"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "media",
        sa.Column("thumb_small_key", sa.String(512), nullable=True),
    )
    op.add_column(
        "media",
        sa.Column("thumb_large_key", sa.String(512), nullable=True),
    )
    op.add_column(
        "media",
        sa.Column(
            "thumb_status",
            sa.String(16),
            nullable=False,
            server_default="pending",
        ),
    )
    op.create_check_constraint(
        "ck_media_thumb_status",
        "media",
        "thumb_status IN ('pending', 'done', 'failed')",
    )


def downgrade() -> None:
    op.drop_constraint("ck_media_thumb_status", "media", type_="check")
    op.drop_column("media", "thumb_status")
    op.drop_column("media", "thumb_large_key")
    op.drop_column("media", "thumb_small_key")
