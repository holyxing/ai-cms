"""0023_deployment_scope: 发布粒度 (site / category / content)

P3.6.1: 加 2 个字段支持栏目级 / 文章级发布
- deployments.scope: 'site' (整站, 默认) / 'category' (栏目级) / 'content' (文章级)
- deployments.scope_id: 栏目或文章 UUID, site 发布时为 NULL

CHECK constraint: scope IN ('site','category','content')
"""
from alembic import op
import sqlalchemy as sa

revision = "0023"
down_revision = "0022"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "deployments",
        sa.Column(
            "scope", sa.String(20), nullable=False, server_default="site",
        ),
    )
    op.add_column(
        "deployments",
        sa.Column(
            "scope_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            nullable=True,
        ),
    )
    op.create_index(
        "ix_deployments_scope_id",
        "deployments",
        ["scope_id"],
    )
    op.create_check_constraint(
        "ck_deployments_scope",
        "deployments",
        "scope IN ('site','category','content')",
    )


def downgrade() -> None:
    op.drop_constraint("ck_deployments_scope", "deployments", type_="check")
    op.drop_index("ix_deployments_scope_id", table_name="deployments")
    op.drop_column("deployments", "scope_id")
    op.drop_column("deployments", "scope")
