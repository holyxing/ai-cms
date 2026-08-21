---
title: "AI-CMS HY_ 模板标签使用指南"
author: "AI-CMS"
date: "2026-08-17"
lang: zh-CN
---

# AI-CMS · HY_ 模板标签使用指南

> **版本** v1.1 · **逐条手册（每个标签详解）** → [`HY_标签逐条使用手册.pdf`](./HY_标签逐条使用手册.pdf) / [Markdown](./HY_标签逐条使用手册.md)

---

## 1. 快速入门

在 layout HTML 里写 `<HY_XXX />`，发布时由渲染引擎替换成真实数据。

```html
<h1><HY_SITE_NAME /></h1>
<p><HY_CAT_DESCRIPTION /></p>
```

**三条铁律：**

1. 业务属性一律 `_` 前缀：`_limit`、`_match`、`_include`
2. 容器必须闭合：`<HY_CONTENTS>...</HY_CONTENTS>`
3. 详情页用 `HY_CONTENT_*`，列表循环内用 `HY_ITEM_*`

---

## 2. 标签分类速查

| 类别 | 代表标签 | 何时可用 |
|------|----------|----------|
| 站点 | `HY_SITE_NAME` `HY_SITE_LOGO` `HY_SITE_ICP` | 任意页 |
| 页面 SEO | `HY_PAGE_TITLE` `HY_PAGE_DESC` `HY_PAGE_URL` | site layout `<head>` |
| 栏目 | `HY_CAT_NAME` `HY_CAT_URL` `HY_CAT_COVER` | 栏目页 / 详情页 |
| 内容详情 | `HY_CONTENT_TITLE` `HY_CONTENT_BODY` | 仅详情页 |
| 列表循环 | `HY_CONTENTS` + `HY_ITEM_*` | 栏目页 / 首页 |
| 分页 | `HY_CONTENTS_PAGINATION`（别名 `HY_PAGINATION`） | 列表下方 |
| 相关文章 | `HY_RELATED_LIST` | 详情页侧栏 / 文末 |
| 资源 | `HY_SITE_CSS` `HY_SITE_JS` `HY_ASSET_URL` | site layout |
| 媒体库 | `HY_MEDIA _id="uuid"` | 任意页 |
| 首页块 | `HY_SITE_HERO` `HY_SITE_STATS` `HY_HOME_FEATURED` | 首页 |
| 控制流 | `HY_IF` `HY_TEMPLATE` `HY_INCLUDE` | 任意页 |

---

## 3. 使用用例

### 用例 A · 站点公共头尾（site scope）

**场景**：所有页面共享 header/footer、CSS/JS、SEO meta。

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <HY_SITE_CSS />
  <meta charset="UTF-8">
  <title><HY_PAGE_TITLE /> · <HY_SITE_NAME /></title>
  <meta name="description" content="<HY_PAGE_DESC />">
  <link rel="canonical" href="<HY_PAGE_URL />">
</head>
<body>
  <header>
    <a href="/"><HY_SITE_NAME /></a>
    <nav>
      <a href="/" class="nav-link<HY_MENU_ACTIVE _match="/" />">首页</a>
      <a href="/news/" class="nav-link<HY_MENU_ACTIVE _match="/news/" />">新闻</a>
    </nav>
  </header>
  <main>__LAYOUT_CONTENT__</main>
  <footer>
    <p><HY_SITE_COPYRIGHT /> · <HY_SITE_ICP /></p>
  </footer>
  <HY_SITE_JS />
</body>
</html>
```

---

### 用例 B · 首页（home scope）

**场景**：Hero + 数据指标 + 最新新闻列表。

```html
<section class="hero"><HY_SITE_HERO /></section>
<section class="stats"><HY_SITE_STATS /></section>

<section class="latest">
  <h2>最新动态</h2>
  <HY_CONTENTS _limit="6" _order="newest" _cat="news">
    <article class="news-row">
      <h3><a href="<HY_ITEM_URL />"><HY_ITEM_TITLE /></a></h3>
      <p><HY_ITEM_SUMMARY /></p>
      <time><HY_ITEM_DATE /></time>
    </article>
  </HY_CONTENTS>
</section>

<!-- 或一行精选 grid -->
<section><HY_HOME_FEATURED _limit="6" /></section>

<section class="cta"><HY_SITE_CTA /></section>
```

---

### 用例 C · 栏目列表页（category scope）

**场景**：新闻列表 + 空状态 + 分页。

```html
<header>
  <h1><HY_CAT_NAME /></h1>
  <p><HY_CAT_DESCRIPTION /></p>
</header>

<div class="list">
  <HY_CONTENTS _limit="12" _order="newest">
    <article class="card">
      <HY_IF _condition="content.has_cover">
        <a href="<HY_ITEM_URL />"><img src="<HY_ITEM_COVER />" alt="<HY_ITEM_TITLE />" /></a>
      </HY_IF>
      <h3><a href="<HY_ITEM_URL />"><HY_ITEM_TITLE /></a></h3>
      <p><HY_ITEM_SUMMARY /></p>
      <span><HY_ITEM_DATE /></span>
    </article>
  </HY_CONTENTS>
</div>

<HY_CONTENTS_EMPTY>
  <p class="empty">该栏目暂无内容</p>
</HY_CONTENTS_EMPTY>

<HY_CONTENTS_PAGINATION _show_numbers="true" />
<p>共 <HY_CONTENTS_COUNT /> 篇</p>
```

**分页说明**：每页默认 20 条；第 2 页静态路径为 `{栏目slug}/page-2.html`。

---

### 用例 D · 文章详情页（content scope）

**场景**：标题、正文、上下篇、相关推荐。

```html
<article>
  <header>
    <h1><HY_CONTENT_TITLE /></h1>
    <div class="meta">
      <time><HY_CONTENT_DATE_SHORT /></time>
      <span> · <HY_CONTENT_AUTHOR /></span>
      <a href="<HY_CONTENT_CAT_URL />"> · <HY_CONTENT_CAT_NAME /></a>
    </div>
  </header>
  <div class="body"><HY_CONTENT_BODY /></div>
  <nav class="prev-next">
    <a href="<HY_CONTENT_PREV_URL />">← 上一篇</a>
    <a href="<HY_CONTENT_NEXT_URL />">下一篇 →</a>
  </nav>
</article>

<aside>
  <h3>相关阅读</h3>
  <HY_RELATED_LIST _limit="5" />
</aside>
```

---

### 用例 E · 引用站点资源与媒体

**站点资源**（admin → 站点资源）：

```html
<HY_SITE_CSS _include="style-merged.css,news-list.css" />
<HY_SITE_JS _include="app.js" />
<link rel="icon" href="<HY_ASSET_URL _name="favicon.ico" />">
```

**媒体库**（admin → 媒体库，复制 UUID）：

```html
<img src="<HY_MEDIA _id="550e8400-e29b-41d4-a716-446655440000" />"
     alt="配图说明" loading="lazy" />
```

---

### 用例 F · 子模板复用（partial）

**场景**：页头页脚多处复用。

```html
<!-- 主模板 -->
<HY_TEMPLATE code="header-v1" />
<main>...</main>
<HY_TEMPLATE code="footer-v1" />
```

或引入 partial 文件：

```html
<HY_INCLUDE _file="analytics.html" />
```

---

## 4. 容器与条件

### HY_CONTENTS 属性

| 属性 | 说明 | 示例 |
|------|------|------|
| `_limit` | 每页条数 | `_limit="12"` |
| `_order` | 排序 | `newest` / `oldest` / `hits` |
| `_cat` | 指定栏目 slug | `_cat="news"` |
| `_page` | 页码（通常自动） | `_page="2"` |

### HY_IF 条件

```html
<HY_IF _condition="content.has_cover">
  <img src="<HY_ITEM_COVER />" />
</HY_IF>

<HY_IF _condition="!content.has_cover">
  <div class="placeholder">无封面</div>
</HY_IF>
```

---

## 5. 常见错误

| 错误 | 正确做法 |
|------|----------|
| 详情页写 `<HY_ITEM_TITLE />` | 用 `<HY_CONTENT_TITLE />` |
| 列表外写 `<HY_ITEM_URL />` | 放在 `<HY_CONTENTS>` 内 |
| 属性写 `limit="10"` | 写 `_limit="10"` |
| 容器未闭合 | 必须 `</HY_CONTENTS>` |
| 分页标签名 `HY_PAGINATION` 无输出 | 需前面先有 `<HY_CONTENTS>` 循环 |

---

## 6. 本次补齐的重要标签（v1.1）

| 标签 | 说明 |
|------|------|
| `HY_CONTENTS_PAGINATION` | 分页 HTML（原先为空，已实现） |
| `HY_RELATED_LIST` | 同栏目相关文章列表 |
| `HY_MEDIA` | 媒体库图片 URL |
| `HY_HOME_FEATURED` | 首页精选内容 grid |
| `HY_ITEM_BODY` / `HY_ITEM_PUBLISH_DATE` | 详情页便捷别名 |
| `HY_PAGINATION` / `HY_HOME_HERO` / `HY_NAV` / `HY_FOOTER` | 兼容旧模板别名 |

---

## 7. 编辑与校验

1. 后台 → **模板** → 选择 layout → 编辑 HTML
2. 输入 `HY_` 触发自动补全
3. 底栏实时校验：未知标签 / 容器未闭合会标红
4. 保存后 **发布站点**，检查静态产物是否还有残留 `<HY_`

---

## 附录 · 标签完整清单（自闭合）

**全局**：`HY_NOW` `HY_BUILD_ID` `HY_THEME_VERSION` `HY_BASE_URL`

**站点**：`HY_SITE_NAME` `HY_SITE_SLOGAN` `HY_SITE_DESCRIPTION` `HY_SITE_KEYWORDS` `HY_SITE_LOGO` `HY_SITE_FAVICON` `HY_SITE_URL` `HY_SITE_ICP` `HY_SITE_COPYRIGHT`

**页面**：`HY_PAGE_TITLE` `HY_PAGE_URL` `HY_PAGE_DESC` `HY_PAGE_KEYWORDS`

**栏目**：`HY_CAT_ID` `HY_CAT_NAME` `HY_CAT_SLUG` `HY_CAT_DESCRIPTION` `HY_CAT_COVER` `HY_CAT_URL` `HY_CAT_PARENT_NAME` `HY_CAT_META`

**详情**：`HY_CONTENT_TITLE` `HY_CONTENT_BODY` `HY_CONTENT_URL` `HY_CONTENT_SUBTITLE` `HY_CONTENT_CAT_NAME` `HY_CONTENT_CAT_URL` `HY_CONTENT_DATE` `HY_CONTENT_DATE_SHORT` `HY_CONTENT_AUTHOR` `HY_CONTENT_PREV_URL` `HY_CONTENT_NEXT_URL` `HY_RELATED_LIST`

**列表项**：`HY_ITEM_ID` `HY_ITEM_TITLE` `HY_ITEM_URL` `HY_ITEM_SUMMARY` `HY_ITEM_COVER` `HY_ITEM_DATE` `HY_ITEM_AUTHOR` `HY_ITEM_TAGS` …

**容器**：`HY_CONTENTS` `HY_CATS` `HY_IF` `HY_INCLUDE` `HY_TEMPLATE` `HY_CONTENTS_EMPTY`

---

*AI-CMS · 白底科技蓝 · 模板只描述结构，样式由你的 HTML/CSS 决定。*
