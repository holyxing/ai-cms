"""create themes + theme_versions + deployments + content_snapshots (P2)

Revision ID: 0010
Revises: 0009
Create Date: 2026-06-05

依据: docs/04b-数据模型.md §4.1-4.4
依据: docs/12-P2-决策.md (A1:UUID, A2:全局库+站级实例, B1:默认自动 apply, D6:移除 cdn_purged, E1:build_log, E4:retry_count, F1:软删不级联)
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # === themes (全局主题库) ===
    op.create_table(
        "themes",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("code", sa.String(64), unique=True, nullable=False),
        sa.Column("display_name", sa.String(128), nullable=False),
        sa.Column("type", sa.String(20), nullable=False, server_default="preset"),
        sa.Column("base_theme_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("themes.id", ondelete="SET NULL"), nullable=True),
        sa.Column("template_name", sa.String(64), nullable=False),
        sa.Column("preview_image", sa.Text, nullable=True),
        sa.Column("is_default", sa.Boolean, nullable=False, server_default=sa.text("FALSE")),
        sa.Column("default_tokens", postgresql.JSONB, nullable=False),
        sa.Column("tokens_schema", postgresql.JSONB, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True),
                  nullable=False, server_default=sa.text("NOW()")),
        sa.Column("updated_at", sa.DateTime(timezone=True),
                  nullable=False, server_default=sa.text("NOW()")),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "type IN ('preset', 'custom')",
            name="ck_themes_type",
        ),
    )
    # 最多一个 is_default=true
    op.create_index(
        "idx_themes_default", "themes",
        ["is_default"],
        unique=True,
        postgresql_where=sa.text("is_default = TRUE AND deleted_at IS NULL"),
    )

    # === theme_versions (站级应用实例) ===
    op.create_table(
        "theme_versions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("site_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("sites.id", ondelete="CASCADE"), nullable=False),
        sa.Column("theme_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("themes.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("version", sa.Integer, nullable=False),
        sa.Column("tokens", postgresql.JSONB, nullable=False),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default=sa.text("FALSE")),
        sa.Column("is_ai_generated", sa.Boolean, nullable=False, server_default=sa.text("FALSE")),
        sa.Column("prompt", sa.Text, nullable=True),
        sa.Column("change_note", sa.Text, nullable=True),
        sa.Column("author_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True),
                  nullable=False, server_default=sa.text("NOW()")),
        sa.Column("updated_at", sa.DateTime(timezone=True),
                  nullable=False, server_default=sa.text("NOW()")),
        sa.UniqueConstraint("site_id", "version", name="uq_theme_versions_site_version"),
    )
    op.create_index("idx_theme_versions_theme", "theme_versions", ["theme_id"])
    op.create_index("idx_theme_versions_author", "theme_versions", ["author_id"])
    # 1 个 site 同时只有 1 个 is_active=true (partial unique)
    op.create_index(
        "idx_theme_versions_active", "theme_versions",
        ["site_id"],
        unique=True,
        postgresql_where=sa.text("is_active = TRUE"),
    )

    # === deployments (静态发布记录) ===
    op.create_table(
        "deployments",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("site_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("sites.id", ondelete="CASCADE"), nullable=False),
        sa.Column("theme_version_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("theme_versions.id", ondelete="SET NULL"), nullable=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
        sa.Column("triggered_by", sa.String(20), nullable=False),
        sa.Column("trigger_user_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("duration_ms", sa.Integer, nullable=True),
        sa.Column("content_count", sa.Integer, nullable=True),
        sa.Column("artifact_path", sa.Text, nullable=True),
        sa.Column("artifact_size", sa.BigInteger, nullable=True),
        sa.Column("build_log", sa.Text, nullable=True),
        sa.Column("retry_count", sa.Integer, nullable=False, server_default=sa.text("0")),
        sa.Column("error_message", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True),
                  nullable=False, server_default=sa.text("NOW()")),
        sa.Column("updated_at", sa.DateTime(timezone=True),
                  nullable=False, server_default=sa.text("NOW()")),
        sa.CheckConstraint(
            "status IN ('pending','building','success','failed','cancelled')",
            name="ck_deployments_status",
        ),
        sa.CheckConstraint(
            "triggered_by IN ('manual','scheduled','api','rollback')",
            name="ck_deployments_triggered_by",
        ),
    )
    op.create_index("idx_deployments_site", "deployments", ["site_id", "created_at"])
    op.create_index("idx_deployments_status", "deployments", ["status"],
                    postgresql_where=sa.text("status IN ('pending', 'building')"))

    # === content_snapshots (已发布内容 HTML 快照) ===
    op.create_table(
        "content_snapshots",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("content_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("contents.id", ondelete="CASCADE"), nullable=False),
        sa.Column("deployment_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("deployments.id", ondelete="CASCADE"), nullable=False),
        sa.Column("version_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("content_versions.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("slug", sa.String(255), nullable=False),
        sa.Column("body_html", sa.Text, nullable=False),
        sa.Column("body_json", postgresql.JSONB, nullable=False),
        sa.Column("taxonomy_paths", postgresql.JSONB, nullable=False),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True),
                  nullable=False, server_default=sa.text("NOW()")),
        sa.Column("updated_at", sa.DateTime(timezone=True),
                  nullable=False, server_default=sa.text("NOW()")),
        sa.UniqueConstraint("content_id", "deployment_id", name="uq_content_snapshots_content_deployment"),
    )
    op.create_index("idx_content_snapshots_content", "content_snapshots",
                    ["content_id", "deployment_id"])
    op.create_index("idx_content_snapshots_deployment", "content_snapshots", ["deployment_id"])


def downgrade() -> None:
    op.drop_table("content_snapshots")
    op.drop_table("deployments")
    op.drop_table("theme_versions")
    op.drop_table("themes")
