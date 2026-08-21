# AI-CMS

**AI 协作式多站点内容管理与静态发布平台（SSG）。**

在后台用 AI 辅助写作与 HTML/块编辑，统一管理多个站点，并发布为 Astro 静态站，便于 CDN 分发。

[English README](./README.md) · [贡献指南](./CONTRIBUTING.md) · [安全说明](./SECURITY.md) · [许可证](./LICENSE)

[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](./LICENSE)

---

## 为什么做 AI-CMS？

| 痛点 | AI-CMS |
| --- | --- |
| 传统 CMS 运维重 | Docker Compose + 静态产物，运维简单 |
| Headless 仍要前端团队 | 内置布局 + Astro 静态发布 |
| 写作 / SEO 慢 | 后台内置 AI 起稿、改写、润色 |
| 多品牌多套后台 | 一个后台管理多个站点 |

> 自托管开源：数据与 **API Key 留在你自己的环境**，不要提交到 Git。

---

## 功能概览

- 多站点：站点 / 栏目 / 文章 / 媒体 / 模板
- AI 助手：可插拔 Provider（OpenAI 兼容、Anthropic、MiniMax、Ollama…）
- 编辑器：HTML / 富文本 + AI 增强
- 静态发布：整站 / 栏目 / 文章粒度
- 消息中心：发布成功/失败、耗时秒数
- RBAC：角色、成员、回收站

---

## 快速开始

### 环境要求

- Docker 24+ / Compose v2+
- 建议 4GB+ 内存
- 端口：`80`、`18888`、`18889`、`5432`、`9000`（可在 env 中修改）

### 1. 克隆并配置

```bash
git clone https://github.com/holyxing/ai-cms.git
cd ai-cms
cp deploy/.env.example deploy/.env
```

**密钥：** 不需要在线大模型时，请保持 `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `MINIMAX_API_KEY` 为空。  
**严禁** 将 `deploy/.env`、真实 API Key、JWT、Fernet 密钥提交到仓库。详见 [SECURITY.md](./SECURITY.md)。

### 2. 启动

```bash
./scripts/start.sh
```

### 3. 数据库迁移（首次）

```bash
docker compose -f deploy/docker-compose.yml exec api alembic upgrade head
```

### 4. 可选：演示数据

```bash
docker compose -f deploy/docker-compose.yml exec api python3 scripts/seed_demo.py --reset
```

账号密码以脚本输出为准；共享环境请立即修改密码。

### 5. 访问

| 地址 | 说明 |
| --- | --- |
| http://localhost/admin | 管理后台 |
| http://localhost:18888/docs | OpenAPI |
| http://localhost:9001 | MinIO 控制台 |

停止：`./scripts/stop.sh`

---

## 技术栈

FastAPI · PostgreSQL · Redis · Celery · MinIO · React · Vite · Astro · Docker

---

## 文档

| 文档 | 内容 |
| --- | --- |
| [产品设计](./docs/00-产品设计.md) | 定位与架构 |
| [API 规范](./docs/02-API-规范.md) | REST 与鉴权 |
| [AI Agent](./docs/03-AI-Agent-设计.md) | AI 任务设计 |
| [设计系统](./docs/06-设计系统.md) | UI 规范（前端 PR 必读） |
| [部署运维](./docs/22-部署运维指南.md) | 生产部署 / HTTPS / 备份 |
| [用户手册](./docs/23-用户使用手册.md) | 创作者流程 |

编码助手说明：[AGENTS.md](./AGENTS.md)

---

## 截图

请将截图放到 `docs/images/`（勿包含生产数据），并在 README 中引用。

---

## 参与贡献

见 [CONTRIBUTING.md](./CONTRIBUTING.md) 与 [行为准则](./CODE_OF_CONDUCT.md)。  
安全漏洞请按 [SECURITY.md](./SECURITY.md) **私下报告**，Issue 中不要粘贴 API Key。

---

## 许可证

Copyright 2026 AI-CMS contributors.  
基于 [Apache License 2.0](./LICENSE) 开源。
