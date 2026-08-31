---
title: "AI-CMS HY_ 模板标签逐条使用手册"
author: "AI-CMS"
date: "2026-08-17"
lang: zh-CN
---

# HY_ 模板标签逐条使用手册

> 本文档对 **每一个** HY_ 标签给出：作用、适用页面、输出、属性、示例、注意事项。  
> 配套：`docs/19-标签使用手册.md`（系统设计）· 后台「模板」编辑器输入 `HY_` 可自动补全。

**通用约定**

- 写法：`<HY_XXX />` 或 `<HY_XXX></HY_XXX>`（推荐自闭合）
- 业务属性必须以 `_` 开头：`_limit`、`_match`、`_include`
- 标签名大写 + 下划线，不支持驼峰

**「示例」和「渲染后 HTML」怎么读**

- **示例** = 你写在模板里的源码（还带 HY_ 占位符）。
- **渲染后 HTML** = 静态发布完成后，访客拿到的真实 HTML（占位符已被替换）。下列对照一律使用同一套虚构数据：
  - 站点名「霍因科技」，根地址 `https://example.com`，资源前缀按页面深度可能是 `assets/` 或 `../assets/`
  - 栏目「产品中心」，slug `product`，列表 URL `product/index.html`
  - 文章「数据要素市场化实践」，slug `shuju`，详情 URL `product/shuju.html`
- 大部分标签**只替换成一段已转义的文本或 URL**，外层 `<h1>`、`<a>`、`<img>` 仍是你写的。
- 少数标签会**整段展开成系统拼好的 HTML**（不 escape）：`HY_CONTENT_BODY`、`HY_SITE_MENU`、`HY_BREADCRUMB`、`HY_ITEM_TAGS`、`HY_SITE_CSS/JS`、分页、相关阅读、首页块等。空数据时这些标签输出空字符串，连外壳都没有。

---

## 一、全局标签（4 个）

### HY_NOW

| 项 | 说明 |
|----|------|
| **作用** | 输出当前静态构建时间 |
| **适用** | 任意 scope |
| **输出** | ISO 8601，如 `2026-08-17T16:00:00+08:00` |
| **属性** | 无 |
| **示例** | `<footer>构建于 <HY_NOW /></footer>` |
| **注意** | 每次发布重新生成，非页面打开时的实时时间 |

**渲染后 HTML**（发布后，示例数据）

```html
<footer>构建于 2026-08-24T10:00:00+08:00</footer>
```

### HY_BUILD_ID

| 项 | 说明 |
|----|------|
| **作用** | 当前发布任务的 UUID，用于缓存破坏或排查 |
| **适用** | 任意 scope |
| **输出** | UUID 字符串 |
| **属性** | 无 |
| **示例** | `<link rel="stylesheet" href="assets/site.css?v=<HY_BUILD_ID />" />` |
| **注意** | 也可配合 `HY_THEME_VERSION` 做静态资源版本号 |

**渲染后 HTML**（发布后，示例数据）

```html
<link rel="stylesheet" href="assets/site.css?v=3fa85f64-5717-4562-b3fc-2c963f66afa6" />
```

### HY_THEME_VERSION

| 项 | 说明 |
|----|------|
| **作用** | 当前主题版本号（整数） |
| **适用** | 任意 scope |
| **输出** | 如 `2` |
| **属性** | 无 |
| **示例** | `<link href="assets/style.css?v=<HY_THEME_VERSION />" />` |

**渲染后 HTML**（发布后，示例数据）

```html
<link href="assets/style.css?v=2" />
```

### HY_BASE_URL

| 项 | 说明 |
|----|------|
| **作用** | 站点主域名 / 根 URL |
| **适用** | 任意 scope |
| **输出** | 如 `https://example.com` |
| **属性** | 无 |
| **示例** | `<a href="<HY_BASE_URL />/news/">新闻中心</a>` |
| **注意** | 与 `HY_SITE_URL` 通常相同；配合 `_filter="abs_url"` 转绝对路径 |

**渲染后 HTML**（发布后，示例数据）

```html
<a href="https://example.com/news/">新闻中心</a>
```

---

## 二、站点标签（11 个）

数据来源：后台「站点设置」。

### HY_SITE_NAME

| 项 | 说明 |
|----|------|
| **作用** | 站点名称 |
| **适用** | 任意 scope |
| **输出** | 纯文本，如 `霍因科技` |
| **示例** | `<h1><HY_SITE_NAME /></h1>` |
| **示例** | `<title><HY_PAGE_TITLE /> · <HY_SITE_NAME /></title>` |

**渲染后 HTML**（发布后，示例数据）

```html
<h1>霍因科技</h1>
<title>数据要素市场化实践 · 霍因科技</title>
```

### HY_SITE_SLOGAN

| 项 | 说明 |
|----|------|
| **作用** | 站点口号 / 副标题 |
| **适用** | 任意 scope |
| **输出** | 纯文本 |
| **示例** | `<p class="slogan"><HY_SITE_SLOGAN /></p>` |

**渲染后 HTML**（发布后，示例数据）

```html
<p class="slogan">让数据要素可信流通</p>
```

### HY_SITE_DESCRIPTION

| 项 | 说明 |
|----|------|
| **作用** | 站点描述（SEO 兑底） |
| **适用** | 任意 scope |
| **输出** | 纯文本 |
| **示例** | `<meta name="description" content="<HY_SITE_DESCRIPTION />" />` |

**渲染后 HTML**（发布后，示例数据）

```html
<meta name="description" content="霍因科技官方网站" />
```

### HY_SITE_KEYWORDS

| 项 | 说明 |
|----|------|
| **作用** | 站点级 SEO 关键词 |
| **适用** | 任意 scope |
| **输出** | 逗号分隔字符串 |
| **示例** | `<meta name="keywords" content="<HY_SITE_KEYWORDS />" />` |

**渲染后 HTML**（发布后，示例数据）

```html
<meta name="keywords" content="数据要素,可信空间,数据安全" />
```

### HY_SITE_LOGO

| 项 | 说明 |
|----|------|
| **作用** | Logo 图片 URL |
| **适用** | 任意 scope |
| **输出** | URL 路径 |
| **示例** | `<img src="<HY_SITE_LOGO />" alt="<HY_SITE_NAME />" />` |

**渲染后 HTML**（发布后，示例数据）

```html
<img src="assets/logo.png" alt="霍因科技" />
```

### HY_SITE_FAVICON

| 项 | 说明 |
|----|------|
| **作用** | 站点 favicon URL |
| **适用** | 任意 scope |
| **输出** | URL 路径 |
| **示例** | `<link rel="icon" href="<HY_SITE_FAVICON />" />` |

**渲染后 HTML**（发布后，示例数据）

```html
<link rel="icon" href="assets/favicon.ico" />
```

### HY_SITE_URL

| 项 | 说明 |
|----|------|
| **作用** | 站点主域名 |
| **适用** | 任意 scope |
| **输出** | 如 `https://hydata.com` |
| **示例** | `<a href="<HY_SITE_URL />">返回首页</a>` |

**渲染后 HTML**（发布后，示例数据）

```html
<a href="https://example.com">返回首页</a>
```

### HY_SITE_ICP

| 项 | 说明 |
|----|------|
| **作用** | ICP 备案号 |
| **适用** | 任意 scope |
| **输出** | 如 `沪ICP备2024xxxxxx号` |
| **示例** | `<footer><HY_SITE_ICP /></footer>` |

**渲染后 HTML**（发布后，示例数据）

```html
<footer>沪ICP备2024xxxxxx号</footer>
```

### HY_SITE_COPYRIGHT

| 项 | 说明 |
|----|------|
| **作用** | 版权声明文案 |
| **适用** | 任意 scope |
| **输出** | 如 `© 2026 霍因科技` |
| **示例** | `<footer><HY_SITE_COPYRIGHT /></footer>` |

**渲染后 HTML**（发布后，示例数据）

```html
<footer>© 2026 霍因科技</footer>
```

### HY_SITE_BREADCRUMB

| 项 | 说明 |
|----|------|
| **作用** | 强制使用站点级预渲染面包屑 HTML |
| **适用** | 任意 scope |
| **输出** | 完整 HTML 片段 |
| **示例** | `<nav><HY_SITE_BREADCRUMB /></nav>` |
| **注意** | 若需按页面自动切换，用 `HY_BREADCRUMB` |

**渲染后 HTML**（发布后，示例数据）

```html
<nav><a href="index.html">首页</a> / 产品中心</nav>
```

### HY_SITE_MENU

| 项 | 说明 |
|----|------|
| **作用** | 渲染预置导航菜单 HTML |
| **适用** | 主要 site scope |
| **属性** | `_location="header"` 或 `_location="footer"`（**必填其一**） |
| **示例** | `<header><HY_SITE_MENU _location="header" /></header>` |
| **注意** | 不传 `_location` 输出空；别名见 `HY_NAV` / `HY_FOOTER` |

**渲染后 HTML**（发布后，示例数据）

```html
<header>
  <!-- _location=header 时插入站点预渲染菜单，结构由菜单模板决定，常见为 ul/li/a -->
  <ul class="nav">
    <li><a href="index.html">首页</a></li>
    <li><a href="product/index.html">产品中心</a></li>
  </ul>
</header>
<!-- 不传 _location 时标签替换为空，只剩你写的外壳 -->
```

---

## 三、页面 SEO 标签（4 个）

用于 **site layout** 的 `<head>`。优先级：详情页 > 栏目页 > 站点兑底。

### HY_PAGE_TITLE

| 项 | 说明 |
|----|------|
| **作用** | 当前页标题 |
| **适用** | 任意 scope（常用于 site layout head） |
| **输出** | 详情：文章标题；栏目：栏目名；首页：站点名 |
| **示例** | `<title><HY_PAGE_TITLE /> · <HY_SITE_NAME /></title>` |

**渲染后 HTML**（发布后，示例数据）

```html
<title>数据要素市场化实践 · 霍因科技</title>
<!-- 栏目页则为「产品中心 · 霍因科技」；首页为「霍因科技 · 霍因科技」视你的 title 模板而定 -->
```

### HY_PAGE_URL

| 项 | 说明 |
|----|------|
| **作用** | 当前页 canonical URL |
| **适用** | site layout head |
| **输出** | 相对或绝对路径 |
| **示例** | `<link rel="canonical" href="<HY_PAGE_URL />" />` |

**渲染后 HTML**（发布后，示例数据）

```html
<link rel="canonical" href="product/shuju.html" />
```

### HY_PAGE_DESC

| 项 | 说明 |
|----|------|
| **作用** | 当前页 description |
| **适用** | site layout head |
| **输出** | 详情：摘要；栏目：栏目描述；首页：站点描述 |
| **示例** | `<meta name="description" content="<HY_PAGE_DESC />" />` |

**渲染后 HTML**（发布后，示例数据）

```html
<meta name="description" content="本文介绍数据要素市场化的实践路径。" />
```

### HY_PAGE_KEYWORDS

| 项 | 说明 |
|----|------|
| **作用** | 当前页 keywords |
| **适用** | site layout head |
| **输出** | 详情/栏目通常为空；首页为站点关键词 |
| **示例** | `<meta name="keywords" content="<HY_PAGE_KEYWORDS />" />` |

**渲染后 HTML**（发布后，示例数据）

```html
<meta name="keywords" content="数据要素,市场化" />
```

---

## 四、栏目标签（8 个）

栏目页与详情页可用；详情页中表示**文章所属栏目**。

### HY_CAT_ID

| 项 | 说明 |
|----|------|
| **作用** | 栏目 UUID |
| **适用** | category / content scope |
| **输出** | UUID 字符串 |
| **示例** | `<div data-cat-id="<HY_CAT_ID />">` |

**渲染后 HTML**（发布后，示例数据）

```html
<div data-cat-id="a1b2c3d4-e5f6-7890-abcd-ef1234567890">
```

### HY_CAT_NAME

| 项 | 说明 |
|----|------|
| **作用** | 栏目名称 |
| **适用** | category / content scope |
| **输出** | 如 `产品中心` |
| **示例** | `<h1><HY_CAT_NAME /></h1>` |

**渲染后 HTML**（发布后，示例数据）

```html
<h1>产品中心</h1>
```

### HY_CAT_SLUG

| 项 | 说明 |
|----|------|
| **作用** | 栏目 URL slug |
| **适用** | category / content scope |
| **输出** | 如 `product` |
| **示例** | `<HY_CONTENTS _cat="<HY_CAT_SLUG />" _limit="10">` |

**渲染后 HTML**（发布后，示例数据）

```html
<!-- 常嵌在属性里，渲染后变成普通字符串 -->
<!-- _cat="product" -->
```

### HY_CAT_DESCRIPTION

| 项 | 说明 |
|----|------|
| **作用** | 栏目描述 |
| **适用** | category / content scope |
| **输出** | 纯文本 |
| **示例** | `<p class="lead"><HY_CAT_DESCRIPTION /></p>` |

**渲染后 HTML**（发布后，示例数据）

```html
<p class="lead">面向政企的数据产品与解决方案</p>
```

### HY_CAT_COVER

| 项 | 说明 |
|----|------|
| **作用** | 栏目封面图 URL |
| **适用** | category / content scope |
| **输出** | URL |
| **示例** | `<img src="<HY_CAT_COVER />" alt="<HY_CAT_NAME />" />` |

**渲染后 HTML**（发布后，示例数据）

```html
<img src="assets/covers/product.jpg" alt="产品中心" />
```

### HY_CAT_URL

| 项 | 说明 |
|----|------|
| **作用** | 栏目列表页 URL |
| **适用** | category / content scope |
| **输出** | 如 `/product/` |
| **示例** | `<a href="<HY_CAT_URL />"><HY_CAT_NAME /></a>` |

**渲染后 HTML**（发布后，示例数据）

```html
<a href="product/index.html">产品中心</a>
```

### HY_CAT_PARENT_NAME

| 项 | 说明 |
|----|------|
| **作用** | 父栏目名称 |
| **适用** | category / content scope |
| **输出** | 顶级栏目为空 |
| **示例** | `<span>上级：<HY_CAT_PARENT_NAME /></span>` |

**渲染后 HTML**（发布后，示例数据）

```html
<span>上级：解决方案</span>
<!-- 顶级栏目时「上级：」后面为空 -->
```

### HY_CAT_PARENT_URL

| 项 | 说明 |
|----|------|
| **作用** | 父栏目列表页 URL |
| **适用** | category / content scope |
| **输出** | URL；顶级栏目为空 |
| **示例** | `<a href="<HY_CAT_PARENT_URL />"><HY_CAT_PARENT_NAME /></a>` |

**渲染后 HTML**（发布后，示例数据）

```html
<a href="solutions/index.html">解决方案</a>
```

### HY_CAT_META

| 项 | 说明 |
|----|------|
| **作用** | 读取栏目任意字段 |
| **适用** | category / content scope |
| **属性** | `_type="字段名"`（必填） |
| **示例** | `<p><HY_CAT_META _type="description" /></p>` |
| **示例** | `<code><HY_CAT_META _type="template" /></code>` |
| **注意** | 与 `HY_CAT_DESCRIPTION` 等价时可二选一 |

**渲染后 HTML**（发布后，示例数据）

```html
<p>面向政企的数据产品与解决方案</p>
<code></code>
<!-- _type 对不上字段时为空字符串 -->
```

---

## 五、内容详情标签（14 个）

**仅 content scope（详情页）**。列表循环内请用 `HY_ITEM_*`。

### HY_CONTENT_TITLE

| 项 | 说明 |
|----|------|
| **作用** | 文章标题 |
| **示例** | `<h1><HY_CONTENT_TITLE /></h1>` |

**渲染后 HTML**（发布后，示例数据）

```html
<h1>数据要素市场化实践</h1>
```

### HY_CONTENT_BODY

| 项 | 说明 |
|----|------|
| **作用** | 正文 HTML（Tiptap 编译结果，不 escape） |
| **示例** | `<article><HY_CONTENT_BODY /></article>` |
| **注意** | 别名 `HY_ITEM_BODY`（详情页） |

**渲染后 HTML**（发布后，示例数据）

```html
<article>
  <p>正文第一段。</p>
  <p>正文第二段（此处为编辑器里保存的 HTML，<strong>不转义</strong>）。</p>
</article>
```

### HY_CONTENT_URL

| 项 | 说明 |
|----|------|
| **作用** | 当前文章 URL |
| **示例** | `<link rel="canonical" href="<HY_CONTENT_URL />" />` |

**渲染后 HTML**（发布后，示例数据）

```html
<link rel="canonical" href="product/shuju.html" />
```

### HY_CONTENT_SUBTITLE

| 项 | 说明 |
|----|------|
| **作用** | 文章副标题 |
| **示例** | `<p class="subtitle"><HY_CONTENT_SUBTITLE /></p>` |

**渲染后 HTML**（发布后，示例数据）

```html
<p class="subtitle">从确权到入表</p>
```

### HY_CONTENT_SUMMARY / HY_CONTENT_EXCERPT

| 项 | 说明 |
|----|------|
| **作用** | 文章摘要（两标签相同） |
| **适用** | content scope |
| **示例** | `<p class="excerpt"><HY_CONTENT_SUMMARY /></p>` |

**渲染后 HTML**（发布后，示例数据）

```html
<p class="excerpt">本文介绍数据要素市场化的实践路径。</p>
```

### HY_CONTENT_CAT_NAME

| 项 | 说明 |
|----|------|
| **作用** | 所属栏目名（同详情页 `HY_CAT_NAME`） |
| **示例** | `<a href="<HY_CONTENT_CAT_URL />"><HY_CONTENT_CAT_NAME /></a>` |

**渲染后 HTML**（发布后，示例数据）

```html
<a href="product/index.html">产品中心</a>
```

### HY_CONTENT_CAT_URL

| 项 | 说明 |
|----|------|
| **作用** | 所属栏目 URL |
| **示例** | 同上 |

**渲染后 HTML**（发布后，示例数据）

```html
<a href="product/index.html">产品中心</a>
```

### HY_CONTENT_DATE

| 项 | 说明 |
|----|------|
| **作用** | 发布日期（ISO 完整） |
| **示例** | `<time datetime="<HY_CONTENT_DATE />"><HY_CONTENT_DATE /></time>` |

**渲染后 HTML**（发布后，示例数据）

```html
<time datetime="2026-08-01T09:00:00+08:00">2026-08-01T09:00:00+08:00</time>
```

### HY_CONTENT_DATE_SHORT

| 项 | 说明 |
|----|------|
| **作用** | 发布日期 `YYYY-MM-DD` |
| **示例** | `<time><HY_CONTENT_DATE_SHORT /></time>` |
| **注意** | 推荐用于展示；别名场景见 `HY_ITEM_PUBLISH_DATE` |

**渲染后 HTML**（发布后，示例数据）

```html
<time>2026-08-01</time>
```

### HY_CONTENT_PUBLISH_DATE

| 项 | 说明 |
|----|------|
| **作用** | 格式化后的发布日期 |
| **属性** | `_format="YYYY-MM-DD"`（默认）/`YYYY`/`YYYY.MM.DD` |
| **示例** | `<time><HY_CONTENT_PUBLISH_DATE /></time>` |

**渲染后 HTML**（发布后，示例数据）

```html
<time>2026-08-01</time>
```

### HY_CONTENT_READ_TIME

| 项 | 说明 |
|----|------|
| **作用** | 按正文字数估算的阅读时长 |
| **输出** | 如 `约 3 分钟阅读` |
| **示例** | `<span><HY_CONTENT_READ_TIME /></span>` |

**渲染后 HTML**（发布后，示例数据）

```html
<span>约 3 分钟阅读</span>
```

### HY_CONTENT_KEYWORDS

| 项 | 说明 |
|----|------|
| **作用** | 文章 SEO 关键词 |
| **示例** | `<meta name="keywords" content="<HY_CONTENT_KEYWORDS />" />` |

**渲染后 HTML**（发布后，示例数据）

```html
<meta name="keywords" content="数据要素,确权" />
```

### HY_CONTENT_AUTHOR

| 项 | 说明 |
|----|------|
| **作用** | 作者显示名 |
| **示例** | `<span>作者：<HY_CONTENT_AUTHOR /></span>` |

**渲染后 HTML**（发布后，示例数据）

```html
<span>作者：张三</span>
```

### HY_CONTENT_META

| 项 | 说明 |
|----|------|
| **作用** | 读取文章任意字段 |
| **属性** | `_type="字段名"` |
| **示例** | `<span><HY_CONTENT_META _type="view_count" /> 次阅读</span>` |

**渲染后 HTML**（发布后，示例数据）

```html
<span>128 次阅读</span>
```

### HY_CONTENT_PREV

| 项 | 说明 |
|----|------|
| **作用** | 上一篇完整 HTML 块（含 `<a>`） |
| **输出** | 预渲染 HTML |
| **示例** | `<nav><HY_CONTENT_PREV /></nav>` |

**渲染后 HTML**（发布后，示例数据）

```html
<nav><a class="prev" href="product/qianyi.html">← 上一篇：数据确权路径</a></nav>
<!-- 没有上一篇时标签位置为空 -->
```

### HY_CONTENT_NEXT

| 项 | 说明 |
|----|------|
| **作用** | 下一篇完整 HTML 块 |
| **示例** | `<nav><HY_CONTENT_NEXT /></nav>` |

**渲染后 HTML**（发布后，示例数据）

```html
<nav><a class="next" href="product/rujie.html">下一篇：数据入表实践 →</a></nav>
```

### HY_CONTENT_PREV_URL / HY_CONTENT_NEXT_URL

| 项 | 说明 |
|----|------|
| **作用** | 从上下篇 HTML 中提取 bare URL |
| **示例** | `<a class="prev" href="<HY_CONTENT_PREV_URL />">← 上一篇</a>` |
| **示例** | `<a class="next" href="<HY_CONTENT_NEXT_URL />">下一篇 →</a>` |
| **注意** | 配合 `HY_IF _condition="content.prev_html"` 判断是否有上一篇 |

**渲染后 HTML**（发布后，示例数据）

```html
<a class="prev" href="product/qianyi.html">← 上一篇</a>
<a class="next" href="product/rujie.html">下一篇 →</a>
<!-- 从 prev/next 整块 HTML 里抽出的裸 href；没有上下篇时为空 -->
```

---

## 六、列表项标签（16 个）

**仅在 `<HY_CONTENTS>...</HY_CONTENTS>` 容器内**可用。

### HY_ITEM_ID

| 项 | 说明 |
|----|------|
| **作用** | 当前循环项内容 UUID |
| **示例** | `<article id="post-<HY_ITEM_ID />">` |

**渲染后 HTML**（发布后，示例数据）

```html
<article id="post-11111111-2222-3333-4444-555555555555">
```

### HY_ITEM_TITLE

| 项 | 说明 |
|----|------|
| **作用** | 列表项标题 |
| **示例** | `<h3><a href="<HY_ITEM_URL />"><HY_ITEM_TITLE /></a></h3>` |

**渲染后 HTML**（发布后，示例数据）

```html
<h3><a href="product/shuju.html">数据要素市场化实践</a></h3>
```

### HY_ITEM_URL

| 项 | 说明 |
|----|------|
| **作用** | 列表项详情页 URL |
| **示例** | `<a href="<HY_ITEM_URL />">阅读全文</a>` |

**渲染后 HTML**（发布后，示例数据）

```html
<a href="product/shuju.html">阅读全文</a>
```

### HY_ITEM_SUMMARY

| 项 | 说明 |
|----|------|
| **作用** | 摘要（excerpt） |
| **示例** | `<p><HY_ITEM_SUMMARY _filter="truncate(120)" /></p>` |

**渲染后 HTML**（发布后，示例数据）

```html
<p>本文介绍数据要素市场化的实践路径。……</p>
<!-- truncate(120) 时超过 120 字会被截断 -->
```

### HY_ITEM_EXCERPT

| 项 | 说明 |
|----|------|
| **作用** | 同 `HY_ITEM_SUMMARY`（别名） |
| **示例** | `<p><HY_ITEM_EXCERPT /></p>` |

**渲染后 HTML**（发布后，示例数据）

```html
<p>本文介绍数据要素市场化的实践路径。</p>
```

### HY_ITEM_COVER

| 项 | 说明 |
|----|------|
| **作用** | 封面图 URL |
| **示例** | `<img src="<HY_ITEM_COVER />" alt="<HY_ITEM_TITLE />" loading="lazy" />` |

**渲染后 HTML**（发布后，示例数据）

```html
<img src="assets/covers/shuju.jpg" alt="数据要素市场化实践" loading="lazy" />
```

### HY_ITEM_BANNER

| 项 | 说明 |
|----|------|
| **作用** | 列表项 Banner 大图 URL（无 Banner 时回退封面） |
| **适用** | 仅 `HY_CONTENTS` 内 |
| **示例** | `<img src="<HY_ITEM_BANNER />" alt="<HY_ITEM_TITLE />" />` |

**渲染后 HTML**（发布后，示例数据）

```html
<img src="assets/banners/shuju.jpg" alt="数据要素市场化实践" />
```

### HY_ITEM_SUBTITLE

| 项 | 说明 |
|----|------|
| **作用** | 列表项副标题 |
| **示例** | `<p class="sub"><HY_ITEM_SUBTITLE /></p>` |

**渲染后 HTML**（发布后，示例数据）

```html
<p class="sub">从确权到入表</p>
```

### HY_ITEM_DATE

| 项 | 说明 |
|----|------|
| **作用** | 短日期 `YYYY-MM-DD` |
| **示例** | `<time><HY_ITEM_DATE /></time>` |

**渲染后 HTML**（发布后，示例数据）

```html
<time>2026-08-01</time>
```

### HY_ITEM_DATE_YEAR

| 项 | 说明 |
|----|------|
| **作用** | 年份 `YYYY` |
| **示例** | `<span class="year"><HY_ITEM_DATE_YEAR /></span>` |

**渲染后 HTML**（发布后，示例数据）

```html
<span class="year">2026</span>
```

### HY_ITEM_DATETIME

| 项 | 说明 |
|----|------|
| **作用** | ISO 完整日期时间 |
| **示例** | `<time datetime="<HY_ITEM_DATETIME />">` |

**渲染后 HTML**（发布后，示例数据）

```html
<time datetime="2026-08-01T09:00:00+08:00">
```

### HY_ITEM_AUTHOR

| 项 | 说明 |
|----|------|
| **作用** | 作者名 |
| **示例** | `<span><HY_ITEM_AUTHOR /></span>` |

**渲染后 HTML**（发布后，示例数据）

```html
<span>张三</span>
```

### HY_ITEM_CAT_NAME / HY_ITEM_CAT_URL

| 项 | 说明 |
|----|------|
| **作用** | 列表项所属栏目名 / URL |
| **示例** | `<a href="<HY_ITEM_CAT_URL />"><HY_ITEM_CAT_NAME /></a>` |

**渲染后 HTML**（发布后，示例数据）

```html
<a href="product/index.html">产品中心</a>
```

### HY_ITEM_TAGS

| 项 | 说明 |
|----|------|
| **作用** | 标签列表预渲染 HTML（`<a class="tag">`） |
| **属性** | `_separator` 在文档中提及，实际输出为连续 `<a>` |
| **示例** | `<div class="tags"><HY_ITEM_TAGS /></div>` |
| **注意** | 输出为 HTML，已在安全白名单 |

**渲染后 HTML**（发布后，示例数据）

```html
<div class="tags"><a class="tag" href="/tag/ai.html">AI</a><a class="tag" href="/tag/data.html">数据要素</a></div>
<!-- 无标签时 <div class="tags"></div> 中间为空 -->
```

### HY_ITEM_HITS

| 项 | 说明 |
|----|------|
| **作用** | 阅读数 |
| **示例** | `<span><HY_ITEM_HITS /> 阅读</span>` |

**渲染后 HTML**（发布后，示例数据）

```html
<span>128 阅读</span>
```

### HY_ITEM_META

| 项 | 说明 |
|----|------|
| **作用** | 读取列表项任意字段 |
| **属性** | `_type="字段名"` |
| **示例** | `<span><HY_ITEM_META _type="slug" /></span>` |

**渲染后 HTML**（发布后，示例数据）

```html
<span>shuju</span>
```

### HY_ITEM_BODY（别名）

| 项 | 说明 |
|----|------|
| **作用** | 详情页正文；在列表循环内为当前项 body |
| **适用** | content scope（详情页推荐用 `HY_CONTENT_BODY`） |
| **示例** | `<div><HY_ITEM_BODY /></div>` |

**渲染后 HTML**（发布后，示例数据）

```html
<div><p>列表循环内输出该条的 body HTML；详情页请优先用 HY_CONTENT_BODY。</p></div>
```

### HY_ITEM_PUBLISH_DATE（别名）

| 项 | 说明 |
|----|------|
| **作用** | 格式化发布日期 |
| **属性** | `_format="YYYY-MM-DD"`（默认）或 `YYYY` |
| **示例** | `<time><HY_ITEM_PUBLISH_DATE _format="YYYY-MM-DD" /></time>` |

**渲染后 HTML**（发布后，示例数据）

```html
<time>2026-08-01</time>
<!-- _format="YYYY" 时为 2026；YYYY.MM.DD 时为 2026.08.01 -->
```

---

## 七、栏目循环项标签（8 个）

**仅在 `<HY_CATS>...</HY_CATS>` 容器内**可用。

### HY_CAT_ITEM_ID

| 项 | 说明 |
|----|------|
| **作用** | 子栏目 UUID |
| **示例** | `<li data-id="<HY_CAT_ITEM_ID />">` |

**渲染后 HTML**（发布后，示例数据）

```html
<li data-id="bbbbbbbb-cccc-dddd-eeee-ffffffffffff">
```

### HY_CAT_ITEM_NAME

| 项 | 说明 |
|----|------|
| **作用** | 子栏目名称 |
| **示例** | `<a href="<HY_CAT_ITEM_URL />"><HY_CAT_ITEM_NAME /></a>` |

**渲染后 HTML**（发布后，示例数据）

```html
<a href="product/haishi/index.html">海石 AI 标签平台</a>
```

### HY_CAT_ITEM_SLUG

| 项 | 说明 |
|----|------|
| **作用** | 子栏目 slug |
| **示例** | `<span><HY_CAT_ITEM_SLUG /></span>` |

**渲染后 HTML**（发布后，示例数据）

```html
<span>haishi</span>
```

### HY_CAT_ITEM_URL

| 项 | 说明 |
|----|------|
| **作用** | 子栏目 URL |
| **示例** | `<a href="<HY_CAT_ITEM_URL />"><HY_CAT_ITEM_NAME /></a>` |

**渲染后 HTML**（发布后，示例数据）

```html
<a href="product/haishi/index.html">海石 AI 标签平台</a>
```

### HY_CAT_ITEM_COVER

| 项 | 说明 |
|----|------|
| **作用** | 子栏目封面 |
| **示例** | `<img src="<HY_CAT_ITEM_COVER />" />` |

**渲染后 HTML**（发布后，示例数据）

```html
<img src="assets/covers/haishi.jpg" />
```

### HY_CAT_ITEM_DESCRIPTION

| 项 | 说明 |
|----|------|
| **作用** | 子栏目描述 |
| **示例** | `<p><HY_CAT_ITEM_DESCRIPTION /></p>` |

**渲染后 HTML**（发布后，示例数据）

```html
<p>智能标签与分类</p>
```

### HY_CAT_ITEM_HAS_CHILDREN

| 项 | 说明 |
|----|------|
| **作用** | 是否有下级栏目（用于 `HY_IF`） |
| **输出** | `1` 或空 |
| **示例** | `<HY_IF _condition="cat_item.has_children">`（在 CATS 循环内用 cat 上下文） |

**渲染后 HTML**（发布后，示例数据）

```html
<!-- 标签本身输出 1 或空字符串，通常配合 HY_IF，而不是直接显示 -->
<!-- 有子栏目时条件为真，下面 li 会留下 -->
<li>海石 AI 标签平台</li>
```

### HY_CAT_ITEM_CHILD_COUNT

| 项 | 说明 |
|----|------|
| **作用** | 子栏目数量 |
| **输出** | 数字字符串 |
| **示例** | `<span><HY_CAT_ITEM_CHILD_COUNT /> 个子栏目</span>` |

**渲染后 HTML**（发布后，示例数据）

```html
<span>3 个子栏目</span>
```

### HY_CAT_ITEM_CURRENT_CLASS

| 项 | 说明 |
|----|------|
| **作用** | 循环到「当前栏目」时输出 class 名 |
| **输出** | 当前项为 `is-current`，否则空 |
| **示例** | `<li class="<HY_CAT_ITEM_CURRENT_CLASS />">` |

**渲染后 HTML**（发布后，示例数据）

```html
<li class="is-current">
<!-- 非当前栏目：<li class=""> -->
```

---

## 八、资源与媒体标签（4 个）

### HY_SITE_CSS

| 项 | 说明 |
|----|------|
| **作用** | 批量输出 `<link rel="stylesheet">` |
| **适用** | site layout `<head>` |
| **属性** | 无属性=css 目录全部；`_include="a.css,b.css"` 白名单；`_exclude="x.css"` 黑名单 |
| **示例** | `<HY_SITE_CSS />` |
| **示例** | `<HY_SITE_CSS _include="style-merged.css,news-list.css" />` |
| **注意** | `_include` 与 `_exclude` 互斥，优先 `_include` |

**渲染后 HTML**（发布后，示例数据）

```html
<link rel="stylesheet" href="assets/site.css">
    <link rel="stylesheet" href="assets/news-list.css">
<!-- 栏目子页深度+1 时 href 变为 ../assets/site.css -->
```

### HY_SITE_JS

| 项 | 说明 |
|----|------|
| **作用** | 批量输出 `<script src="...">` |
| **适用** | site layout `</body>` 前 |
| **属性** | 同 `HY_SITE_CSS` |
| **示例** | `<HY_SITE_JS _include="app.js" />` |

**渲染后 HTML**（发布后，示例数据）

```html
<script src="assets/app.js"></script>
```

### HY_ASSET_URL

| 项 | 说明 |
|----|------|
| **作用** | 单个站点资源 URL（admin → 站点资源） |
| **属性** | `_name="文件名"`（推荐） |
| **示例** | `<link href="<HY_ASSET_URL _name="site.css" />" rel="stylesheet" />` |
| **示例** | `<img src="<HY_ASSET_URL _name="logo.svg" />" />` |
| **注意** | 资源未上传则输出空，不 404 |

**渲染后 HTML**（发布后，示例数据）

```html
<link href="assets/site.css" rel="stylesheet" />
<img src="assets/logo.svg" />
<!-- 站点资源里没有该文件名时，href/src 变成空字符串 -->
```

### HY_SITE_LINK

| 项 | 说明 |
|----|------|
| **作用** | 站点内页相对链接（按当前页深度自动加 `../`） |
| **属性** | `_path="product/shuju.html"` |
| **示例** | `<a href="<HY_SITE_LINK _path="product/shuju.html" />">阅读</a>` |

**渲染后 HTML**（发布后，示例数据）

```html
<a href="product/shuju.html">阅读</a>
<!-- 若当前页在栏目子目录，可能是 ../product/shuju.html -->
```

### HY_MEDIA

| 项 | 说明 |
|----|------|
| **作用** | 媒体库图片 URL |
| **属性** | `_id="媒体UUID"`（admin 媒体库复制） |
| **示例** | `<img src="<HY_MEDIA _id="550e8400-e29b-41d4-a716-446655440000" />" alt="" />` |
| **注意** | 发布后会 inline 到 `assets/`；ID 不存在输出空 |

**渲染后 HTML**（发布后，示例数据）

```html
<img src="assets/media/photo.jpg" alt="" />
<!-- 媒体 ID 不存在时 src="" -->
```

---

## 九、列表辅助标签（3 个）

### HY_CONTENTS_COUNT

| 项 | 说明 |
|----|------|
| **作用** | 当前上下文内容总数 |
| **适用** | category / home scope |
| **输出** | 数字字符串 |
| **示例** | `<p>共 <HY_CONTENTS_COUNT /> 篇文章</p>` |
| **注意** | 不受 `_limit` 影响，反映过滤后总量 |

**渲染后 HTML**（发布后，示例数据）

```html
<p>共 36 篇文章</p>
```

### HY_CONTENTS_PAGINATION

| 项 | 说明 |
|----|------|
| **作用** | 输出分页导航 HTML |
| **适用** | 紧跟 `<HY_CONTENTS>` 之后 |
| **属性** | `_show_numbers="true"`（默认显示页码；`false` 仅 prev/next） |
| **示例** | `<HY_CONTENTS _limit="12">...</HY_CONTENTS><HY_CONTENTS_PAGINATION />` |
| **注意** | 必须前面有 `HY_CONTENTS` 循环；别名 `HY_PAGINATION` |

**渲染后 HTML**（发布后，示例数据）

```html
<nav class="pagination"><a class="prev" href="product/index.html">上一页</a><a href="product/index.html">1</a><span class="current" aria-current="page">2</span><a href="product/page-3.html">3</a><a class="next" href="product/page-3.html">下一页</a></nav>
<!-- 总条数不超过 _limit 时整段输出空，连 nav 都没有 -->
```

### HY_PAGINATION

| 项 | 说明 |
|----|------|
| **作用** | `HY_CONTENTS_PAGINATION` 别名 |
| **示例** | `<HY_PAGINATION _show_numbers="true" />` |

**渲染后 HTML**（发布后，示例数据）

```html
<!-- 与 HY_CONTENTS_PAGINATION 相同 -->
<nav class="pagination">…</nav>
```

---

## 十、详情页扩展标签（1 个）

### HY_RELATED_LIST

| 项 | 说明 |
|----|------|
| **作用** | 同栏目相关文章列表（排除当前篇） |
| **适用** | content scope |
| **属性** | `_limit="5"`（默认 5） |
| **输出** | `<ul class="related-list"><li><a>...</a></li></ul>` |
| **示例** | `<aside><h3>相关阅读</h3><HY_RELATED_LIST _limit="5" /></aside>` |

**渲染后 HTML**（发布后，示例数据）

```html
<!-- 标签自己就会带 aside，模板里不必再套一层标题 -->
<aside class="related-reading"><h3>相关阅读</h3>
<ul class="related-list">
<li><a href="product/qianyi.html">数据确权路径</a></li>
<li><a href="product/rujie.html">数据入表实践</a></li>
</ul></aside>
<!-- 无相关文章时输出空字符串 -->
```

---

## 十一、首页块标签（5 个）

数据来自站点 settings（hero / stats / products / cta）。settings 为空则不输出。

### HY_SITE_HERO

| 项 | 说明 |
|----|------|
| **作用** | 输出 Hero 区完整 HTML（badge + 标题 + 描述 + CTA 按钮） |
| **适用** | home scope |
| **示例** | `<section class="hero"><HY_SITE_HERO /></section>` |
| **别名** | `HY_HOME_HERO` |

**渲染后 HTML**（发布后，示例数据）

```html
<section class="hero">
  <div class="hero-badge">
    <span class="dot"></span>
    数据要素
  </div>
  <h1>让数据可信流通</h1>
  <p class="hero-slogan">面向政企的数据基础设施</p>
  <p class="hero-desc">覆盖确权、入表与流通全链路。</p>  <div class="cta-row">
    <a class="btn btn-primary" href="product/index.html">了解产品 →</a>
    <a class="btn btn-secondary" href="contact/index.html">联系我们 →</a>
  </div>
</section>
<!-- 站点 settings.hero 无 title 时，section 内为空 -->
```

### HY_HOME_HERO

| 项 | 说明 |
|----|------|
| **作用** | `HY_SITE_HERO` 别名 |
| **示例** | `<HY_HOME_HERO />` |

**渲染后 HTML**（发布后，示例数据）

```html
<!-- 与 HY_SITE_HERO 完全相同 -->
```

### HY_SITE_STATS

| 项 | 说明 |
|----|------|
| **作用** | 数字指标 grid（带 `data-count` 动画属性） |
| **适用** | home scope |
| **示例** | `<section><HY_SITE_STATS /></section>` |

**渲染后 HTML**（发布后，示例数据）

```html
<section>
  <div class="stats-grid">
    <div class="stat"><div class="stat-value" data-count="120" data-suffix="+">0+</div><div class="stat-label">落地项目</div></div>
    <div class="stat"><div class="stat-value" data-count="30" data-suffix="">0</div><div class="stat-label">合作机构</div></div>
  </div>
</section>
```

### HY_SITE_PRODUCTS

| 项 | 说明 |
|----|------|
| **作用** | 产品卡片 grid（通常 3 张） |
| **适用** | home scope |
| **示例** | `<section><HY_SITE_PRODUCTS /></section>` |

**渲染后 HTML**（发布后，示例数据）

```html
<section>
  <div class="products-grid">
    <div class="product-card"><div class="product-icon">◆</div><h3 class="product-name"><a href="product/haishi.html">海石平台</a></h3><p class="product-desc">智能标签</p></div>
  </div>
</section>
```

### HY_SITE_CTA

| 项 | 说明 |
|----|------|
| **作用** | 底部行动号召区 |
| **适用** | home scope |
| **示例** | `<section><HY_SITE_CTA /></section>` |

**渲染后 HTML**（发布后，示例数据）

```html
<section>
  <div class="cta-inner">
    <h2 class="cta-title">预约演示</h2>
    <p class="cta-desc">了解如何落地数据要素。</p>
    <a class="btn btn-primary" href="contact/index.html">立即咨询 →</a>
  </div>
</section>
```

### HY_HOME_FEATURED

| 项 | 说明 |
|----|------|
| **作用** | 精选内容 grid（内置卡片结构） |
| **适用** | home scope |
| **属性** | `_limit="6"` `_order="newest"` |
| **示例** | `<section><HY_HOME_FEATURED _limit="6" /></section>` |

**渲染后 HTML**（发布后，示例数据）

```html
<section>
<div class="featured-grid">
<article class="featured-card"><a href="product/shuju.html"><img src="assets/covers/shuju.jpg" alt="数据要素市场化实践" loading="lazy" /><h3>数据要素市场化实践</h3></a></article>
</div>
</section>
```

---

## 十二、导航与面包屑（4 个）

### HY_BREADCRUMB

| 项 | 说明 |
|----|------|
| **作用** | 按 context 自动选择面包屑 HTML |
| **适用** | 任意 scope |
| **属性** | `_separator=" / "`（若后端支持分隔符注入） |
| **示例** | `<nav><HY_BREADCRUMB /></nav>` |
| **注意** | 详情 > 栏目 > 站点 优先级自动 |

**渲染后 HTML**（发布后，示例数据）

```html
<nav><a href="index.html">首页</a> / <a href="product/index.html">产品中心</a> / 数据要素市场化实践</nav>
<!-- 实际 HTML 以发布时预渲染的 breadcrumb_html 为准 -->
```

### HY_MENU_ACTIVE

| 项 | 说明 |
|----|------|
| **作用** | 导航当前页 class 片段 |
| **适用** | site scope 静态 nav |
| **属性** | `_match="/news/"`（必填，尾斜杠路径） |
| **输出** | 匹配时 ` active`，否则空 |
| **示例** | `<a href="/news/" class="nav-link<HY_MENU_ACTIVE _match="/news/" />">新闻</a>` |
| **注意** | 拼在 class 属性内，非独立 class |

**渲染后 HTML**（发布后，示例数据）

```html
<a href="/news/" class="nav-link active">新闻</a>
<!-- 当前路径不匹配时：class="nav-link"（active 前的空格也不会出现） -->
```

### HY_NAV

| 项 | 说明 |
|----|------|
| **作用** | 顶栏菜单别名（等同 `HY_SITE_MENU _location="header"`） |
| **示例** | `<nav><HY_NAV /></nav>` |

**渲染后 HTML**（发布后，示例数据）

```html
<nav><!-- 等同 HY_SITE_MENU _location="header" 的预渲染菜单 HTML --></nav>
```

### HY_FOOTER

| 项 | 说明 |
|----|------|
| **作用** | 页脚菜单别名（等同 `HY_SITE_MENU _location="footer"`） |
| **示例** | `<footer><HY_FOOTER /></footer>` |

**渲染后 HTML**（发布后，示例数据）

```html
<footer><!-- 等同 HY_SITE_MENU _location="footer" 的预渲染菜单 HTML --></footer>
```

---

## 十三、容器标签（6 个）

### HY_CONTENTS

| 项 | 说明 |
|----|------|
| **作用** | 内容列表循环容器 |
| **适用** | category / home scope |
| **属性** | `_limit` 条数；`_order` newest（新→旧）/ oldest（旧→新）/ hits / random；`_order_by` published（发布日期，默认）/ created（创建日期）/ updated（更新日期）；`_cat` 栏目 slug；`_page` 页码 |
| **示例** | 见下方完整块 |
| **注意** | 必须闭合 `</HY_CONTENTS>`；不可嵌套另一个 CONTENTS/CATS。`_order_by` 只在 newest/oldest 时生效。 |

**渲染后 HTML**（发布后，示例数据）

```html
<article>
    <h3><a href="product/shuju.html">数据要素市场化实践</a></h3>
    <p>本文介绍数据要素市场化的实践路径。</p>
  </article>
<article>
    <h3><a href="product/qianyi.html">数据确权路径</a></h3>
    <p>从登记到凭证。</p>
  </article>
<!-- 容器标签本身不生成 ul/div；你在容器里写什么结构，就重复多少遍 -->
<!-- 0 篇文章时容器位置为空，请紧跟 HY_CONTENTS_EMPTY -->
```

```html
<HY_CONTENTS _limit="12" _order="newest" _order_by="published">
  <article>
    <h3><a href="<HY_ITEM_URL />"><HY_ITEM_TITLE /></a></h3>
    <p><HY_ITEM_SUMMARY /></p>
  </article>
</HY_CONTENTS>
<!-- 按创建时间倒序：_order_by="created"；正序用 _order="oldest" -->
```

### HY_CONTENTS_EMPTY

| 项 | 说明 |
|----|------|
| **作用** | 当上一个 `HY_CONTENTS` 结果为空时显示包裹内容 |
| **适用** | 紧跟 `HY_CONTENTS` 之后 |
| **示例** | `<HY_CONTENTS_EMPTY><p>暂无内容</p></HY_CONTENTS_EMPTY>` |
| **注意** | 必须闭合 |

**渲染后 HTML**（发布后，示例数据）

```html
<p>暂无内容</p>
<!-- 上一轮 HY_CONTENTS 有结果时，这一段整段删掉（包括你写的 p） -->
```

### HY_CATS

| 项 | 说明 |
|----|------|
| **作用** | 栏目列表循环容器 |
| **属性** | `_type="children"`（默认，当前栏目的子栏目）/ `root` / `all`；`_limit` |
| **示例** | `<HY_CATS _type="children"><li><a href="<HY_CAT_ITEM_URL />"><HY_CAT_ITEM_NAME /></a></li></HY_CATS>` |

**渲染后 HTML**（发布后，示例数据）

```html
<li><a href="product/haishi/index.html">海石 AI 标签平台</a></li><li><a href="product/taitan/index.html">泰坦可信空间</a></li>
<!-- 同样只重复内部 HTML，不自动包 ul -->
```

### HY_IF

| 项 | 说明 |
|----|------|
| **作用** | 条件渲染 |
| **属性** | `_condition="表达式"`（必填） |
| **条件语法** | `content.has_cover` / `!content.has_cover` / `contents` / `contents.count > 5` / `cat.has_children` |
| **示例** | `<HY_IF _condition="content.has_cover"><img src="<HY_ITEM_COVER />" /></HY_IF>` |
| **注意** | 必须 `</HY_IF>`；不支持 AND/OR，需嵌套 |

**渲染后 HTML**（发布后，示例数据）

```html
<img src="assets/covers/shuju.jpg" />
<!-- 条件为假时，IF 内全部消失 -->
```

### HY_INCLUDE

| 项 | 说明 |
|----|------|
| **作用** | 引入 partial 片段文件 |
| **属性** | `_file="xxx.html"` |
| **示例** | `<HY_INCLUDE _file="site-header.html" />` |
| **注意** | partial 存于站点 `partials/` 目录 |

**渲染后 HTML**（发布后，示例数据）

```html
<!-- 替换为 partials/site-header.html 经同一套管线渲染后的 HTML -->
<header>霍因科技</header>
```

### HY_TEMPLATE

| 项 | 说明 |
|----|------|
| **作用** | 引用同站点另一 layout 模板（按 code） |
| **属性** | `code="header-v1"`（业务属性，非 `_` 前缀） |
| **示例** | `<HY_TEMPLATE code="footer-corp" />` |
| **注意** | 防环最多 8 层；既可自闭合也可作容器（后端 CONTAINER 白名单） |

**渲染后 HTML**（发布后，示例数据）

```html
<!-- 替换为 code=footer-corp 那份子模板渲染后的 HTML -->
<footer>© 2026 霍因科技</footer>
<!-- 找不到 code / 形成环时保留原标签或告警，以发布日志为准；可用 code 或 _code -->
```

---

## 十四、过滤器 `_filter`（链式）

在标签属性末尾加 `_filter="链"`，用 `|` 连接。

| 过滤器 | 写法 | 示例 |
|--------|------|------|
| truncate | `truncate(N)` | `_filter="truncate(80)"` |
| date | `date('Y-m-d')` | `_filter="date('Y-m-d')"` |
| default | `default('无')` | `_filter="default('暂无标题')"` |
| upper / lower | `upper` / `lower` | `_filter="upper"` |
| strip_html | `strip_html` | `_filter="strip_html"` |
| urlencode | `urlencode` | `_filter="urlencode"` |
| abs_url | `abs_url` | `_filter="abs_url"` |

**链式示例：**

```html
<HY_ITEM_SUMMARY _filter="truncate(120) | strip_html" />
<HY_CONTENT_DATE _filter="date('Y-m-d')" />
```

---

## 十五、scope 对照表

| scope | 典型 layout | 常用标签 |
|-------|-------------|----------|
| **site** | 全站外壳 | `HY_PAGE_*` `HY_SITE_CSS/JS` `HY_MENU_ACTIVE` `__LAYOUT_CONTENT__` |
| **home** | 首页 | `HY_SITE_HERO` `HY_CONTENTS` `HY_HOME_FEATURED` |
| **category** | 栏目列表 | `HY_CAT_*` `HY_CONTENTS` `HY_CONTENTS_PAGINATION` |
| **content** | 文章详情 | `HY_CONTENT_*` `HY_RELATED_LIST` |
| **partial** | 子模板 | 被 `HY_TEMPLATE` 引用 |

---

## 十六、常见错误速查

| 错误写法 | 正确写法 |
|----------|----------|
| 详情页 `<HY_ITEM_TITLE />` | `<HY_CONTENT_TITLE />` |
| 列表外 `<HY_ITEM_URL />` | 放在 `<HY_CONTENTS>` 内 |
| `limit="10"` | `_limit="10"` |
| `<HY_SITE_MENU />` 无输出 | 加 `_location="header"` |
| 分页无输出 | 先写 `<HY_CONTENTS>` 再写 `<HY_CONTENTS_PAGINATION />` |
| 容器未闭合 | 必须 `</HY_CONTENTS>` 等 |

---

*AI-CMS v1.1 · 共 90+ 标签 · 模板只描述结构，样式由 HTML/CSS 决定*
