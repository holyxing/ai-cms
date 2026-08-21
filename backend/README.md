# AI-CMS Backend

FastAPI + AI Agents + Multi-site CMS

## 开发

```bash
# 安装 uv
curl -LsSf https://astral.sh/uv/install.sh | sh

# 安装依赖
uv sync

# 启动开发服务器
uv run uvicorn app.main:app --reload --port 8000

# 数据库迁移
uv run alembic upgrade head

# 创建新迁移
uv run alembic revision --autogenerate -m "message"

# 测试
uv run pytest
```

## 目录

```
backend/
├── app/
│   ├── api/v1/        # 路由
│   ├── core/          # 配置/安全/依赖
│   ├── models/        # SQLAlchemy 模型
│   ├── schemas/       # Pydantic schemas
│   ├── services/      # 业务服务
│   ├── agents/        # AI 抽象 + 任务
│   ├── db/            # 数据库 + 迁移
│   ├── workers/       # Celery
│   └── main.py
├── tests/
├── scripts/
├── pyproject.toml
└── Dockerfile
```
