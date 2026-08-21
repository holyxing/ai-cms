"""P3.6.4 单测 - 发布前资源检查 (publish_precheck)

覆盖:
A. extract_asset_name / extract_references 提取器 (8 case)
B. check_missing_assets_for_site_publish 端到端 (5 case)
"""
import pytest

from app.services.publish_precheck import (
    extract_asset_name,
    extract_references,
    check_missing_assets_for_site_publish,
    check_missing_assets_for_category_publish,
    check_missing_assets_for_content_publish,
    MissingAsset,
)
from app.models.layout import Layout
from app.models.site_asset import SiteAsset
from app.core.config import get_settings
import uuid

SITE_ID = uuid.UUID("2ea67357-ca1d-4da1-b1c8-f65e17fba8f1")  # demo-site


# === A. 提取器 ===

class TestExtractAssetName:
    def test_A1_simple_filename(self):
        assert extract_asset_name("site.css") == "site.css"
        assert extract_asset_name("main.js") == "main.js"
        assert extract_asset_name("logo.svg") == "logo.svg"

    def test_A2_strip_query_and_hash(self):
        assert extract_asset_name("main.css?v=1") == "main.css"
        assert extract_asset_name("app.js#hash") == "app.js"

    def test_A3_reject_absolute_or_cdn(self):
        assert extract_asset_name("https://cdn.x.com/style.css") is None
        assert extract_asset_name("//cdn.x.com/lib.js") is None
        assert extract_asset_name("/static/main.css") is None
        assert extract_asset_name("data:image/png;base64,...") is None

    def test_A4_reject_path_with_slash(self):
        assert extract_asset_name("css/site.css") is None
        assert extract_asset_name("./site.css") is None

    def test_A5_nested_hy_asset_url(self):
        # 3 种形式都识别
        assert extract_asset_name('<HY_ASSET_URL _name="x.css" />') == "x.css"
        assert extract_asset_name("<HY_ASSET_URL name='y.js' />") == "y.js"
        assert extract_asset_name("<HY_ASSET_URL z.svg />") == "z.svg"
        # 假装 attr 但带 _name= 形式 (HY_NAME_RE 优先)
        assert extract_asset_name('<HY_ASSET_URL _name="a.css">') == "a.css"


class TestExtractReferences:
    def test_B1_demo_real_layout(self):
        """真实 demo 模板: site.css + main.js, 跳过 admin-extra.css"""
        html = (
            '<link rel="stylesheet" href="<HY_ASSET_URL _name="site.css" />" />\n'
            '<link rel="stylesheet" href="/admin-extra.css" />\n'
            '<script src="<HY_ASSET_URL _name="main.js" />"></script>'
        )
        refs = extract_references(html)
        names = sorted(f"{s}:{n}" for n, s in refs)
        assert names == ["hy:main.js", "hy:site.css"]

    def test_B2_no_nested_double_count(self):
        """link href 嵌套 HY_ASSET_URL 时, 不重复"""
        html = '<link href="<HY_ASSET_URL _name="x.css" />">'
        refs = extract_references(html)
        assert len(refs) == 1
        assert refs[0] == ("x.css", "hy")

    def test_B3_skip_hy_site_favicon(self):
        """HY_SITE_FAVICON 是 HY_ 但不是 ASSET_URL, 不识别"""
        html = '<link href="<HY_SITE_FAVICON />">'
        assert extract_references(html) == []

    def test_B4_pure_relative_paths(self):
        html = '<link href="theme.css"><link href="main.css">'
        refs = extract_references(html)
        assert sorted(refs) == [("main.css", "link"), ("theme.css", "link")]

    def test_B5_three_forms(self):
        html = (
            '<HY_ASSET_URL _name="a.css" />'
            "<HY_ASSET_URL name='b.js' />"
            '<HY_ASSET_URL c.svg />'
        )
        refs = extract_references(html)
        assert sorted(refs) == [("a.css", "hy"), ("b.js", "hy"), ("c.svg", "hy")]


# === B. 端到端 (用 demo-site 真实 DB, 直接调 check 函数) ===

@pytest.mark.asyncio
async def test_C1_site_publish_no_missing(db):
    """所有引用的资源都存在 → 空 missing 列表"""
    # 确保 demo-site 有 site.css + main.js (test setup)
    for name, ctype in [("site.css", "text/css"), ("main.js", "application/javascript")]:
        r = await db.execute(
            SiteAsset.__table__.select().where(
                SiteAsset.site_id == SITE_ID, SiteAsset.name == name,
            )
        )
        if r.first() is None:
            db.add(SiteAsset(
                site_id=SITE_ID, name=name,
                original_filename=name, file_path=f"/tmp/{name}",
                content_type=ctype, byte_size=10,
            ))
    await db.commit()

    missing = await check_missing_assets_for_site_publish(db, SITE_ID)
    # demo-site 模板确实引用 site.css + main.js, 都有 → 应空
    assert missing == []


@pytest.mark.asyncio
async def test_C2_site_publish_with_missing(db):
    """main.js 缺失 → 422 应报"""
    # 删 main.js (如果存在)
    r = await db.execute(
        SiteAsset.__table__.select().where(
            SiteAsset.site_id == SITE_ID, SiteAsset.name == "main.js",
        )
    )
    asset = r.first()
    if asset:
        await db.execute(
            SiteAsset.__table__.delete().where(SiteAsset.id == asset[0])
        )
        await db.commit()

    missing = await check_missing_assets_for_site_publish(db, SITE_ID)
    # demo-site 的 3975642d layout 用 main.js
    names = {m.name for m in missing}
    assert "main.js" in names
    # 全部都是 hy source
    sources = {m.source for m in missing}
    assert sources == {"hy"}


@pytest.mark.asyncio
async def test_C3_category_publish_same_as_site(db):
    """栏目发布: site+category scope 跟整站检查范围一致 (demo 模板)"""
    missing_site = await check_missing_assets_for_site_publish(db, SITE_ID)
    missing_cat = await check_missing_assets_for_category_publish(
        db, SITE_ID, uuid.uuid4()
    )
    # demo-site 没有 category-scope layout, 所以栏目检查只看 site scope
    # 应该跟整站 site 部分的检查相同
    site_only = [m for m in missing_site if m.layout_scope == "site"]
    assert sorted(site_only, key=lambda m: m.layout_id) == \
           sorted(missing_cat, key=lambda m: m.layout_id)


@pytest.mark.asyncio
async def test_C4_content_publish_checks_site_and_content(db):
    """文章发布: site + content scope"""
    missing = await check_missing_assets_for_content_publish(
        db, SITE_ID, uuid.uuid4()
    )
    scopes = {m.layout_scope for m in missing}
    # 只会包含 site/content scope (不会包含 category/home)
    assert scopes.issubset({"site", "content"})


@pytest.mark.asyncio
async def test_C5_missing_asset_has_layout_info(db):
    """MissingAsset 返 layout_id/code/scope 全字段"""
    missing = await check_missing_assets_for_site_publish(db, SITE_ID)
    for m in missing:
        assert isinstance(m, MissingAsset)
        assert m.name
        assert m.source in ("link", "script", "hy")
        assert m.layout_id
        assert m.layout_code
        assert m.layout_scope in ("site", "category", "content", "home")


# === fixture: async DB ===

import pytest_asyncio
from app.db.session import engine, AsyncSessionLocal
from app.core.deps import get_current_user
from app.main import app
from httpx import AsyncClient, ASGITransport
from dataclasses import dataclass


@dataclass
class FakeUser:
    id: str = "u1"
    is_super_admin: bool = True
    name: str = "test"
    email: str = "t@x.com"


async def _fake_user():
    return FakeUser()


@pytest.fixture(autouse=True)
def _override_deps():
    app.dependency_overrides[get_current_user] = _fake_user
    yield
    app.dependency_overrides.clear()


@pytest_asyncio.fixture(loop_scope="session")
async def db():
    """每 test 一个新 AsyncSession, 跑完自动 close"""
    async with AsyncSessionLocal() as session:
        try:
            yield session
        finally:
            await session.close()
