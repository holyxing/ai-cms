"""限流 (P4)

依据: docs/05-开发路线图.md P4 (限流)

策略:
- 认证端点 (login/refresh):  按 IP 限 10/min  (防暴力破解)
- AI 启动端点:             按 user 限 30/min  (保护 Celery 不被打爆)
- AI 流式端点:              按 user 限 60/min
- 普通读端点:                按 user 限 120/min
- 写端点:                  按 user 限 60/min

实现: slowapi (基于内存, 单机够用; 集群换 Redis)
"""
from fastapi import Request
from slowapi import Limiter
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded as _RateLimitExceeded
from fastapi.responses import JSONResponse

from app.core.responses import err


def _key_func(request: Request) -> str:
    """限流 key: 透用户 (如有) > IP.

    优先从 request.state 取 user_id (由 get_current_user 依赖设),
    未登录走 IP.
    """
    user_id = getattr(request.state, "user_id", None)
    if user_id:
        return f"user:{user_id}"
    return f"ip:{get_remote_address(request)}"


# 全局限流器
limiter = Limiter(
    key_func=_key_func,
    default_limits=["120/minute"],  # 兜底: 每个 key 一分钟 120 次
    headers_enabled=False,  # 关掉避免每个被装饰函数都加 response: Response 参数
)


# 全局异常处理: 限流超限返 429 而不是默认 500
async def rate_limit_exceeded_handler(request: Request, exc: _RateLimitExceeded):
    """限流超限: 返标准 429 响应"""
    return JSONResponse(
        status_code=429,
        content=err(
            code=42900,
            message=f"请求过于频繁, 请稍后再试 ({exc.detail})",
        ),
        headers={"Retry-After": str(exc.detail.split(" ")[0] if " " in str(exc.detail) else "60")},
    )
