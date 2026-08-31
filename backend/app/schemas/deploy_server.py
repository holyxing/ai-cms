"""远程部署 Pydantic schemas"""
import uuid
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


AuthType = Literal["pem", "password"]
RemoteSyncStatus = Literal["pending", "syncing", "success", "failed", "skipped"]


class DeployServerCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    host: str = Field(..., min_length=1, max_length=255)
    port: int = Field(22, ge=1, le=65535)
    username: str = Field(..., min_length=1, max_length=100)
    auth_type: AuthType = "pem"
    password: Optional[str] = Field(None, max_length=500)
    private_key: Optional[str] = Field(None, max_length=20000, description="PEM 私钥全文")
    private_key_path: Optional[str] = Field(
        None, max_length=500,
        description="Worker 容器内 PEM 路径（挂载密钥时用）",
    )
    remote_base_path: str = Field("/var/www/sites", max_length=500)
    is_default: bool = False


class DeployServerUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    host: Optional[str] = Field(None, min_length=1, max_length=255)
    port: Optional[int] = Field(None, ge=1, le=65535)
    username: Optional[str] = Field(None, min_length=1, max_length=100)
    auth_type: Optional[AuthType] = None
    password: Optional[str] = Field(None, max_length=500)
    private_key: Optional[str] = Field(None, max_length=20000)
    private_key_path: Optional[str] = Field(None, max_length=500)
    remote_base_path: Optional[str] = Field(None, max_length=500)
    is_default: Optional[bool] = None


class DeployServerRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    host: str
    port: int
    username: str
    auth_type: str
    private_key_path: Optional[str] = None
    remote_base_path: str
    is_default: bool
    has_password: bool = False
    has_private_key: bool = False


class SiteRemoteDeployConfig(BaseModel):
    """站点级远程发布配置（存 site.settings.remote_deploy）"""
    enabled: bool = False
    server_id: Optional[uuid.UUID] = None
    # 可选覆盖远程目录；留空则 {remote_base_path}/{site_slug}/public/
    remote_path: Optional[str] = Field(None, max_length=500)


class RemoteSyncRequest(BaseModel):
    """手动触发远程同步"""
    delete_extraneous: bool = False
