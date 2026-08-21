"""updated_at 自动更新 trigger

修复 P0 + P1.1 表都缺 onupdate 的问题:
- 0001 users.updated_at
- 0002 sites.updated_at
- 0002 site_domains.updated_at

每个表加一个 BEFORE UPDATE trigger, NEW.updated_at = NOW()
"""
from typing import Sequence, Union

from alembic import op

revision: str = "0003_updated_at_triggers"
down_revision: Union[str, None] = "0002_sites"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _create_trigger(table: str) -> None:
    """为表加 updated_at trigger"""
    fn_name = f"set_updated_at_{table}"
    op.execute(f"""
        CREATE OR REPLACE FUNCTION {fn_name}()
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
        EXECUTE FUNCTION {fn_name}();
    """)


def upgrade() -> None:
    for table in ("users", "sites", "site_domains"):
        _create_trigger(table)


def downgrade() -> None:
    for table in ("users", "sites", "site_domains"):
        op.execute(f"DROP TRIGGER IF EXISTS trg_{table}_updated_at ON {table};")
        op.execute(f"DROP FUNCTION IF EXISTS set_updated_at_{table}();")
