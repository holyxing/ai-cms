# AGENTS.md · AI-CMS 项目

> **所有 agent 在这个项目里写代码前必读**。

## 🚨 必读文档（顺序）

1. **`docs/06-设计系统.md`** — **设计唯一标准，违反 = bug** ⭐
2. `docs/00-产品设计.md` — 产品定位
3. `docs/02-API-规范.md` — API 设计
4. `docs/05-开发路线图.md` — 当前 P 阶段

## 🛑 铁律（不可违反）

### 设计铁律
1. **白底科技蓝**。主色 `#2563eb`，浅色背景 `sky-50`/`blue-50`
2. **不用纯黑**。`#0f172a` 是最深
3. **不用渐变背景**（除主色按钮和 Login 主标题文字）
4. **不用大圆角**（>8px）。全局最大 8px
5. **不用大阴影**（>shadow-md）
6. **不用 emoji 当图标**。用 `lucide-react`
7. **不用 8px 网格之外的间距**
8. **不用自定义颜色**。必须用 token

### 工作铁律
1. **每一步谨慎**。改完验证再回报
2. **不删功能**。用户说留的必须留
3. **不换技术栈**。uv + Node 25.8.1 + JWT + Astro + Tiptap
4. **不写空文档**。具体内容
5. **不静默大改**。明确告知改了哪些文件

## 📁 项目结构

```
projects/ai-cms/
├── docs/                    # 设计文档（必读）
├── deploy/                  # docker-compose + nginx
├── backend/                 # FastAPI + uv
├── frontend/                # Vite + React + TS
│   └── src/
│       ├── components/
│       │   ├── ui/          # 设计系统组件（必遵循 06-设计系统）
│       │   └── layout/      # AppLayout
│       ├── pages/           # Login, Dashboard, etc.
│       ├── stores/          # zustand
│       └── api/             # axios 客户端
```

## 🎨 写新页面流程

1. 读 `docs/06-设计系统.md` 找对应组件
2. 复用 `components/ui/` 中已定义的组件
3. 遵循布局规范（数字行、卡片、表格）
4. 写完编译验证：`curl http://localhost/admin/src/pages/X.tsx` → 200
5. 报告用户

## 🔧 常用命令

```bash
cd /Users/mini_holy/.openclaw/workspace/projects/ai-cms/deploy
docker compose ps                 # 看所有容器
docker compose logs admin         # 前端日志
docker compose logs api           # 后端日志
docker compose restart admin      # 重启
```

## ⚠️ 已知坑

- Vite HMR 已被禁用（刷新生效）
- 端口：API 18888, Admin 18889, DB 5432, MinIO 9000, Nginx 80
- 默认账号：`admin@admin.com` / `admin123456`
- 迁移版本：`0001_initial`（仅 users 表）
