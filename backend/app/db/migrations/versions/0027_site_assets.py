"""0027_site_assets: 站点级静态资源 (模板引用 CSS/JS/字体/Logo 等)

P3.6.2 资源管理:
- 跟 Media 表差异: Media 是内容资源(文章配图/PDF), 走 MinIO presigned;
  SiteAsset 是模板级静态资源, 随站点发布, 公开 URL, 模板里
  <link href="<HY_ASSET_URL site.css>"> 引用
- 文件存 backend/ssg/site_assets/{site_id}/{name} (本地 fs, 跟 ssg _template 同一级)
- 静态发布时复制到 {site}/public/assets/{name}, nginx 公开可访问
"""
from alembic import op
import sqlalchemy as sa

revision = "0027"
down_revision = "0026"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "site_assets",
        sa.Column(
            "id", sa.dialects.postgresql.UUID(as_uuid=True),
            primary_key=True, server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "site_id", sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey("sites.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(128), nullable=False),
        sa.Column("original_filename", sa.String(256), nullable=False),
        sa.Column("file_path", sa.String(512), nullable=False),
        sa.Column(
            "content_type", sa.String(128),
            nullable=False, server_default="application/octet-stream",
        ),
        sa.Column("byte_size", sa.BigInteger, nullable=False, server_default="0"),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_site_assets_site_id", "site_assets", ["site_id"])
    op.create_unique_constraint(
        "uq_site_assets_site_name", "site_assets", ["site_id", "name"],
    )


def downgrade() -> None:
    op.drop_constraint("uq_site_assets_site_name", "site_assets", type_="unique")
    op.drop_index("ix_site_assets_site_id", table_name="site_assets")
    op.drop_table("site_assets")
