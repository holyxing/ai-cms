# 02 - API 规范

> FastAPI 后端接口设计约定

---

## 1. 设计原则

- **RESTful** 为主，特殊场景用 RPC 风格（AI 流的 SSE）
- **JWT** 认证，access + refresh 双 token
- **多租户** 通过 `X-Site-Id` 头传递（除站点本身接口外）
- **统一响应格式**
- **OpenAPI** 自动生成，前端用 `openapi-typescript` 生成类型
- **分页** 用 `page` + `page_size`（不用 offset/limit，更友好）

---

## 2. 统一响应格式

```json
// 成功
{ "code": 0, "data": { ... }, "message": "ok" }

// 失败
{ "code": 40001, "data": null, "message": "标题不能为空", "errors": [...] }

// 分页
{ "code": 0, "data": { "items": [...], "total": 123, "page": 1, "page_size": 20 } }
```

**错误码**：
- `400xx` 业务校验
- `401xx` 认证
- `403xx` 权限
- `404xx` 资源
- `500xx` 内部

---

## 3. 路由前缀

```
/api/v1/auth
/api/v1/sites
/api/v1/sites/{site_id}/contents
/api/v1/sites/{site_id}/taxonomies
/api/v1/sites/{site_id}/themes
/api/v1/sites/{site_id}/menus
/api/v1/sites/{site_id}/media
/api/v1/sites/{site_id}/ai
/api/v1/sites/{site_id}/publish
/api/v1/users
/api/v1/ai-providers
/api/v1/admin
```

---

## 4. 核心接口清单

### 4.1 认证

```
POST   /api/v1/auth/login         # 邮箱+密码
POST   /api/v1/auth/refresh       # 刷新 token
POST   /api/v1/auth/logout
GET    /api/v1/auth/me
```

### 4.2 站点

```
GET    /api/v1/sites                 # 我能访问的站点列表
POST   /api/v1/sites                 # 新建（超管）
GET    /api/v1/sites/{id}
PATCH  /api/v1/sites/{id}
DELETE /api/v1/sites/{id}
GET    /api/v1/sites/{id}/members
POST   /api/v1/sites/{id}/members
PATCH  /api/v1/sites/{id}/members/{user_id}
DELETE /api/v1/sites/{id}/members/{user_id}
```

### 4.3 内容

```
GET    /api/v1/sites/{site_id}/contents
       # query: type, status, taxonomy_id, search, page, page_size
POST   /api/v1/sites/{site_id}/contents
GET    /api/v1/sites/{site_id}/contents/{id}
PATCH  /api/v1/sites/{site_id}/contents/{id}
DELETE /api/v1/sites/{site_id}/contents/{id}
POST   /api/v1/sites/{site_id}/contents/{id}/publish
POST   /api/v1/sites/{site_id}/contents/{id}/unpublish
GET    /api/v1/sites/{site_id}/contents/{id}/revisions
POST   /api/v1/sites/{site_id}/contents/{id}/revisions/{ver}/restore
```

### 4.4 栏目

```
GET    /api/v1/sites/{site_id}/taxonomies?type=category
POST   /api/v1/sites/{site_id}/taxonomies
GET    /api/v1/sites/{site_id}/taxonomies/{id}
PATCH  /api/v1/sites/{site_id}/taxonomies/{id}
DELETE /api/v1/sites/{site_id}/taxonomies/{id}
POST   /api/v1/sites/{site_id}/taxonomies/reorder   # 拖拽排序
```

### 4.5 主题

```
GET    /api/v1/sites/{site_id}/themes                # 主题库列表
GET    /api/v1/sites/{site_id}/themes/current        # 当前主题（含 tokens）
PUT    /api/v1/sites/{site_id}/themes/current        # 更新 tokens
POST   /api/v1/sites/{site_id}/themes/current/apply  # 应用主题库某个主题
POST   /api/v1/sites/{site_id}/themes/current/ai-suggest  # AI 调样式
GET    /api/v1/sites/{site_id}/themes/current/history  # 历史版本（回滚）
```

### 4.6 媒体

```
POST   /api/v1/sites/{site_id}/media/upload          # 单/多文件
GET    /api/v1/sites/{site_id}/media                 # 列表（搜索/分页/类型筛选）
PATCH  /api/v1/sites/{site_id}/media/{id}            # 改 alt/filename
DELETE /api/v1/sites/{site_id}/media/{id}
```

### 4.7 AI

```
POST   /api/v1/sites/{site_id}/ai/chat               # 通用对话（SSE 流）
POST   /api/v1/sites/{site_id}/ai/tasks              # 创建 AI 任务
GET    /api/v1/sites/{site_id}/ai/tasks/{id}         # 查询状态
POST   /api/v1/sites/{site_id}/ai/tasks/{id}/apply   # 采纳 AI 建议
POST   /api/v1/sites/{site_id}/ai/tasks/{id}/reject  # 拒绝
GET    /api/v1/sites/{site_id}/ai/suggestions        # 待采纳列表
```

**AI 任务类型**：
- `write_article`：写文章
- `rewrite`：改写（语气/长度）
- `translate`：翻译
- `continue`：续写
- `summarize`：摘要
- `seo_audit`：SEO 审计
- `accessibility_audit`：可访问性审计
- `design_suggest`：样式建议
- `categorize`：自动分类
- `generate_alt`：图片 alt 文本

### 4.8 发布

```
POST   /api/v1/sites/{site_id}/publish               # 触发发布
GET    /api/v1/sites/{site_id}/publish/jobs          # 任务列表
GET    /api/v1/sites/{site_id}/publish/jobs/{id}     # 单任务详情
GET    /api/v1/sites/{site_id}/publish/history        # 历史产物
POST   /api/v1/sites/{site_id}/publish/history/{id}/rollback  # 回滚
```

### 4.9 用户 / 全局

```
GET    /api/v1/users                                 # 用户列表
POST   /api/v1/users
PATCH  /api/v1/users/{id}
DELETE /api/v1/users/{id}
GET    /api/v1/users/me
GET    /api/v1/ai-providers                          # AI 服务商配置
POST   /api/v1/ai-providers
PATCH  /api/v1/ai-providers/{id}
DELETE /api/v1/ai-providers/{id}
POST   /api/v1/ai-providers/{id}/test                # 测试连通
```

---

## 5. AI 流式接口设计（SSE）

```
POST /api/v1/sites/{site_id}/ai/chat
Content-Type: application/json
Authorization: Bearer ...

{
  "task": "write_article",
  "input": {
    "topic": "AI 在内容管理中的应用",
    "tone": "professional",
    "length": "medium",
    "audience": "中小企业主"
  },
  "context": {
    "site_id": "...",
    "current_content_id": "..."   # 可选,基于现有内容改
  },
  "stream": true
}

→ 200 OK
Content-Type: text/event-stream

event: message
data: {"delta": "AI 在", "done": false}

event: message
data: {"delta": "当今企业", "done": false}

...

event: done
data: {"final": "...完整 Tiptap JSON...", "usage": {"in": 234, "out": 1234}}
```

前端用 `EventSource` 或 `fetch + ReadableStream` 接收。

---

## 6. RBAC 权限矩阵

| 操作 | 超管 | 站点管理员 | 编辑 | 作者 |
|---|:-:|:-:|:-:|:-:|
| 管平台用户 | ✅ | ❌ | ❌ | ❌ |
| 配 AI provider | ✅ | ❌ | ❌ | ❌ |
| 新建站点 | ✅ | ❌ | ❌ | ❌ |
| 管站点成员 | ✅ | ✅ | ❌ | ❌ |
| 改站点设置 | ✅ | ✅ | ❌ | ❌ |
| 改主题 | ✅ | ✅ | ✅ | ❌ |
| 管栏目 | ✅ | ✅ | ✅ | ❌ |
| 写文章 | ✅ | ✅ | ✅ | ✅ |
| 审/发文章 | ✅ | ✅ | ✅ | ❌ |
| 看文章 | ✅ | ✅ | ✅ | ✅（仅自己） |
| 管媒体 | ✅ | ✅ | ✅ | ✅（仅自己） |
| 触发发布 | ✅ | ✅ | ✅ | ❌ |
| 看审计日志 | ✅ | ✅ | ❌ | ❌ |

---

## 7. 鉴权实现

- **登录** → 返回 `access_token` (15min) + `refresh_token` (7d)
- **access 过期** → 用 refresh 换新 access（静默）
- **refresh 过期** → 重新登录
- **权限** → FastAPI Depends 注入 `current_user` 和 `site_member_with_role`
- **审计** → 中间件 + 装饰器记录

---

## 8. OpenAPI → 前端类型

```bash
# 后端起服务后
npx openapi-typescript http://localhost:8000/openapi.json -o src/api/schema.ts
```

前端直接 `import type { paths } from '@/api/schema'`，自动有类型。

---

## 9. 版本与兼容

- URL 带 `/v1/`，未来 `/v2/`
- 字段**只加不删**（要删就标 deprecated）
- breaking change 走新版本
