"""P3.6 布局系统（HY_ Tags）：layouts + layout_versions

依据: docs/18-布局系统与标签占位符.md §7
- layouts: 布局模板（site / category / content / home 四 scope）
- layout_versions: 每次改 HTML 自增 version，可回滚
- layouts.code 由用户命名（default / magazine / minimal ...）
- taxonomies.template / contents.template 字段引用 layouts.code

注意:
- layouts.id / site_id 跟随现有主键风格（UUID）
- 唯一键: (site_id, scope, code) 用 partial unique index 实现软删后允许重建
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0019"
down_revision = "0018"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1) layouts 主表
    op.create_table(
        "layouts",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "site_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("sites.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("scope", sa.String(20), nullable=False),
        # site | category | content | home
        sa.Column("code", sa.String(64), nullable=False),
        # default | magazine | minimal ...
        sa.Column("name", sa.String(128), nullable=False),
        # 中文名（给用户看）
        sa.Column("html", sa.Text(), nullable=False),
        # HTML + HY_ 标签源码
        sa.Column("is_default", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("version", sa.Integer(), nullable=False, server_default=sa.text("1")),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.text("NOW()"),
        ),
        sa.Column(
            "updated_at",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.text("NOW()"),
        ),
        sa.Column("deleted_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.CheckConstraint(
            "scope IN ('site', 'category', 'content', 'home')",
            name="ck_layouts_scope",
        ),
    )
    # 唯一键：未软删时 (site_id, scope, code) 唯一
    op.create_index(
        "uq_layouts_site_scope_code_active",
        "layouts",
        ["site_id", "scope", "code"],
        unique=True,
        postgresql_where=sa.text("deleted_at IS NULL"),
    )
    op.create_index(
        "idx_layouts_site_scope",
        "layouts",
        ["site_id", "scope"],
        postgresql_where=sa.text("deleted_at IS NULL"),
    )

    # 2) layout_versions 版本表
    op.create_table(
        "layout_versions",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "layout_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("layouts.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("html", sa.Text(), nullable=False),
        sa.Column("change_note", sa.Text(), nullable=True),
        sa.Column(
            "author_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.text("NOW()"),
        ),
        sa.UniqueConstraint("layout_id", "version", name="uq_layout_versions_layout_version"),
    )
    op.create_index(
        "idx_layout_versions_layout",
        "layout_versions",
        ["layout_id", "version"],
    )


def downgrade() -> None:
    op.drop_index("idx_layout_versions_layout", table_name="layout_versions")
    op.drop_table("layout_versions")
    op.drop_index("idx_layouts_site_scope", table_name="layouts")
    op.drop_index("uq_layouts_site_scope_code_active", table_name="layouts")
    op.drop_table("layouts")
