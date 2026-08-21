"""应用配置"""
from functools import lru_cache
from typing import Literal

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """应用配置（从 .env 读取）"""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # ====== 基础 ======
    PROJECT_NAME: str = "AI-CMS"
    VERSION: str = "0.1.0"
    DEBUG: bool = True
    ENV: Literal["dev", "prod", "test"] = "dev"
    TZ: str = "Asia/Shanghai"

    # ====== API ======
    API_V1_PREFIX: str = "/api/v1"
    FRONTEND_BASE: str = Field(
        default="http://localhost:18889",
        description="前端 base URL (用于生成邀请链接等)",
    )
    CORS_ORIGINS: str = Field(
        default="http://localhost,http://localhost:5173,http://localhost:18888,http://localhost:18889",
        description="CORS 允许的来源列表,逗号分隔",
    )

    @property
    def cors_origins_list(self) -> list[str]:
        """解析 CORS_ORIGINS 为列表"""
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]

    # ====== 安全 ======
    SECRET_KEY: str = "dev-secret-key-please-change-in-production-32bytes-min"
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24  # 开发期放宽到 24h
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7

    # ====== 数据库 ======
    DATABASE_URL: str = "postgresql+asyncpg://ai_cms:ai_cms@localhost:5432/ai_cms"
    DB_ECHO: bool = False
    DB_POOL_SIZE: int = 20
    DB_MAX_OVERFLOW: int = 10

    # ====== Redis ======
    REDIS_URL: str = "redis://localhost:6379/0"

    # ====== MinIO ======
    MINIO_ENDPOINT: str = "localhost:9000"
    MINIO_ACCESS_KEY: str = "ai_cms"
    MINIO_SECRET_KEY: str = "ai_cms_secret"
    MINIO_BUCKET: str = "media"
    MINIO_SECURE: bool = False
    MINIO_PUBLIC_URL: str = "http://localhost:9000"

    # ====== AI Providers ======
    AI_DEFAULT_PROVIDER: str = "ollama"  # P3.0 范围: 仅 ollama
    OPENAI_API_KEY: str = ""
    OPENAI_BASE_URL: str = "https://api.openai.com/v1"
    ANTHROPIC_API_KEY: str = ""
    OLLAMA_BASE_URL: str = "http://localhost:11434"
    # P3-minimax: minimax (OpenAI 兼容, 2026-06-06 接入)
    MINIMAX_API_KEY: str = ""
    MINIMAX_BASE_URL: str = "https://api.minimaxi.com/v1"
    MINIMAX_DEFAULT_MODEL: str = "abab6.5s-chat"

    # ====== SSG ======
    SSG_OUTPUT_DIR: str = "/var/www/sites"
    SSG_TEMPLATE_DIR: str = "/app/ssg/_template"
    # P2 D1 决策: 默认 stub 模式 (不跑真构建), Day 6 装 Node 后翻 True
    ASTRO_ENABLED: bool = False
    # D5 决策: 走 LayoutRenderer (D4 build_site) 路径, 取代 stub
    # 与 ASTRO_ENABLED 互斥: LAYOUT_BUILD=True 且 ASTRO=False → 走 D4
    LAYOUT_BUILD_ENABLED: bool = True
    # Astro build 路径: 装了 Node 后用 npx, 未装用 stub
    ASTRO_BUILD_CMD: str = "npx astro build"
    # 真构建超时 (s), Astro SSG 顶层 10min, 这里只给 astro build 8min
    ASTRO_TIMEOUT_SECONDS: int = 480
    # 站点产物输出 (C5 软链点这里)
    # 与 nginx /var/www/sites/ 共享同一个 named volume sites_data
    SITES_DATA_DIR: str = "/var/www/sites"

    # 站点级静态资源存储 (模板/主题自带的 CSS/JS/字体/Logo)
    # 跟 ssg/_template 平级, 路径: {SITE_ASSETS_DIR}/{site_id}/{name}
    SITE_ASSETS_DIR: str = "/app/ssg/site_assets"
    # 静态资源单文件最大尺寸 (默认 5MB, 模板资源一般不大)
    SITE_ASSET_MAX_SIZE: int = 5 * 1024 * 1024

    # B5 host-based 域名映射: nginx 容器读这个目录的 sites.map
    # 与 nginx /etc/nginx/conf.d 共享同一个 named volume nginx_conf
    NGINX_CONF_DIR: str = "/etc/nginx/conf.d"
    NGINX_SITES_MAP: str = "/etc/nginx/conf.d/sites.map"

    # ====== 限流 ======
    RATE_LIMIT_PER_MINUTE: int = 120

    # ====== P3.1 Fernet 加密密钥 (AI API key 用) ======
    # 生产环境必须通过 .env 注入 (32 字节 url-safe base64)
    # 开发环境可空, 但调用加密时仍会 fail-fast (见 app.core.crypto)
    FERNET_KEY: str = ""

    @model_validator(mode="after")
    def _fernet_required_in_prod(self):
        """生产环境未配置 FERNET_KEY 时直接启动失败"""
        if self.ENV == "prod" and not (self.FERNET_KEY or "").strip():
            raise ValueError(
                "生产环境必须配置 FERNET_KEY (Fernet 对称加密密钥)。"
                '生成方式: python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"'
            )
        return self

    # ====== P5.2 邮件 (SMTP) ======
    SMTP_HOST: str = ""  # 空 = 不发邮件
    SMTP_PORT: int = 587
    SMTP_USER: str = ""
    SMTP_PASSWORD: str = ""
    SMTP_FROM: str = "noreply@aicms.io"
    # 公开的 URL 前缀, 拼 reset link 用 (含 /admin 前缀因为前端 SPA 在 /admin 下)
    PUBLIC_URL: str = "http://localhost/admin"


@lru_cache
def get_settings() -> Settings:
    """获取单例配置"""
    return Settings()
