"""所有栏目/首页模板 HY_CONTENTS 补发布日期倒序

含「新闻资讯」「案例中心」等已导入模板，不只 code=default。

Revision ID: 0049
Revises: 0048
"""
from __future__ import annotations

import re
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0049"
down_revision: Union[str, None] = "0048"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_OPEN = re.compile(r"<HY_CONTENTS\b([^>]*)>", re.IGNORECASE)


def _force_date_sort(html: str) -> str:
    if not html:
        return html

    def repl(m: re.Match) -> str:
        attrs = m.group(1)
        order_m = re.search(r'\b_order\s*=\s*(["\'])([^"\']*)\1', attrs, re.I)
        order_val = (order_m.group(2) if order_m else "").strip().lower()
        if order_val not in ("hits", "random"):
            if order_m:
                attrs = re.sub(
                    r'\b_order\s*=\s*(["\'])[^"\']*\1',
                    '_order="newest"',
                    attrs,
                    flags=re.I,
                )
            else:
                attrs = f'{attrs.rstrip()} _order="newest"' if attrs.strip() else ' _order="newest"'
        if not re.search(r"\b_order_by\s*=", attrs, re.I) and order_val not in ("hits", "random"):
            attrs = f'{attrs.rstrip()} _order_by="published"'
        return f"<HY_CONTENTS{attrs}>"

    return _OPEN.sub(repl, html)


def upgrade() -> None:
    conn = op.get_bind()
    rows = conn.execute(
        sa.text(
            "SELECT id, html FROM layouts "
            "WHERE deleted_at IS NULL AND scope IN ('category', 'home')"
        )
    ).fetchall()
    for row in rows:
        new_html = _force_date_sort(row.html or "")
        if new_html != (row.html or ""):
            conn.execute(
                sa.text("UPDATE layouts SET html = :html WHERE id = :id"),
                {"html": new_html, "id": row.id},
            )


def downgrade() -> None:
    pass
