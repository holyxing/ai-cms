"""create contents + content_taxonomies + content_versions

Revision ID: 0008
Revises: 0007
Create Date: 2026-06-05
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # === contents ===
    op.create_table(
        "contents",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("site_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("sites.id", ondelete="CASCADE"), nullable=False),
        sa.Column("author_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("slug", sa.String(255), nullable=False),
        sa.Column("excerpt", sa.Text, nullable=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="draft"),
        sa.Column("scheduled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("published_version_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("locked_by", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("users.id"), nullable=True),
        sa.Column("locked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("search_vector", postgresql.TSVECTOR, nullable=True),
        sa.Column("metadata", postgresql.JSONB, nullable=False,
                  server_default=sa.text("'{}'::jsonb")),
        sa.Column("view_count", sa.BigInteger, nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True),
                  nullable=False, server_default=sa.text("NOW()")),
        sa.Column("updated_at", sa.DateTime(timezone=True),
                  nullable=False, server_default=sa.text("NOW()")),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "status IN ('draft','pending','published','scheduled','archived')",
            name="ck_contents_status",
        ),
        sa.UniqueConstraint("site_id", "slug", name="uq_contents_site_slug"),
    )
    op.create_index("idx_contents_site_status", "contents",
                    ["site_id", "status"],
                    postgresql_where=sa.text("deleted_at IS NULL"))
    op.create_index("idx_contents_author", "contents",
                    ["author_id"],
                    postgresql_where=sa.text("deleted_at IS NULL"))
    op.create_index("idx_contents_search", "contents", ["search_vector"],
                    postgresql_using="gin",
                    postgresql_where=sa.text("deleted_at IS NULL"))

    # === content_taxonomies (N:N) ===
    op.create_table(
        "content_taxonomies",
        sa.Column("content_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("contents.id", ondelete="CASCADE"),
                  primary_key=True),
        sa.Column("taxonomy_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("taxonomies.id", ondelete="CASCADE"),
                  primary_key=True),
        sa.Column("is_primary", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True),
                  nullable=False, server_default=sa.text("NOW()")),
    )
    op.create_index("idx_content_tax_tax", "content_taxonomies", ["taxonomy_id"])

    # === content_versions (永不删) ===
    op.create_table(
        "content_versions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("content_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("contents.id", ondelete="CASCADE"),
                  nullable=False, index=True),
        sa.Column("version_num", sa.Integer, nullable=False),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("body", sa.Text, nullable=False),  # Tiptap HTML/JSON
        sa.Column("excerpt", sa.Text, nullable=True),
        sa.Column("author_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("is_auto_save", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True),
                  nullable=False, server_default=sa.text("NOW()")),
        sa.UniqueConstraint("content_id", "version_num",
                            name="uq_content_versions_num"),
    )


def downgrade() -> None:
    op.drop_table("content_versions")
    op.drop_table("content_taxonomies")
    op.drop_table("contents")
