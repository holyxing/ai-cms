"""P4.1: 全文检索 v2 — body 进 search_vector + pg_trgm 模糊

依据: docs/05-开发路线图.md P4 (全文搜索), docs/13-P3-进度.md

前置:
- 0008 加了 contents.search_vector + GIN 索引 (title/excerpt/slug)
- 0015 加了触发器刷 search_vector (但只 title/excerpt/slug)

本迁移升级:
- 触发器加 body (从最新 content_version.body 拿, setweight B 介于 excerpt 跟 slug 之间)
- 加 pg_trgm 扩展 (模糊 + 中文 trigram 兜底)
- title/excerpt/slug 三个字段加 GIN trigram 索引 (拼音/拼写容错)
- 一次性 backfill (refresh 现有 64 行)

zhparser 暂不装 (Alpine 镜像编不了, 改镜像成本 1 天), 中文按 trigram 模糊 + ILIKE 兜底
"""
from alembic import op

revision = "0028"
down_revision = "0027"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. 扩展
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm;")
    op.execute("CREATE EXTENSION IF NOT EXISTS unaccent;")

    # 2. 升级触发器函数: title(A) + body(B, 最新 version) + excerpt(C) + slug(D)
    #    body 加 B 权重 (比 excerpt 低, 避免长文稀释标题权重)
    op.execute("""
        CREATE OR REPLACE FUNCTION contents_search_vector_update() RETURNS trigger AS $$
        DECLARE
            v_body text;
        BEGIN
            -- 拿最新 version 的 body (P2 起版本永不删, version_num desc 第一条)
            SELECT body INTO v_body
            FROM content_versions
            WHERE content_id = NEW.id
            ORDER BY version_num DESC
            LIMIT 1;

            NEW.search_vector :=
                setweight(to_tsvector('simple', unaccent(COALESCE(NEW.title, ''))), 'A') ||
                setweight(to_tsvector('simple', unaccent(COALESCE(v_body, ''))), 'B') ||
                setweight(to_tsvector('simple', unaccent(COALESCE(NEW.excerpt, ''))), 'C') ||
                setweight(to_tsvector('simple', unaccent(COALESCE(NEW.slug, ''))), 'D');
            RETURN NEW;
        END
        $$ LANGUAGE plpgsql;
    """)

    # 3. 触发器: 标题/摘要/slug 改时刷; body 在 version 插入后单独刷 (下面加)
    op.execute("DROP TRIGGER IF EXISTS trg_contents_search_vector ON contents;")
    op.execute("""
        CREATE TRIGGER trg_contents_search_vector
        BEFORE INSERT OR UPDATE OF title, excerpt, slug ON contents
        FOR EACH ROW EXECUTE FUNCTION contents_search_vector_update();
    """)

    # 4. content_versions 触发器: 新 version 写入时, 同步刷 contents.search_vector
    op.execute("""
        CREATE OR REPLACE FUNCTION content_version_refresh_search() RETURNS trigger AS $$
        BEGIN
            UPDATE contents SET search_vector =
                setweight(to_tsvector('simple', unaccent(COALESCE(contents.title, ''))), 'A') ||
                setweight(to_tsvector('simple', unaccent(COALESCE(NEW.body, ''))), 'B') ||
                setweight(to_tsvector('simple', unaccent(COALESCE(contents.excerpt, ''))), 'C') ||
                setweight(to_tsvector('simple', unaccent(COALESCE(contents.slug, ''))), 'D')
            WHERE contents.id = NEW.content_id;
            RETURN NEW;
        END
        $$ LANGUAGE plpgsql;
    """)
    op.execute("DROP TRIGGER IF EXISTS trg_content_version_refresh ON content_versions;")
    op.execute("""
        CREATE TRIGGER trg_content_version_refresh
        AFTER INSERT ON content_versions
        FOR EACH ROW EXECUTE FUNCTION content_version_refresh_search();
    """)

    # 5. trigram 索引 (拼音/拼写容错 + 中文 trigram)
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_contents_title_trgm
            ON contents USING gin (title gin_trgm_ops)
            WHERE deleted_at IS NULL;
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_contents_excerpt_trgm
            ON contents USING gin (excerpt gin_trgm_ops)
            WHERE deleted_at IS NULL;
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_contents_slug_trgm
            ON contents USING gin (slug gin_trgm_ops)
            WHERE deleted_at IS NULL;
    """)

    # 6. backfill (现 64 行刷一遍, 含 body)
    op.execute("""
        UPDATE contents c SET search_vector =
            setweight(to_tsvector('simple', unaccent(COALESCE(c.title, ''))), 'A') ||
            setweight(to_tsvector('simple', unaccent(COALESCE(cv.body, ''))), 'B') ||
            setweight(to_tsvector('simple', unaccent(COALESCE(c.excerpt, ''))), 'C') ||
            setweight(to_tsvector('simple', unaccent(COALESCE(c.slug, ''))), 'D')
        FROM (SELECT DISTINCT ON (content_id) content_id, body
              FROM content_versions
              ORDER BY content_id, version_num DESC) cv
        WHERE cv.content_id = c.id
          AND c.deleted_at IS NULL;
    """)


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS trg_content_version_refresh ON content_versions;")
    op.execute("DROP FUNCTION IF EXISTS content_version_refresh_search();")
    op.execute("DROP INDEX IF EXISTS idx_contents_slug_trgm;")
    op.execute("DROP INDEX IF EXISTS idx_contents_excerpt_trgm;")
    op.execute("DROP INDEX IF EXISTS idx_contents_title_trgm;")
    # 触发器函数降级回 0015 版 (不含 body)
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
    # 不删扩展 (其他表可能用到)
