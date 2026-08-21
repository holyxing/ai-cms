"""P3.6 补充 + 新闻资讯栏目支持

依据: docs/18-布局系统与标签占位符.md §7 + 用户需求 (2026-06-06)

变更:
1. contents.cover_image  - 封面图 URL (新闻列表/卡片视图需要)
2. categories.template  - 栏目布局模板代码, 引用 layouts.code (scope=category)
   例如: "default" / "news-list"
3. layouts 表预置 2 个 category 模板 (default + news-list)
   每个新站点在 seed 时插入 (scope=category, code=default|news-list, is_default)
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0020"
down_revision = "0019"
branch_labels = None
depends_on = None


# 预置模板: default (普通列表) + news-list (新闻卡片墙)
SEED_CATEGORY_LAYOUTS = [
    {
        "code": "default",
        "name": "默认列表",
        "is_default": True,
        "html": """<h1><HY_CAT_NAME /></h1>
<p><HY_CAT_DESCRIPTION /></p>
<ul class="content-list">
<HY_CONTENTS _limit="20" _order="newest">
  <li>
    <a href="<HY_ITEM_URL />"><HY_ITEM_TITLE /></a>
    <span class="date"><HY_ITEM_DATE /></span>
    <p><HY_ITEM_SUMMARY /></p>
  </li>
</HY_CONTENTS>
</ul>""",
    },
    {
        "code": "news-list",
        "name": "新闻资讯",
        "is_default": False,
        "html": """<h1><HY_CAT_NAME /></h1>
<p><HY_CAT_DESCRIPTION /></p>
<div class="news-grid">
<HY_CONTENTS _limit="12" _order="newest">
  <article class="news-card">
    <HY_IF _condition="content.has_cover">
      <a href="<HY_ITEM_URL />" class="news-cover">
        <img src="<HY_ITEM_COVER />" alt="<HY_ITEM_TITLE />" />
      </a>
    </HY_IF>
    <div class="news-body">
      <h3><a href="<HY_ITEM_URL />"><HY_ITEM_TITLE /></a></h3>
      <p class="news-excerpt"><HY_ITEM_SUMMARY /></p>
      <div class="news-meta">
        <HY_IF _condition="content.has_summary"><time><HY_ITEM_DATE /></time></HY_IF>
      </div>
    </div>
  </article>
</HY_CONTENTS>
</div>
<HY_IF _condition="cat.has_children">
  <section class="sub-cats">
    <h2>子栏目</h2>
    <ul>
      <HY_CATS _type="children">
        <li><a href="<HY_CAT_URL />"><HY_CAT_NAME /></a></li>
      </HY_CATS>
    </ul>
  </section>
</HY_IF>""",
    },
]


def upgrade() -> None:
    # 1) contents 加 cover_image
    op.add_column(
        "contents",
        sa.Column("cover_image", sa.Text(), nullable=True),
    )

    # 2) categories 加 template (引用 layouts.code, 软约束)
    op.add_column(
        "categories",
        sa.Column("template", sa.String(64), nullable=True, server_default="default"),
    )
    # 不加 FK, 因为 template 是 string code, 跨 sites 不强约束
    # 校验在应用层 (Pydantic / 业务逻辑)

    # 3) 为已有 sites 预置默认 category layout
    conn = op.get_bind()
    sites = conn.execute(sa.text("SELECT id FROM sites WHERE deleted_at IS NULL")).fetchall()
    for (site_id,) in sites:
        for tmpl in SEED_CATEGORY_LAYOUTS:
            # 跳过已存在
            exists = conn.execute(
                sa.text(
                    "SELECT 1 FROM layouts WHERE site_id = :sid "
                    "AND scope = 'category' AND code = :code "
                    "AND deleted_at IS NULL"
                ),
                {"sid": site_id, "code": tmpl["code"]},
            ).fetchone()
            if exists:
                continue
            conn.execute(
                sa.text(
                    """
                    INSERT INTO layouts (
                        site_id, scope, code, name, html, is_default, version,
                        created_at, updated_at
                    ) VALUES (
                        :sid, 'category', :code, :name, :html, :is_default, 1,
                        NOW(), NOW()
                    )
                    """
                ),
                {
                    "sid": site_id,
                    "code": tmpl["code"],
                    "name": tmpl["name"],
                    "html": tmpl["html"],
                    "is_default": tmpl["is_default"],
                },
            )


def downgrade() -> None:
    # 反向: 不删 layouts (可能用户已编辑), 仅删字段
    op.drop_column("categories", "template")
    op.drop_column("contents", "cover_image")
    # 预置的默认 news-list / default category layouts 也保留
    # 若要清, 手动: DELETE FROM layouts WHERE scope='category' AND code IN ('default','news-list');
