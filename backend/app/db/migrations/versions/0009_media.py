"""create media + media_folders + media_relations

Revision ID: 0009
Revises: 0008
Create Date: 2026-06-05
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # === media_folders (邻接表) ===
    op.create_table(
        "media_folders",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("site_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("sites.id", ondelete="CASCADE"), nullable=False),
        sa.Column("parent_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("media_folders.id", ondelete="CASCADE"), nullable=True),
        sa.Column("name", sa.String(128), nullable=False),
        sa.Column("path", sa.Text, nullable=False),  # 物化路径 /<id>/<id>/
        sa.Column("created_at", sa.DateTime(timezone=True),
                  nullable=False, server_default=sa.text("NOW()")),
        sa.Column("updated_at", sa.DateTime(timezone=True),
                  nullable=False, server_default=sa.text("NOW()")),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("idx_media_folders_site", "media_folders",
                    ["site_id"], postgresql_where=sa.text("deleted_at IS NULL"))
    op.create_index("idx_media_folders_parent", "media_folders",
                    ["parent_id"], postgresql_where=sa.text("deleted_at IS NULL"))

    # === media ===
    op.create_table(
        "media",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("site_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("sites.id", ondelete="CASCADE"), nullable=False),
        sa.Column("folder_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("media_folders.id", ondelete="SET NULL"), nullable=True),
        sa.Column("uploader_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("filename", sa.String(255), nullable=False),  # 原始文件名
        sa.Column("object_key", sa.String(512), nullable=False, unique=True),  # MinIO key
        sa.Column("mime_type", sa.String(128), nullable=False),
        sa.Column("size_bytes", sa.BigInteger, nullable=False),
        sa.Column("width", sa.Integer, nullable=True),
        sa.Column("height", sa.Integer, nullable=True),
        sa.Column("alt_text", sa.String(255), nullable=True),
        sa.Column("metadata", postgresql.JSONB, nullable=False,
                  server_default=sa.text("'{}'::jsonb")),
        sa.Column("created_at", sa.DateTime(timezone=True),
                  nullable=False, server_default=sa.text("NOW()")),
        sa.Column("updated_at", sa.DateTime(timezone=True),
                  nullable=False, server_default=sa.text("NOW()")),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("idx_media_site", "media",
                    ["site_id"], postgresql_where=sa.text("deleted_at IS NULL"))
    op.create_index("idx_media_folder", "media",
                    ["folder_id"], postgresql_where=sa.text("deleted_at IS NULL"))
    op.create_index("idx_media_uploader", "media",
                    ["uploader_id"], postgresql_where=sa.text("deleted_at IS NULL"))
    op.create_index("idx_media_mime", "media",
                    ["mime_type"], postgresql_where=sa.text("deleted_at IS NULL"))

    # === media_relations (N:N) ===
    op.create_table(
        "media_relations",
        sa.Column("media_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("media.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("content_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("contents.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("role", sa.String(32), nullable=False, server_default="inline"),
        # inline | cover | gallery
        sa.Column("created_at", sa.DateTime(timezone=True),
                  nullable=False, server_default=sa.text("NOW()")),
        sa.CheckConstraint("role IN ('inline', 'cover', 'gallery')",
                          name="ck_media_relations_role"),
    )
    op.create_index("idx_media_relations_content", "media_relations", ["content_id"])


def downgrade() -> None:
    op.drop_table("media_relations")
    op.drop_table("media")
    op.drop_table("media_folders")
