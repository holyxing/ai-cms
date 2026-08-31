"""远程部署服务器 API + 站点远程发布配置"""
import uuid
from datetime import datetime, timezone
from typing import Annotated, Any

from fastapi import APIRouter, Depends
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentUser
from app.core.exceptions import BadRequest, Forbidden, NotFound
from app.core.responses import ok
from app.db.session import get_db
from app.models.deploy_server import DeployServer
from app.models.membership import SiteMember
from app.models.site import Site
from app.models.user import User
from app.schemas.deploy_server import (
    DeployServerCreate,
    DeployServerRead,
    DeployServerUpdate,
    RemoteSyncRequest,
    SiteRemoteDeployConfig,
)
from app.services.remote_deploy import (
    encrypt_deploy_secret,
    get_site_remote_deploy_config,
    resolve_remote_path,
    run_rsync_sync,
    server_to_read_dict,
    test_ssh_connection,
)

router = APIRouter(tags=["deploy"])


async def _require_super_or_owner(db: AsyncSession, user: User) -> None:
    if user.is_super_admin:
        return
    raise Forbidden("仅超级管理员可管理远程部署服务器")


async def _get_site_role(db: AsyncSession, site: Site, user: User) -> str | None:
    if user.is_super_admin or site.owner_id == user.id:
        return "owner"
    r = await db.execute(
        select(SiteMember.name).where(
            SiteMember.site_id == site.id,
            SiteMember.user_id == user.id,
            SiteMember.deleted_at.is_(None),
        )
    )
    return r.scalar_one_or_none()


def _can_write(role: str | None) -> bool:
    return role in ("owner", "editor")


@router.get("/deploy-servers", response_model=None)
async def list_deploy_servers(
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    _ = current_user
    rows = (await db.execute(
        select(DeployServer).where(DeployServer.deleted_at.is_(None)).order_by(DeployServer.is_default.desc(), DeployServer.name)
    )).scalars().all()
    return ok({"items": [server_to_read_dict(s) for s in rows], "total": len(rows)})


@router.post("/deploy-servers", response_model=None, status_code=201)
async def create_deploy_server(
    body: DeployServerCreate,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    await _require_super_or_owner(db, current_user)
    if body.auth_type == "pem" and not body.private_key and not body.private_key_path:
        raise BadRequest("PEM 认证需上传 private_key 或填写 private_key_path")
    if body.auth_type == "password" and not body.password:
        raise BadRequest("password 认证需填写 password")

    if body.is_default:
        await db.execute(
            update(DeployServer).where(DeployServer.deleted_at.is_(None)).values(is_default=False)
        )

    s = DeployServer(
        name=body.name.strip(),
        host=body.host.strip(),
        port=body.port,
        username=body.username.strip(),
        auth_type=body.auth_type,
        password_encrypted=encrypt_deploy_secret(body.password) if body.auth_type == "password" else None,
        private_key_encrypted=encrypt_deploy_secret(body.private_key) if body.private_key else None,
        private_key_path=(body.private_key_path or "").strip() or None,
        remote_base_path=body.remote_base_path.strip() or "/var/www/sites",
        is_default=body.is_default,
    )
    db.add(s)
    await db.commit()
    await db.refresh(s)
    return ok(server_to_read_dict(s), message="已创建")


@router.patch("/deploy-servers/{server_id}", response_model=None)
async def update_deploy_server(
    server_id: uuid.UUID,
    body: DeployServerUpdate,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    await _require_super_or_owner(db, current_user)
    s = await db.get(DeployServer, server_id)
    if not s or s.deleted_at:
        raise NotFound("服务器不存在")

    if body.name is not None:
        s.name = body.name.strip()
    if body.host is not None:
        s.host = body.host.strip()
    if body.port is not None:
        s.port = body.port
    if body.username is not None:
        s.username = body.username.strip()
    if body.auth_type is not None:
        s.auth_type = body.auth_type
    if body.password is not None:
        s.password_encrypted = encrypt_deploy_secret(body.password)
    if body.private_key is not None:
        s.private_key_encrypted = encrypt_deploy_secret(body.private_key)
    if body.private_key_path is not None:
        s.private_key_path = body.private_key_path.strip() or None
    if body.remote_base_path is not None:
        s.remote_base_path = body.remote_base_path.strip() or "/var/www/sites"
    if body.is_default is not None:
        if body.is_default:
            await db.execute(
                update(DeployServer).where(DeployServer.deleted_at.is_(None)).values(is_default=False)
            )
        s.is_default = body.is_default

    await db.commit()
    await db.refresh(s)
    return ok(server_to_read_dict(s), message="已更新")


@router.delete("/deploy-servers/{server_id}", response_model=None)
async def delete_deploy_server(
    server_id: uuid.UUID,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    await _require_super_or_owner(db, current_user)
    s = await db.get(DeployServer, server_id)
    if not s or s.deleted_at:
        raise NotFound("服务器不存在")
    s.deleted_at = datetime.now(timezone.utc)
    await db.commit()
    return ok(message="已删除")


@router.post("/deploy-servers/{server_id}/test", response_model=None)
async def test_deploy_server(
    server_id: uuid.UUID,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    await _require_super_or_owner(db, current_user)
    s = await db.get(DeployServer, server_id)
    if not s or s.deleted_at:
        raise NotFound("服务器不存在")
    result = test_ssh_connection(s)
    return ok({
        "ok": result.ok,
        "duration_ms": result.duration_ms,
        "log": result.log,
    }, message="连接成功" if result.ok else "连接失败")


async def _resolve_server_for_site(
    db: AsyncSession, site: Site,
) -> DeployServer | None:
    cfg = get_site_remote_deploy_config(site)
    if not cfg.get("enabled"):
        return None
    server_id = cfg.get("server_id")
    if server_id:
        s = await db.get(DeployServer, uuid.UUID(str(server_id)))
        if s and not s.deleted_at:
            return s
    # 默认服务器
    r = await db.execute(
        select(DeployServer).where(
            DeployServer.deleted_at.is_(None),
            DeployServer.is_default.is_(True),
        ).limit(1)
    )
    return r.scalar_one_or_none()


@router.get("/sites/{site_id}/remote-deploy", response_model=None)
async def get_site_remote_deploy(
    site_id: uuid.UUID,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    site = await db.get(Site, site_id)
    if not site or site.deleted_at:
        raise NotFound("站点不存在")
    role = await _get_site_role(db, site, current_user)
    if not _can_write(role):
        raise Forbidden("无权访问")
    cfg = get_site_remote_deploy_config(site)
    server = await _resolve_server_for_site(db, site)
    remote_preview = None
    if server:
        remote_preview = resolve_remote_path(
            server, site.slug,
            override=cfg.get("remote_path"),
        )
    return ok({
        "config": cfg,
        "resolved_server": server_to_read_dict(server) if server else None,
        "remote_path_preview": remote_preview,
    })


@router.put("/sites/{site_id}/remote-deploy", response_model=None)
async def update_site_remote_deploy(
    site_id: uuid.UUID,
    body: SiteRemoteDeployConfig,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    site = await db.get(Site, site_id)
    if not site or site.deleted_at:
        raise NotFound("站点不存在")
    role = await _get_site_role(db, site, current_user)
    if not _can_write(role):
        raise Forbidden("无权修改")

    if body.server_id:
        s = await db.get(DeployServer, body.server_id)
        if not s or s.deleted_at:
            raise BadRequest("deploy server 不存在")

    settings = dict(site.settings or {})
    settings["remote_deploy"] = {
        "enabled": body.enabled,
        "server_id": str(body.server_id) if body.server_id else None,
        "remote_path": (body.remote_path or "").strip() or None,
    }
    site.settings = settings
    await db.commit()
    return ok(get_site_remote_deploy_config(site), message="已保存")


@router.post("/sites/{site_id}/remote-sync", response_model=None)
async def trigger_remote_sync(
    site_id: uuid.UUID,
    body: RemoteSyncRequest,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """仅远程 rsync，不重新构建。"""
    from app.core.config import get_settings
    settings = get_settings()

    site = await db.get(Site, site_id)
    if not site or site.deleted_at:
        raise NotFound("站点不存在")
    role = await _get_site_role(db, site, current_user)
    if not _can_write(role):
        raise Forbidden("无权操作")

    server = await _resolve_server_for_site(db, site)
    if not server:
        raise BadRequest("未启用远程发布或未配置部署服务器")

    cfg = get_site_remote_deploy_config(site)
    local_dir = f"{settings.SITES_DATA_DIR}/{site.slug}/public"
    remote_dir = resolve_remote_path(server, site.slug, override=cfg.get("remote_path"))

    result = run_rsync_sync(
        server, local_dir, remote_dir,
        delete_extraneous=body.delete_extraneous,
    )
    return ok({
        "ok": result.ok,
        "duration_ms": result.duration_ms,
        "remote_path": result.remote_path,
        "log": result.log,
    }, message="同步成功" if result.ok else "同步失败")
