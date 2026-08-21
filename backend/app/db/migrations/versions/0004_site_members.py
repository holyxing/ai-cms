"""站点成员 + 邀请 (P1.2b)

依据: docs/04b-数据模型.md §3.3, §3.4

设计决策:
- PK: UUID (与 P1.1 sites 表一致, P0 users 表也是)
- role: owner | editor | viewer (site_members); invitations 也用相同
- super_admin 是系统级, 不进 site_members (在 users.is_super_admin)
- 同一 user 在同站唯一: UNIQUE (site_id, user_id) WHERE deleted_at IS NULL
- invitation.token: 64 字符 URL-safe 随机串, UNIQUE
- invitation.email: 同一 email 可有多个 pending (失效/重发)
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0004_site_members"
down_revision: Union[str, None] = "0003_updated_at_triggers"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # === site_members ===
    op.create_table(
        "site_members",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("site_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(64), nullable=False, comment="owner | editor | viewer"),
        sa.Column("invited_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column(
            "joined_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "name IN ('owner', 'editor', 'viewer')",
            name="ck_site_members_role",
        ),
        sa.ForeignKeyConstraint(
            ["site_id"], ["sites.id"], ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["invited_by"], ["users.id"], ondelete="SET NULL",
        ),
    )

    # 部分唯一: 同一 user 在同站 (未软删) 只能一个角色
    op.create_index(
        "uq_site_members_site_user",
        "site_members",
        ["site_id", "user_id"],
        unique=True,
        postgresql_where=sa.text("deleted_at IS NULL"),
    )
    # 查 user 的所有成员身份
    op.create_index(
        "idx_site_members_user",
        "site_members",
        ["user_id"],
        postgresql_where=sa.text("deleted_at IS NULL"),
    )
    # 按 site 查成员
    op.create_index(
        "idx_site_members_site",
        "site_members",
        ["site_id"],
        postgresql_where=sa.text("deleted_at IS NULL"),
    )

    # === invitations ===
    op.create_table(
        "invitations",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("site_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("email", sa.String(255), nullable=False),
        sa.Column("name", sa.String(64), nullable=False, comment="owner | editor | viewer"),
        sa.Column("token", sa.String(64), nullable=False),
        sa.Column("invited_by", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("accepted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "name IN ('owner', 'editor', 'viewer')",
            name="ck_invitations_role",
        ),
        sa.UniqueConstraint("token", name="uq_invitations_token"),
        sa.ForeignKeyConstraint(
            ["site_id"], ["sites.id"], ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["invited_by"], ["users.id"], ondelete="SET NULL",
        ),
    )

    # 同一 email 的活跃邀请 (未接受/未过期/未软删)
    op.create_index(
        "idx_invitations_email_active",
        "invitations",
        ["email"],
        postgresql_where=sa.text("accepted_at IS NULL AND deleted_at IS NULL"),
    )
    # 按 site 查邀请
    op.create_index(
        "idx_invitations_site",
        "invitations",
        ["site_id"],
        postgresql_where=sa.text("deleted_at IS NULL"),
    )


def downgrade() -> None:
    op.drop_table("invitations")
    op.drop_table("site_members")
