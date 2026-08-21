"""0025_media_tags: 媒体标签系统

P3.6.2 F 决策: 标签是站级命名空间 (site-scoped)
- media_tags 表: id, site_id, name (unique per site), color, created_at
- media_tag_links 表: N:N, media_id ↔ media_tag_id, PRIMARY KEY (media_id, media_tag_id)
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "0025"
down_revision = "0024"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "media_tags",
        sa.Column(
            "id", UUID(as_uuid=True), primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "site_id", UUID(as_uuid=True),
            sa.ForeignKey("sites.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(64), nullable=False),
        sa.Column("color", sa.String(16), nullable=True),  # 例: #2563eb
        sa.Column(
            "created_at", sa.DateTime(timezone=True),
            nullable=False, server_default="NOW()",
        ),
        sa.UniqueConstraint("site_id", "name", name="uq_media_tags_site_name"),
    )
    op.create_index("ix_media_tags_site_id", "media_tags", ["site_id"])

    op.create_table(
        "media_tag_links",
        sa.Column(
            "media_id", UUID(as_uuid=True),
            sa.ForeignKey("media.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "media_tag_id", UUID(as_uuid=True),
            sa.ForeignKey("media_tags.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True),
            nullable=False, server_default="NOW()",
        ),
    )
    op.create_index(
        "ix_media_tag_links_media_tag_id",
        "media_tag_links", ["media_tag_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_media_tag_links_media_tag_id", table_name="media_tag_links")
    op.drop_table("media_tag_links")
    op.drop_index("ix_media_tags_site_id", table_name="media_tags")
    op.drop_table("media_tags")
