# AI-CMS Frontend (Admin)

React 18 + Vite + TypeScript + Tailwind + shadcn-style components

## 开发

```bash
# 装依赖 (推荐 pnpm)
pnpm install

# 启动 dev server
pnpm dev
# → http://localhost:5173

# 类型检查
pnpm typecheck

# 构建
pnpm build
```

## 环境变量

`.env` (复制 `.env.example`):

```
VITE_API_BASE=http://localhost:8000/api/v1
```

## 目录

```
frontend/
├── src/
│   ├── api/            # axios + 接口封装
│   ├── components/
│   │   ├── ui/         # 基础 UI (Button/Input/Card/Label)
│   │   ├── layout/     # AppLayout
│   │   └── ProtectedRoute.tsx
│   ├── lib/            # utils
│   ├── pages/          # 页面
│   ├── stores/         # Zustand
│   ├── App.tsx
│   ├── main.tsx
│   └── index.css
├── public/
├── package.json
└── Dockerfile.dev
```

## 状态

- ✅ 登录/注册
- ✅ 鉴权守卫
- ✅ 后台布局
- ✅ 仪表盘 (含后端连通性检测)
- ⏳ 多站点/内容/主题/AI 模块 (P1-P3)
