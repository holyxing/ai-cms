"""create taxonomies (栏目) table

Revision ID: 0007
Revises: 0006
Create Date: 2026-06-05
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "taxonomies",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("site_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("sites.id", ondelete="CASCADE"), nullable=False),
        sa.Column("parent_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("taxonomies.id", ondelete="CASCADE"), nullable=True),
        sa.Column("name", sa.String(128), nullable=False),
        sa.Column("slug", sa.String(128), nullable=False),
        sa.Column("type", sa.String(20), nullable=False, server_default="category"),
        sa.Column("path", sa.Text, nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("order_num", sa.Integer, nullable=False, server_default="0"),
        sa.Column("seo", postgresql.JSONB, nullable=False,
                  server_default=sa.text("'{}'::jsonb")),
        sa.Column("created_at", sa.DateTime(timezone=True),
                  nullable=False, server_default=sa.text("NOW()")),
        sa.Column("updated_at", sa.DateTime(timezone=True),
                  nullable=False, server_default=sa.text("NOW()")),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("type IN ('category', 'tag')", name="ck_taxonomies_type"),
        sa.UniqueConstraint("site_id", "slug", "type", name="uq_taxonomies_site_slug_type"),
    )
    op.create_index("idx_taxonomies_site", "taxonomies",
                    ["site_id"], postgresql_where=sa.text("deleted_at IS NULL"))
    op.create_index("idx_taxonomies_parent", "taxonomies",
                    ["parent_id"], postgresql_where=sa.text("deleted_at IS NULL"))
    op.create_index("idx_taxonomies_path", "taxonomies",
                    ["path"], postgresql_where=sa.text("deleted_at IS NULL"))


def downgrade() -> None:
    op.drop_index("idx_taxonomies_path", table_name="taxonomies")
    op.drop_index("idx_taxonomies_parent", table_name="taxonomies")
    op.drop_index("idx_taxonomies_site", table_name="taxonomies")
    op.drop_table("taxonomies")
