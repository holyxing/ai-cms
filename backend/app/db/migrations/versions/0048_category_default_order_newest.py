"""栏目默认模板 HY_CONTENTS 按发布日期倒序

Revision ID: 0048
Revises: 0047
"""
from __future__ import annotations

import re
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0048"
down_revision: Union[str, None] = "0047"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_OPEN = re.compile(r"<HY_CONTENTS\b([^>]*)>", re.IGNORECASE)


def _force_newest(html: str) -> str:
    if not html:
        return html

    def repl(m: re.Match) -> str:
        attrs = m.group(1)
        if re.search(r"\b_order\s*=", attrs, re.I):
            attrs = re.sub(
                r'\b_order\s*=\s*(["\'])[^"\']*\1',
                '_order="newest"',
                attrs,
                flags=re.I,
            )
        else:
            attrs = f'{attrs.rstrip()} _order="newest"' if attrs.strip() else ' _order="newest"'
        return f"<HY_CONTENTS{attrs}>"

    return _OPEN.sub(repl, html)


def upgrade() -> None:
    conn = op.get_bind()
    rows = conn.execute(
        sa.text(
            "SELECT id, html FROM layouts "
            "WHERE deleted_at IS NULL AND scope = 'category' AND code = 'default'"
        )
    ).fetchall()
    for row in rows:
        new_html = _force_newest(row.html or "")
        if new_html != (row.html or ""):
            conn.execute(
                sa.text("UPDATE layouts SET html = :html WHERE id = :id"),
                {"html": new_html, "id": row.id},
            )


def downgrade() -> None:
    pass
