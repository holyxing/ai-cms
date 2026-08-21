"""sites and site_domains

Revision ID: 0002_sites
Revises: 0001_initial
Create Date: 2026-06-04 23:30:00

P1.1: 站点管理 - sites + site_domains 表
依据: docs/04b-数据模型.md §3.1, §3.2
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers
revision: str = "0002_sites"
down_revision: Union[str, None] = "0001_initial"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # === sites ===
    op.create_table(
        "sites",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("slug", sa.String(64), nullable=False),
        sa.Column("name", sa.String(128), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("logo_url", sa.Text(), nullable=True),
        sa.Column("owner_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default=sa.text("'active'")),
        sa.Column("settings", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("slug", name="uq_sites_slug"),
        sa.CheckConstraint("status IN ('active', 'archived')", name="ck_sites_status"),
    )
    op.create_index("ix_sites_owner", "sites", ["owner_id"], postgresql_where=sa.text("deleted_at IS NULL"))
    op.create_index("ix_sites_status", "sites", ["status"], postgresql_where=sa.text("deleted_at IS NULL"))

    # === site_domains ===
    op.create_table(
        "site_domains",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("site_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("sites.id", ondelete="CASCADE"), nullable=False),
        sa.Column("domain", sa.String(255), nullable=False),
        sa.Column("type", sa.String(20), nullable=False, server_default=sa.text("'primary'")),
        sa.Column("ssl_status", sa.String(20), nullable=False, server_default=sa.text("'pending'")),
        sa.Column("verified_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("domain", name="uq_site_domains_domain"),
        sa.CheckConstraint("type IN ('primary', 'alias', 'preview')", name="ck_site_domains_type"),
        sa.CheckConstraint("ssl_status IN ('pending', 'active', 'failed')", name="ck_site_domains_ssl"),
    )
    op.create_index("ix_site_domains_site", "site_domains", ["site_id"], postgresql_where=sa.text("deleted_at IS NULL"))


def downgrade() -> None:
    op.drop_index("ix_site_domains_site", table_name="site_domains")
    op.drop_table("site_domains")
    op.drop_index("ix_sites_status", table_name="sites")
    op.drop_index("ix_sites_owner", table_name="sites")
    op.drop_table("sites")
