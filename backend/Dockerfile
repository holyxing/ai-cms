# AI-CMS Backend Dockerfile
# 使用 DaoCloud 镜像源（docker.io 网络不可达时回退到该地址）
FROM docker.m.daocloud.io/library/python:3.11-slim

# 设置环境
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    UV_LINK_MODE=copy

# 换用清华 TUNA 镜像源 (deb.debian.org 公网不稳)
RUN sed -i 's|deb.debian.org|mirrors.tuna.tsinghua.edu.cn|g; s|security.debian.org|mirrors.tuna.tsinghua.edu.cn|g' /etc/apt/sources.list.d/*.sources 2>/dev/null; \
    sed -i 's|deb.debian.org|mirrors.tuna.tsinghua.edu.cn|g; s|security.debian.org|mirrors.tuna.tsinghua.edu.cn|g' /etc/apt/sources.list 2>/dev/null; \
    cat /etc/apt/sources.list 2>/dev/null | head -3; \
    cat /etc/apt/sources.list.d/*.sources 2>/dev/null | head -5

# 安装系统依赖
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    curl \
    git \
    ca-certificates \
    gnupg \
    && rm -rf /var/lib/apt/lists/*

# 安装 Node.js 25.8.1 (P2 SSG 构建需要, D1 决策)
# 用 NodeSource 官方源 (apt-key 已废, 用 signed-by)
RUN curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key -o /tmp/nodesource.gpg \
    && gpg --dearmor < /tmp/nodesource.gpg > /usr/share/keyrings/nodesource.gpg \
    && echo "deb [signed-by=/usr/share/keyrings/nodesource.gpg] https://deb.nodesource.com/node_25.x nodistro main" > /etc/apt/sources.list.d/nodesource.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends --fix-missing nodejs \
    && rm -rf /var/lib/apt/lists/* /tmp/nodesource.gpg \
    && node -v && npm -v

# 安装 uv
RUN pip install uv

# 设置工作目录
WORKDIR /app

# 先复制依赖文件,利用 docker 缓存
COPY pyproject.toml ./
COPY README.md ./

# 用 uv 安装依赖（包含开发依赖,容器内方便调试）
RUN uv pip install --system --no-cache \
    -e . \
    "pytest>=8.3.0" \
    "pytest-asyncio>=0.24.0" \
    "ruff>=0.7.0" \
    "ipython>=8.29.0"

# 复制源码
COPY . .

# 创建非 root 用户
RUN useradd -m -u 1000 appuser && chown -R appuser:appuser /app \
    && mkdir -p /var/www/sites /tmp/astro_build \
    && chown -R appuser:appuser /var/www /tmp/astro_build
USER appuser

# 暴露端口
EXPOSE 8000

# 默认命令（docker-compose 中会覆盖）
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
