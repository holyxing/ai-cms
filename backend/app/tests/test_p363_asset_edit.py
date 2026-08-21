"""P3.6.3 单测 - site_assets 在线编辑 (8 cases)

范围:
A. PUT /content 端点 (5): 成功 + 不可编辑拒 + 空内容拒 + 超大拒 + 重算 byte_size
B. GET /content 端点 (3): editable=true (text) + editable=false (png) + 404

用 httpx.AsyncClient + ASGITransport 避免 sync TestClient 跟 async DB 的 event loop 冲突
"""
import os
from dataclasses import dataclass
import pytest
import httpx
from httpx import ASGITransport

from app.main import app
from app.core.deps import get_current_user
from app.core.config import get_settings
from app.db.session import engine


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
    """覆盖鉴权为 super_admin"""
    app.dependency_overrides[get_current_user] = _fake_user
    yield
    app.dependency_overrides.clear()


@pytest.fixture
async def client():
    transport = ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        yield c
    # 测试间 dispose asyncpg 引擎, 避免 "Event loop is closed" 跨 loop 问题
    await engine.dispose()


SITE_ID = "2ea67357-ca1d-4da1-b1c8-f65e17fba8f1"
settings = get_settings()


# === A. PUT /content ===

@pytest.mark.asyncio
async def test_A1_update_text_css_success(client):
    """text/css 可在线编辑, 改后 byte_size 重算, 磁盘同步"""
    new_content = "/* P3.6.3 edited */ body { background: red; }"
    r = await client.put(
        f"/api/v1/sites/{SITE_ID}/assets/site.css/content",
        json={"content": new_content},
    )
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["byte_size"] == len(new_content.encode("utf-8"))
    fp = f"{settings.SITE_ASSETS_DIR}/{SITE_ID}/site.css"
    assert os.path.exists(fp)
    with open(fp) as f:
        assert f.read() == new_content


@pytest.mark.asyncio
async def test_A2_update_javascript_success(client):
    """application/javascript 可在线编辑"""
    new_content = "// P3.6.3\nconsole.log('edited at test');"
    r1 = await client.post(
        f"/api/v1/sites/{SITE_ID}/assets",
        data={"name": "p363-test.js"},
        files={"file": ("p363-test.js", new_content.encode(), "application/javascript")},
    )
    assert r1.status_code == 200, r1.text
    new_content2 = "// edited again\nconsole.log('v2');"
    r2 = await client.put(
        f"/api/v1/sites/{SITE_ID}/assets/p363-test.js/content",
        json={"content": new_content2},
    )
    assert r2.status_code == 200
    assert r2.json()["byte_size"] == len(new_content2.encode("utf-8"))
    fp = f"{settings.SITE_ASSETS_DIR}/{SITE_ID}/p363-test.js"
    with open(fp) as f:
        assert f.read() == new_content2
    await client.delete(f"/api/v1/sites/{SITE_ID}/assets/p363-test.js")


@pytest.mark.asyncio
async def test_A3_update_binary_rejected(client):
    """image/png 不可编辑 → 400"""
    png_data = b"\x89PNG\r\n\x1a\n" + b"\x00" * 100
    r1 = await client.post(
        f"/api/v1/sites/{SITE_ID}/assets",
        data={"name": "p363-test.png"},
        files={"file": ("p363-test.png", png_data, "image/png")},
    )
    assert r1.status_code == 200
    r2 = await client.put(
        f"/api/v1/sites/{SITE_ID}/assets/p363-test.png/content",
        json={"content": "x"},
    )
    assert r2.status_code == 400
    assert "不支持在线编辑" in r2.json()["message"]
    await client.delete(f"/api/v1/sites/{SITE_ID}/assets/p363-test.png")


@pytest.mark.asyncio
async def test_A4_update_empty_rejected(client):
    """空内容 → 422 (Pydantic min_length=1)"""
    r = await client.put(
        f"/api/v1/sites/{SITE_ID}/assets/site.css/content",
        json={"content": ""},
    )
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_A5_update_oversize_rejected(client):
    """>1MB 内容 → 422 (Pydantic max_length)"""
    big = "a" * (1024 * 1024 + 1)
    r = await client.put(
        f"/api/v1/sites/{SITE_ID}/assets/site.css/content",
        json={"content": big},
    )
    assert r.status_code == 422


# === B. GET /content ===

@pytest.mark.asyncio
async def test_B1_get_editable_text(client):
    """text/css → editable=true, 返内容"""
    r = await client.get(f"/api/v1/sites/{SITE_ID}/assets/site.css/content")
    assert r.status_code == 200
    data = r.json()["data"]
    assert data["editable"] is True
    assert data["content_type"] == "text/css"
    assert len(data["content"]) > 0


@pytest.mark.asyncio
async def test_B2_get_not_editable_png(client):
    """image/png → editable=false, content='' """
    png_data = b"\x89PNG\r\n\x1a\n" + b"\x00" * 50
    r1 = await client.post(
        f"/api/v1/sites/{SITE_ID}/assets",
        data={"name": "p363-binary.png"},
        files={"file": ("p363-binary.png", png_data, "image/png")},
    )
    assert r1.status_code == 200
    r2 = await client.get(f"/api/v1/sites/{SITE_ID}/assets/p363-binary.png/content")
    assert r2.status_code == 200
    data = r2.json()["data"]
    assert data["editable"] is False
    assert data["content"] == ""
    await client.delete(f"/api/v1/sites/{SITE_ID}/assets/p363-binary.png")


@pytest.mark.asyncio
async def test_B3_get_nonexistent_404(client):
    """不存在的资源 → 404"""
    r = await client.get(f"/api/v1/sites/{SITE_ID}/assets/nonexistent.css/content")
    assert r.status_code == 404
