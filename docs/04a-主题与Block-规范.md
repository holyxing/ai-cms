# 04 - 主题与 Block 规范

> Block JSON 格式 + 主题 token 格式 + 渲染契约

---

## 1. 整体关系

```
Site
  ├── current_theme (设计 tokens)
  │     ├── color, typography, spacing, radius, shadow, breakpoint
  │     └── components (按钮/卡片/区块的默认变体)
  │
  └── contents (内容)
        └── blocks (Tiptap JSON)
              └── 每个 block 引用 token（用语义化类名，如 text-primary）
```

**关键设计**：
- **Block 只引用 token，不写死颜色/字号** → 换主题 = 改 token，所有 block 自动换肤
- **Token 是 token，组件是组件** → AI 改 token 不动组件结构

---

## 2. Block JSON Schema（Tiptap 风格）

### 2.1 顶层结构

```json
{
  "type": "doc",
  "content": [
    // blocks
  ]
}
```

### 2.2 内置 Block 类型（MVP）

| Type | 用途 | 数据示例 |
|---|---|---|
| `heading` | 标题 | `{ "type": "heading", "attrs": { "level": 2 }, "content": [...] }` |
| `paragraph` | 段落 | `{ "type": "paragraph", "content": [...] }` |
| `text` | 文本（含 mark） | `{ "type": "text", "text": "你好", "marks": [{ "type": "bold" }] }` |
| `bulletList` / `orderedList` | 列表 | |
| `blockquote` | 引用 | |
| `codeBlock` | 代码块 | `{ "type": "codeBlock", "attrs": { "language": "python" } }` |
| `image` | 图片 | `{ "type": "image", "attrs": { "media_id": "...", "alt": "..." } }` |
| `divider` | 分隔线 | `{ "type": "divider" }` |
| `callout` | 高亮块 | `{ "type": "callout", "attrs": { "variant": "info" }, "content": [...] }` |
| `quote` | 卡片引用 | |
| `embed` | 嵌入（视频/音频） | `{ "type": "embed", "attrs": { "url": "...", "provider": "youtube" } }` |
| `button` | 按钮 | `{ "type": "button", "attrs": { "text": "...", "url": "...", "variant": "primary" } }` |
| `card` | 卡片 | `{ "type": "card", "attrs": { "title": "...", "image": "...", "url": "..." } }` |
| `accordion` | 折叠 | |
| `tabs` | 标签页 | |
| `columns` | 多列布局 | `{ "type": "columns", "attrs": { "count": 2 }, "content": [...] }` |

### 2.3 Mark（行内格式）

```json
{ "type": "bold" }
{ "type": "italic" }
{ "type": "underline" }
{ "type": "strike" }
{ "type": "code" }
{ "type": "link", "attrs": { "href": "...", "target": "_blank" } }
{ "type": "highlight", "attrs": { "color": "yellow" } }  // 自定义
{ "type": "textColor", "attrs": { "color": "primary" } } // 引用 token
```

**重要约定**：
- `textColor` / `highlight` 的 color 字段**只接受 token 名**（如 `"primary"`、`"danger"`），不接 hex
- 不写死的 hex，避免换主题失效

### 2.4 示例

```json
{
  "type": "doc",
  "content": [
    {
      "type": "heading",
      "attrs": { "level": 1 },
      "content": [{ "type": "text", "text": "AI 时代的内容管理" }]
    },
    {
      "type": "paragraph",
      "content": [
        { "type": "text", "text": "在 " },
        { "type": "text", "text": "2026 年", "marks": [{ "type": "bold" }] },
        { "type": "text", "text": "，AI 已经深度参与内容生产。" }
      ]
    },
    {
      "type": "callout",
      "attrs": { "variant": "info" },
      "content": [{
        "type": "paragraph",
        "content": [{ "type": "text", "text": "本文将介绍三大变革..." }]
      }]
    },
    {
      "type": "image",
      "attrs": {
        "media_id": "uuid-xxx",
        "alt": "AI 内容管理流程图",
        "caption": "图 1：流程示意"
      }
    },
    {
      "type": "codeBlock",
      "attrs": { "language": "python" },
      "content": [{ "type": "text", "text": "print('hello')" }]
    }
  ]
}
```

---

## 3. 主题 Token Schema

### 3.1 完整 token JSON

```json
{
  "version": 1,
  "color": {
    "primary": "#3b82f6",
    "primary_hover": "#2563eb",
    "primary_foreground": "#ffffff",
    "secondary": "#8b5cf6",
    "accent": "#06b6d4",
    "background": "#ffffff",
    "surface": "#f9fafb",
    "surface_elevated": "#ffffff",
    "text": "#111827",
    "text_muted": "#6b7280",
    "text_inverse": "#ffffff",
    "border": "#e5e7eb",
    "border_strong": "#d1d5db",
    "success": "#10b981",
    "warning": "#f59e0b",
    "danger": "#ef4444",
    "info": "#3b82f6"
  },
  "typography": {
    "fontFamily": {
      "sans": "Inter, \"PingFang SC\", \"Microsoft YaHei\", sans-serif",
      "serif": "Georgia, \"Source Han Serif SC\", serif",
      "mono": "JetBrains Mono, Consolas, monospace"
    },
    "fontSize": {
      "xs": "0.75rem",
      "sm": "0.875rem",
      "base": "1rem",
      "lg": "1.125rem",
      "xl": "1.25rem",
      "2xl": "1.5rem",
      "3xl": "1.875rem",
      "4xl": "2.25rem",
      "5xl": "3rem"
    },
    "fontWeight": {
      "normal": 400,
      "medium": 500,
      "semibold": 600,
      "bold": 700
    },
    "lineHeight": {
      "tight": 1.25,
      "normal": 1.5,
      "relaxed": 1.75
    }
  },
  "spacing": {
    "xs": "0.25rem",
    "sm": "0.5rem",
    "md": "1rem",
    "lg": "1.5rem",
    "xl": "2rem",
    "2xl": "3rem",
    "3xl": "4rem"
  },
  "radius": {
    "none": "0",
    "sm": "0.25rem",
    "md": "0.5rem",
    "lg": "0.75rem",
    "xl": "1rem",
    "full": "9999px"
  },
  "shadow": {
    "none": "none",
    "sm": "0 1px 2px 0 rgba(0,0,0,0.05)",
    "md": "0 4px 6px -1px rgba(0,0,0,0.1)",
    "lg": "0 10px 15px -3px rgba(0,0,0,0.1)",
    "xl": "0 20px 25px -5px rgba(0,0,0,0.1)"
  },
  "breakpoint": {
    "sm": "640px",
    "md": "768px",
    "lg": "1024px",
    "xl": "1280px",
    "2xl": "1536px"
  }
}
```

### 3.2 组件默认变体

```json
{
  "components": {
    "button": {
      "primary":   { "bg": "color.primary", "color": "color.primary_foreground", "radius": "radius.md", "padding": "spacing.sm spacing.lg" },
      "secondary": { "bg": "color.surface",  "color": "color.text",                "radius": "radius.md", "padding": "spacing.sm spacing.lg", "border": "1px solid color.border" },
      "ghost":     { "bg": "transparent",     "color": "color.text",                "padding": "spacing.sm spacing.md" }
    },
    "card": {
      "default": { "bg": "color.surface_elevated", "padding": "spacing.lg", "radius": "radius.lg", "shadow": "shadow.sm" }
    }
  }
}
```

---

## 4. 渲染契约

### 4.1 Block 渲染器

`ssg/sites/_template/src/components/blocks/` 下每个 block 类型一个 .astro 文件：

```astro
---
// Callout.astro
const { variant = 'info', content } = Astro.props;
const variantClass = `callout-${variant}`;
---
<div class:list={['callout', variantClass]}>
  <slot />
</div>

<style>
  .callout { padding: var(--spacing-md); border-radius: var(--radius-md); border-left: 4px solid; }
  .callout-info { background: var(--color-info-bg, #dbeafe); border-color: var(--color-info, #3b82f6); }
  .callout-warning { background: #fef3c7; border-color: var(--color-warning, #f59e0b); }
  .callout-success { background: #d1fae5; border-color: var(--color-success, #10b981); }
  .callout-danger  { background: #fee2e2; border-color: var(--color-danger, #ef4444); }
</style>
```

### 4.2 Tokens → CSS 变量

构建时把当前主题的 tokens 展开成 CSS 变量：

```ts
// ssg/sites/_template/src/lib/theme.ts
export function tokensToCss(tokens: ThemeTokens): string {
  const lines: string[] = [':root {'];
  for (const [group, kv] of Object.entries(tokens)) {
    if (typeof kv === 'object' && kv !== null) {
      for (const [k, v] of Object.entries(kv)) {
        const key = `--${group}-${k.replace(/_/g, '-')}`;
        lines.push(`  ${key}: ${v};`);
      }
    }
  }
  lines.push('}');
  return lines.join('\n');
}
```

生成：
```css
:root {
  --color-primary: #3b82f6;
  --color-primary-hover: #2563eb;
  --typography-font-size-base: 1rem;
  --spacing-md: 1rem;
  ...
}
```

### 4.3 Block 渲染分发器（Astro 原生）

> **修订（2026-06-05）**：原 4.3 用 .tsx/JSX 写法，与 Astro 模板（.astro）冲突。Astro 用 .astro 组件 + 原生 HTML 拼接，不引入 React/JSX 运行时。

```astro
---
// ssg/_template/src/lib/Block.astro  (通用 block 渲染器)
import Callout from '@/components/blocks/Callout.astro';
import Image from '@/components/blocks/Image.astro';
import Heading from '@/components/blocks/Heading.astro';
import Paragraph from '@/components/blocks/Paragraph.astro';
import Quote from '@/components/blocks/Quote.astro';
import List from '@/components/blocks/List.astro';
import CodeBlock from '@/components/blocks/CodeBlock.astro';

const { block } = Astro.props;

const map = {
  callout: Callout,
  image: Image,
  heading: Heading,
  paragraph: Paragraph,
  quote: Quote,
  list: List,
  codeBlock: CodeBlock,
};

const Comp = map[block.type];
---
{Comp && <Comp block={block}><slot /></Comp>}
```

```ts
// ssg/_template/src/lib/blocks.ts  (递归渲染助手)
import { tiptapToHtml } from '@/lib/tiptap-to-html';

export function renderBlocks(blocks: TiptapNode[] = []): string {
  return blocks.map(b => tiptapToHtml(b)).join('\n');
}
```

**关键决策**：
- 渲染 = **构建时** (Astro SSG)，不是客户端 React
- Tiptap JSON -> HTML 走 `unified/remark/rehype` 管线（不引入额外 runtime）
- 主题 tokens 在构建时编译为 CSS 变量注入 `:root`（见 4.2）

### 4.4 预览 = 静态产物（关键）

**Admin 编辑器的预览 iframe** 加载的不是 mock，而是**真实 SSG 产物的预览构建**：

```
预览流程：
1. 用户编辑 → blocks 变 → debounce 500ms
2. 调 API: PUT /contents/{id} (status=draft)
3. 前端把 blocks 提交到预览端点: POST /preview/render
   → 后端在内存里渲染（不写文件）
   → 返回 HTML
4. iframe 内显示

→ 这样预览 = 生产，零差异
```

**V2 优化**：用 WebSocket 流式推 blocks 增量。

---

## 5. 主题库（MVP 5 个）

存 `ssg/themes/<code>/theme.json`，每个主题一份：

| 主题 | 主色 | 风格 |
|---|---|---|
| `default` | 蓝 #3b82f6 | 通用博客 |
| `business` | 深蓝 #1e40af | 企业官网 |
| `tech` | 暗色 #0ea5e9 | 极客/技术博客（支持暗色模式） |
| `magazine` | 红 #dc2626 | 杂志型（大图卡） |
| `minimal` | 灰 #525252 | 极简风（类似 Notion） |

每个主题另存一张 `preview.png`（用于后台展示）。

---

## 6. AI 改样式的安全约束

**硬规则**（在 `design_suggest` 任务里 enforce）：

1. **路径白名单**：只能改 `color.*`、`typography.fontSize.*`、`typography.fontWeight.*`、`spacing.*`、`radius.*`、`shadow.*`
2. **不能删字段**
3. **不能新增字段**
4. **颜色对比度**：改完后台跑 WCAG 校验，不通过自动调
5. **每次改动 = 一个新版本**，保留历史，可回滚
6. **diff 预览**：先给用户看改了哪些 token，再确认应用

---

## 7. 主题与 Block 的版本控制

- `current_theme` 每次更新写入 `theme_history` 表（version 递增，存全量快照）
- `content_revisions` 每次发布/恢复写入（存全量 blocks）
- 后台支持"还原到该版本"按钮

---

## 8. 静态站点反向导入（V2，预留 schema）

用户上传 HTML+CSS+JS zip 或给 URL：

```
1. Playwright 抓 DOM
2. PostCSS 解析 CSS → 提取颜色/字体/间距/圆角
3. 启发式映射到 token path
4. 提取 block 结构（按 DOM 节点）
5. 映射到我们的 block schema
6. 套上主题 → 预览
7. 用户确认 → 存为新主题
```

**MVP 不做**，但**目录结构预留**（`agents/tasks/import_theme.py` 占位）。
