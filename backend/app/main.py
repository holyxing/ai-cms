"""AI-CMS FastAPI 应用入口"""
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from loguru import logger
from sqlalchemy import text

from app.api.v1.router import api_router
from app.core.config import get_settings
from app.core.exceptions import AppException
from app.core.responses import err
from app.core.ratelimit import limiter, rate_limit_exceeded_handler
from app.db.session import engine, AsyncSessionLocal
# 触发 SQLAlchemy 模型注册
from app import models  # noqa: F401

settings = get_settings()


# ====== 生命周期 ======
@asynccontextmanager
async def lifespan(app: FastAPI):
    """启动/关闭钩子"""
    # 启动
    logger.info(f"🚀 {settings.PROJECT_NAME} v{settings.VERSION} 启动中...")
    logger.info(f"📍 环境: {settings.ENV}")
    logger.info(f"🔗 CORS: {settings.CORS_ORIGINS}")

    # 检查数据库连通性
    try:
        async with engine.begin() as conn:
            await conn.execute(text("SELECT 1"))
        logger.info("✅ 数据库连接正常")
    except Exception as e:
        logger.error(f"❌ 数据库连接失败: {e}")

    # B5 P2.5: 启动时重建 nginx sites.map (即使中途加的域名也能生效)
    try:
        from app.core.nginx import rebuild_sites_map
        async with AsyncSessionLocal() as db:
            n = await rebuild_sites_map(db)
            logger.info(f"🌐 nginx sites.map 启动重建: {n} 条映射")
    except Exception as e:
        logger.warning(f"⚠️ nginx sites.map 启动重建失败 (非致命): {e}")

    # Prompt 目录种子（YAML + 快捷操作）
    try:
        from app.agents.prompts import ensure_prompts_seeded
        async with AsyncSessionLocal() as db:
            n = await ensure_prompts_seeded(db)
            logger.info(f"📝 AI prompts 就绪 (写入/更新 {n})")
    except Exception as e:
        logger.warning(f"⚠️ AI prompts 种子失败 (非致命): {e}")

    yield

    # 关闭
    logger.info("🛑 关闭中...")
    await engine.dispose()
    logger.info("👋 已关闭")


# ====== 应用 ======
app = FastAPI(
    title=f"{settings.PROJECT_NAME} API",
    version=settings.VERSION,
    description="AI 协作式多站点内容管理与静态发布平台",
    docs_url="/docs" if settings.DEBUG else None,
    redoc_url="/redoc" if settings.DEBUG else None,
    openapi_url="/openapi.json",
    lifespan=lifespan,
)

# P4: 限流
app.state.limiter = limiter
from slowapi.errors import RateLimitExceeded as _RateLimitExceeded
app.add_exception_handler(_RateLimitExceeded, rate_limit_exceeded_handler)


# ====== CORS ======
app.add_middleware(
    CORSMiddleware,
    # dev 环境允许任意 origin (含局域网 IP 192.168.x.x)
    # prod 环境用 CORS_ORIGINS 白名单
    allow_origins=settings.cors_origins_list if settings.ENV == "prod" else ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)


# ====== 全局异常处理 ======
@app.exception_handler(AppException)
async def app_exception_handler(request: Request, exc: AppException):
    """业务异常"""
    logger.warning(f"[{exc.code}] {exc.message} | {request.method} {request.url.path}")
    return JSONResponse(
        status_code=exc.status_code,
        content=err(code=exc.code, message=exc.message, data=exc.data),
    )


from fastapi.exceptions import RequestValidationError


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    """请求参数验证错误 (Pydantic)"""
    errors = []
    for e in exc.errors():
        errors.append({
            "loc": ".".join(str(x) for x in e.get("loc", [])),
            "msg": e.get("msg", ""),
            "type": e.get("type", ""),
        })
    first = errors[0] if errors else {"loc": "", "msg": "请求参数错误"}
    logger.warning(
        f"参数验证失败 | {request.method} {request.url.path} | {first['loc']}: {first['msg']}"
    )
    return JSONResponse(
        status_code=422,
        content=err(
            code=42200,
            message=f"{first['loc']}: {first['msg']}" if errors else "请求参数错误",
            errors=errors,
        ),
    )


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    """未处理异常"""
    logger.exception(f"未处理异常 | {request.method} {request.url.path}: {exc}")
    return JSONResponse(
        status_code=500,
        content=err(code=50000, message="服务器内部错误"),
    )


# ====== 中间件: 请求日志 ======
@app.middleware("http")
async def log_requests(request: Request, call_next):
    start = time.time()
    response = await call_next(request)
    duration = (time.time() - start) * 1000
    logger.info(
        f"{request.method} {request.url.path} | {response.status_code} | {duration:.1f}ms"
    )
    return response


# ====== 中间件: 安全响应头 (P4.2) ======
@app.middleware("http")
async def security_headers(request: Request, call_next):
    """统一加安全响应头。

    依据: docs/05-开发路线图.md P4 (安全: 限流、CORS、CSRF)
    - X-Content-Type-Options: nosniff  → 防 MIME 嗅探
    - X-Frame-Options: DENY           → 防 clickjacking (admin 不嵌入)
    - Referrer-Policy: strict-origin-when-cross-origin
    - Permissions-Policy: 关掉用不到的能力 (mic/camera/geolocation)
    - HSTS: 仅 prod (dev 是 http)
    - CSP: 适度宽松 (admin 要内嵌图片预览, 富文本编辑器要 unsafe-inline)
    """
    response = await call_next(request)
    # 文章实时预览需在 admin iframe 内嵌，不能 DENY
    is_preview_html = request.url.path.rstrip("/").endswith("/preview-html")
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    if is_preview_html:
        response.headers["X-Frame-Options"] = "SAMEORIGIN"
    else:
        response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    response.headers.setdefault(
        "Permissions-Policy",
        "camera=(), microphone=(), geolocation=(), payment=()",
    )
    # CSP: admin 不需要严格 (富文本/iframe 预览), 但禁止外部脚本注入
    frame_ancestors = "frame-ancestors 'self'; " if is_preview_html else "frame-ancestors 'none'; "
    response.headers.setdefault(
        "Content-Security-Policy",
        "default-src 'self'; "
        "img-src 'self' data: https: blob:; "
        "media-src 'self' data: blob:; "
        "script-src 'self' 'unsafe-inline' 'unsafe-eval'; "  # Vite dev + 富文本需要 unsafe-eval
        "style-src 'self' 'unsafe-inline'; "
        "font-src 'self' data:; "
        "connect-src 'self' ws: wss: https:; "  # SSE 流 + WS 热更
        f"{frame_ancestors}"
        "base-uri 'self';",
    )
    # HSTS 仅 prod (dev 用 http)
    if settings.ENV == "prod":
        response.headers.setdefault(
            "Strict-Transport-Security",
            "max-age=63072000; includeSubDomains",
        )
    return response


# ====== 路由 ======
app.include_router(api_router, prefix=settings.API_V1_PREFIX)


# ====== 根路由 ======
@app.get("/")
async def root():
    return {
        "name": settings.PROJECT_NAME,
        "version": settings.VERSION,
        "env": settings.ENV,
        "docs": "/docs" if settings.DEBUG else "disabled",
    }


@app.get("/healthz")
async def healthz():
    """健康检查"""
    db_ok = True
    try:
        async with engine.begin() as conn:
            await conn.execute(text("SELECT 1"))
    except Exception:
        db_ok = False

    return {
        "status": "ok" if db_ok else "degraded",
        "db": db_ok,
        "version": settings.VERSION,
    }
