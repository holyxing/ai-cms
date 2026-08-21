"""P4: 全文搜索 (PG tsvector)

依据: docs/05-开发路线图.md P4 (全文搜索)

策略:
- contents.search_vector 字段已在 0008 加好, GIN 索引也有了
- 这里加一个 trigger: insert/update contents 时自动 refresh search_vector
- search_vector = setweight(title, A) || setweight(excerpt, B) || setweight(slug, C)
- body 在 content_versions, 不进 tsvector (避免重复存巨大文本)
- 一次性 backfill 现有数据
"""
from alembic import op

revision = "0015"
down_revision = "0014"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. 触发器函数: 把 title/excerpt/slug 合成 tsvector
    op.execute("""
        CREATE OR REPLACE FUNCTION contents_search_vector_update() RETURNS trigger AS $$
        BEGIN
            NEW.search_vector :=
                setweight(to_tsvector('simple', COALESCE(NEW.title, '')), 'A') ||
                setweight(to_tsvector('simple', COALESCE(NEW.excerpt, '')), 'B') ||
                setweight(to_tsvector('simple', COALESCE(NEW.slug, '')), 'C');
            RETURN NEW;
        END
        $$ LANGUAGE plpgsql;
    """)

    # 2. 触发器: insert/update 自动 refresh
    op.execute("DROP TRIGGER IF EXISTS trg_contents_search_vector ON contents;")
    op.execute("""
        CREATE TRIGGER trg_contents_search_vector
        BEFORE INSERT OR UPDATE OF title, excerpt, slug ON contents
        FOR EACH ROW EXECUTE FUNCTION contents_search_vector_update();
    """)

    # 3. backfill 现有数据 (触发器只对新行生效, 老行手动刷)
    op.execute("""
        UPDATE contents SET search_vector =
            setweight(to_tsvector('simple', COALESCE(title, '')), 'A') ||
            setweight(to_tsvector('simple', COALESCE(excerpt, '')), 'B') ||
            setweight(to_tsvector('simple', COALESCE(slug, '')), 'C')
        WHERE search_vector IS NULL OR deleted_at IS NULL;
    """)


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS trg_contents_search_vector ON contents;")
    op.execute("DROP FUNCTION IF EXISTS contents_search_vector_update();")
