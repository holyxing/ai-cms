"""远程 SSH 部署服务器 + deployment 远程同步字段

Revision ID: 0050
Revises: 0049
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0050"
down_revision: Union[str, None] = "0049"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "deploy_servers",
        sa.Column("id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("host", sa.String(255), nullable=False),
        sa.Column("port", sa.Integer(), server_default="22", nullable=False),
        sa.Column("username", sa.String(100), nullable=False),
        sa.Column("auth_type", sa.String(20), nullable=False),
        sa.Column("password_encrypted", sa.Text(), nullable=True),
        sa.Column("private_key_encrypted", sa.Text(), nullable=True),
        sa.Column("private_key_path", sa.String(500), nullable=True),
        sa.Column(
            "remote_base_path", sa.String(500),
            server_default="/var/www/sites", nullable=False,
        ),
        sa.Column("is_default", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "auth_type IN ('pem', 'password')",
            name="ck_deploy_servers_auth_type",
        ),
        sa.PrimaryKeyConstraint("id"),
    )

    op.add_column(
        "deployments",
        sa.Column("remote_sync_status", sa.String(20), nullable=True),
    )
    op.add_column("deployments", sa.Column("remote_sync_log", sa.Text(), nullable=True))
    op.add_column("deployments", sa.Column("remote_sync_duration_ms", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("deployments", "remote_sync_duration_ms")
    op.drop_column("deployments", "remote_sync_log")
    op.drop_column("deployments", "remote_sync_status")
    op.drop_table("deploy_servers")
