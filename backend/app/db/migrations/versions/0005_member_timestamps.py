"""site_members / invitations 加 created_at + updated_at + trigger

原因: 0004 migration 漏了这两个时间戳字段, 但 Model 继承 TimestampMixin 自动查询它们
修复: 补字段 + trigger, 与 P1.1/0003 一致
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0005_member_timestamps"
down_revision: Union[str, None] = "0004_site_members"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    for table in ("site_members", "invitations"):
        op.execute(f"""
            ALTER TABLE {table}
            ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
        """)
        # trigger
        op.execute(f"""
            CREATE OR REPLACE FUNCTION set_updated_at_{table}()
            RETURNS TRIGGER AS $$
            BEGIN
                NEW.updated_at = NOW();
                RETURN NEW;
            END;
            $$ LANGUAGE plpgsql;
        """)
        op.execute(f"DROP TRIGGER IF EXISTS trg_{table}_updated_at ON {table};")
        op.execute(f"""
            CREATE TRIGGER trg_{table}_updated_at
            BEFORE UPDATE ON {table}
            FOR EACH ROW
            EXECUTE FUNCTION set_updated_at_{table}();
        """)


def downgrade() -> None:
    for table in ("site_members", "invitations"):
        op.execute(f"DROP TRIGGER IF EXISTS trg_{table}_updated_at ON {table};")
        op.execute(f"DROP FUNCTION IF EXISTS set_updated_at_{table}();")
        op.drop_column(table, "updated_at")
        op.drop_column(table, "created_at")
