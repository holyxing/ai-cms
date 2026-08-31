"""远程 SSH/rsync 部署服务

本地构建完成后，将 {SITES_DATA_DIR}/{slug}/public/ 增量同步到远程服务器。
"""
import os
import uuid
import shlex
import subprocess
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from loguru import logger

from app.core.crypto import decrypt_api_key, encrypt_api_key
from app.models.deploy_server import DeployServer
from app.models.site import Site


LOG_TAIL = 64 * 1024


@dataclass
class RemoteSyncResult:
    ok: bool
    duration_ms: int
    log: str
    remote_path: str = ""


def _truncate_log(text: str, limit: int = LOG_TAIL) -> str:
    if not text:
        return ""
    if len(text) <= limit:
        return text
    return f"...(truncated)\n{text[-limit:]}"


def get_site_remote_deploy_config(site: Site) -> dict:
    settings = site.settings if isinstance(site.settings, dict) else {}
    cfg = settings.get("remote_deploy") or {}
    if not isinstance(cfg, dict):
        return {"enabled": False, "server_id": None, "remote_path": None}
    return {
        "enabled": bool(cfg.get("enabled")),
        "server_id": cfg.get("server_id"),
        "remote_path": cfg.get("remote_path"),
    }


def resolve_remote_path(
    server: DeployServer,
    site_slug: str,
    *,
    override: Optional[str] = None,
) -> str:
    """计算远程目标目录（末尾带 /）。"""
    if override:
        p = override.strip()
        if p.startswith("/"):
            return p.rstrip("/") + "/"
        base = (server.remote_base_path or "/var/www/sites").rstrip("/")
        return f"{base}/{p.strip('/')}/"
    base = (server.remote_base_path or "/var/www/sites").rstrip("/")
    return f"{base}/{site_slug}/public/"


def _decrypt_secret(token: Optional[str]) -> Optional[str]:
    if not token:
        return None
    try:
        return decrypt_api_key(token)
    except Exception as e:
        raise RuntimeError(f"凭据解密失败: {e}") from e


class _KeyTempFile:
    def __init__(self) -> None:
        self.path: Optional[str] = None
        self._fh: Optional[tempfile._TemporaryFileWrapper] = None

    def write_pem(self, pem: str) -> str:
        self._fh = tempfile.NamedTemporaryFile(mode="w", prefix="deploy_key_", delete=False)
        self._fh.write(pem.strip() + "\n")
        self._fh.flush()
        self._fh.close()
        self.path = self._fh.name
        os.chmod(self.path, 0o600)
        return self.path

    def cleanup(self) -> None:
        if self.path and os.path.isfile(self.path):
            try:
                os.unlink(self.path)
            except OSError:
                pass

    def from_file(self, src_path: str) -> str:
        """从挂载路径复制到临时文件（避免只读卷权限 0644 导致 SSH 拒绝）。"""
        with open(src_path, encoding="utf-8") as f:
            return self.write_pem(f.read())


def _prepare_ssh(server: DeployServer, key_temp: _KeyTempFile) -> tuple[list[str], dict[str, str]]:
    """返回 (ssh 命令 argv 前缀, env)。"""
    env = os.environ.copy()
    ssh_parts = [
        "ssh",
        "-p", str(server.port or 22),
        "-o", "StrictHostKeyChecking=accept-new",
        "-o", "BatchMode=yes",
        "-o", "ConnectTimeout=30",
    ]
    if server.auth_type == "pem":
        key_path = (server.private_key_path or "").strip()
        if server.private_key_encrypted:
            pem = _decrypt_secret(server.private_key_encrypted)
            if not pem:
                raise RuntimeError("PEM 私钥未配置")
            key_path = key_temp.write_pem(pem)
        elif key_path:
            key_path = key_temp.from_file(key_path)
        if not key_path or not os.path.isfile(key_path):
            raise RuntimeError("PEM 私钥路径无效，请上传密钥或配置 private_key_path")
        ssh_parts.extend(["-i", key_path])
    elif server.auth_type == "password":
        pwd = _decrypt_secret(server.password_encrypted)
        if not pwd:
            raise RuntimeError("SSH 密码未配置")
        env["SSHPASS"] = pwd
        return ["sshpass", "-e"] + ssh_parts, env
    else:
        raise RuntimeError(f"不支持的 auth_type: {server.auth_type}")
    return ssh_parts, env


def _ensure_remote_dir(
    server: DeployServer,
    remote_dir: str,
    *,
    timeout_sec: int = 30,
) -> tuple[bool, str]:
    """SSH 预先创建远程目录（rsync 不会自动建多级父目录）。"""
    key_temp = _KeyTempFile()
    remote_path = remote_dir.rstrip("/")
    try:
        ssh_parts, env = _prepare_ssh(server, key_temp)
        cmd = ssh_parts + [
            f"{server.username}@{server.host}",
            f"mkdir -p {shlex.quote(remote_path)}",
        ]
        proc = subprocess.run(
            cmd, env=env, capture_output=True, text=True, timeout=timeout_sec,
        )
        if proc.returncode != 0:
            err = (proc.stderr or proc.stdout or f"exit={proc.returncode}").strip()
            return False, f"[remote-sync] mkdir failed: {err}"
        return True, f"[remote-sync] mkdir -p {remote_path}"
    except Exception as e:
        return False, f"[remote-sync] mkdir error: {e}"
    finally:
        key_temp.cleanup()


def _build_rsync_command(
    server: DeployServer,
    local_dir: str,
    remote_dir: str,
    *,
    delete_extraneous: bool,
) -> tuple[list[str], dict[str, str], _KeyTempFile]:
    """组装 rsync 命令；返回 (cmd, env, key_temp)。"""
    local = Path(local_dir)
    if not local.is_dir():
        raise FileNotFoundError(f"本地目录不存在: {local_dir}")

    key_temp = _KeyTempFile()
    ssh_parts, env = _prepare_ssh(server, key_temp)
    ssh_e = " ".join(shlex.quote(p) for p in ssh_parts)
    dest = f"{server.username}@{server.host}:{remote_dir}"
    cmd = [
        "rsync", "-avz", "--partial", "--human-readable", "--mkpath",
        "-e", ssh_e,
    ]
    if delete_extraneous:
        cmd.append("--delete")
    cmd.append(f"{local.as_posix().rstrip('/')}/")
    cmd.append(dest)
    return cmd, env, key_temp


def run_rsync_sync(
    server: DeployServer,
    local_dir: str,
    remote_dir: str,
    *,
    delete_extraneous: bool = False,
    timeout_sec: int = 600,
) -> RemoteSyncResult:
    """执行 rsync 增量同步（阻塞调用）。"""
    started = time.monotonic()
    log_lines = [
        f"[remote-sync] {local_dir} → {server.username}@{server.host}:{remote_dir}",
        f"[remote-sync] delete_extraneous={delete_extraneous}",
    ]
    try:
        ok_mk, mk_log = _ensure_remote_dir(server, remote_dir, timeout_sec=min(30, timeout_sec))
        log_lines.append(mk_log)
        if not ok_mk:
            duration_ms = int((time.monotonic() - started) * 1000)
            return RemoteSyncResult(ok=False, duration_ms=duration_ms, log="\n".join(log_lines), remote_path=remote_dir)

        cmd, env, key_temp = _build_rsync_command(
            server, local_dir, remote_dir, delete_extraneous=delete_extraneous,
        )
        log_lines.append(f"[remote-sync] cmd: {' '.join(shlex.quote(c) for c in cmd)}")
        proc = subprocess.run(
            cmd,
            env=env,
            capture_output=True,
            text=True,
            timeout=timeout_sec,
        )
        if proc.stdout:
            log_lines.append(proc.stdout.strip())
        if proc.stderr:
            log_lines.append(proc.stderr.strip())
        duration_ms = int((time.monotonic() - started) * 1000)
        if proc.returncode != 0:
            log_lines.append(f"[remote-sync] FAILED exit={proc.returncode}")
            return RemoteSyncResult(
                ok=False,
                duration_ms=duration_ms,
                log=_truncate_log("\n".join(log_lines)),
                remote_path=remote_dir,
            )
        log_lines.append(f"[remote-sync] OK ({duration_ms} ms)")
        return RemoteSyncResult(
            ok=True,
            duration_ms=duration_ms,
            log=_truncate_log("\n".join(log_lines)),
            remote_path=remote_dir,
        )
    except subprocess.TimeoutExpired:
        duration_ms = int((time.monotonic() - started) * 1000)
        log_lines.append(f"[remote-sync] TIMEOUT after {timeout_sec}s")
        return RemoteSyncResult(ok=False, duration_ms=duration_ms, log="\n".join(log_lines), remote_path=remote_dir)
    except Exception as e:
        duration_ms = int((time.monotonic() - started) * 1000)
        log_lines.append(f"[remote-sync] ERROR: {type(e).__name__}: {e}")
        return RemoteSyncResult(ok=False, duration_ms=duration_ms, log="\n".join(log_lines), remote_path=remote_dir)
    finally:
        key_temp.cleanup()


def test_ssh_connection(server: DeployServer, *, timeout_sec: int = 15) -> RemoteSyncResult:
    """测试 SSH 连通性。"""
    started = time.monotonic()
    key_temp = _KeyTempFile()
    log_lines = [f"[ssh-test] {server.username}@{server.host}:{server.port}"]
    try:
        ssh_parts, env = _prepare_ssh(server, key_temp)
        run_cmd = ssh_parts + [f"{server.username}@{server.host}", "echo OK"]
        proc = subprocess.run(
            run_cmd, env=env, capture_output=True, text=True, timeout=timeout_sec,
        )
        duration_ms = int((time.monotonic() - started) * 1000)
        if proc.returncode == 0 and "OK" in (proc.stdout or ""):
            log_lines.append("[ssh-test] 连接成功")
            return RemoteSyncResult(ok=True, duration_ms=duration_ms, log="\n".join(log_lines))
        log_lines.append((proc.stderr or proc.stdout or f"exit={proc.returncode}").strip())
        return RemoteSyncResult(ok=False, duration_ms=duration_ms, log="\n".join(log_lines))
    except Exception as e:
        duration_ms = int((time.monotonic() - started) * 1000)
        log_lines.append(f"[ssh-test] ERROR: {e}")
        return RemoteSyncResult(ok=False, duration_ms=duration_ms, log="\n".join(log_lines))
    finally:
        key_temp.cleanup()


def encrypt_deploy_secret(plain: Optional[str]) -> Optional[str]:
    if not plain:
        return None
    return encrypt_api_key(plain)


def server_to_read_dict(server: DeployServer) -> dict:
    return {
        "id": str(server.id),
        "name": server.name,
        "host": server.host,
        "port": server.port,
        "username": server.username,
        "auth_type": server.auth_type,
        "private_key_path": server.private_key_path,
        "remote_base_path": server.remote_base_path,
        "is_default": server.is_default,
        "has_password": bool(server.password_encrypted),
        "has_private_key": bool(server.private_key_encrypted or server.private_key_path),
    }


async def sync_site_after_publish(
    db,
    site: Site,
    deployment,
    *,
    sync_remote: bool = True,
    delete_extraneous: bool = False,
) -> None:
    """本地构建成功后，可选 rsync 到远程服务器。"""
    from sqlalchemy import select

    if not sync_remote:
        deployment.remote_sync_status = "skipped"
        deployment.remote_sync_log = "sync_remote=false"
        return

    cfg = get_site_remote_deploy_config(site)
    if not cfg.get("enabled"):
        deployment.remote_sync_status = "skipped"
        deployment.remote_sync_log = "站点未启用远程发布"
        return

    server_id = cfg.get("server_id")
    server: Optional[DeployServer] = None
    if server_id:
        server = await db.get(DeployServer, uuid.UUID(str(server_id)))
    if not server or server.deleted_at:
        r = await db.execute(
            select(DeployServer).where(
                DeployServer.deleted_at.is_(None),
                DeployServer.is_default.is_(True),
            ).limit(1)
        )
        server = r.scalar_one_or_none()
    if not server:
        deployment.remote_sync_status = "failed"
        deployment.remote_sync_log = "未找到部署服务器（请配置默认服务器或指定 server_id）"
        return

    from app.core.config import get_settings
    settings = get_settings()
    local_dir = deployment.artifact_path or f"{settings.SITES_DATA_DIR}/{site.slug}/public"
    remote_dir = resolve_remote_path(server, site.slug, override=cfg.get("remote_path"))

    deployment.remote_sync_status = "syncing"
    await db.commit()

    result = run_rsync_sync(
        server, local_dir, remote_dir, delete_extraneous=delete_extraneous,
    )
    deployment.remote_sync_status = "success" if result.ok else "failed"
    deployment.remote_sync_log = result.log
    deployment.remote_sync_duration_ms = result.duration_ms
    if not result.ok:
        logger.warning(f"remote sync failed site={site.slug} deployment={deployment.id}")
