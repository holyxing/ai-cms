#!/usr/bin/env python3
"""给 HY_ 标签手册每个标签补「渲染后 HTML」对照。可重复运行（已有则跳过）。"""
from __future__ import annotations

from pathlib import Path

MD = Path(__file__).resolve().parents[1] / "docs" / "HY_标签逐条使用手册.md"

MARKER = "**渲染后 HTML**"


def block(html: str) -> str:
    return f"\n{MARKER}（发布后，示例数据）\n\n```html\n{html.strip()}\n```\n"


# heading 标题（不含 ### ）→ 渲染后片段
RENDER: dict[str, str] = {
    "HY_NOW": block("""<footer>构建于 2026-08-24T10:00:00+08:00</footer>"""),
    "HY_BUILD_ID": block("""<link rel="stylesheet" href="assets/site.css?v=3fa85f64-5717-4562-b3fc-2c963f66afa6" />"""),
    "HY_THEME_VERSION": block("""<link href="assets/style.css?v=2" />"""),
    "HY_BASE_URL": block("""<a href="https://example.com/news/">新闻中心</a>"""),
    "HY_SITE_NAME": block("""<h1>霍因科技</h1>
<title>数据要素市场化实践 · 霍因科技</title>"""),
    "HY_SITE_SLOGAN": block("""<p class="slogan">让数据要素可信流通</p>"""),
    "HY_SITE_DESCRIPTION": block("""<meta name="description" content="霍因科技官方网站" />"""),
    "HY_SITE_KEYWORDS": block("""<meta name="keywords" content="数据要素,可信空间,数据安全" />"""),
    "HY_SITE_LOGO": block("""<img src="assets/logo.png" alt="霍因科技" />"""),
    "HY_SITE_FAVICON": block("""<link rel="icon" href="assets/favicon.ico" />"""),
    "HY_SITE_URL": block("""<a href="https://example.com">返回首页</a>"""),
    "HY_SITE_ICP": block("""<footer>沪ICP备2024xxxxxx号</footer>"""),
    "HY_SITE_COPYRIGHT": block("""<footer>© 2026 霍因科技</footer>"""),
    "HY_SITE_BREADCRUMB": block("""<nav><a href="index.html">首页</a> / 产品中心</nav>"""),
    "HY_SITE_MENU": block("""<header>
  <!-- _location=header 时插入站点预渲染菜单，结构由菜单模板决定，常见为 ul/li/a -->
  <ul class="nav">
    <li><a href="index.html">首页</a></li>
    <li><a href="product/index.html">产品中心</a></li>
  </ul>
</header>
<!-- 不传 _location 时标签替换为空，只剩你写的外壳 -->"""),
    "HY_PAGE_TITLE": block("""<title>数据要素市场化实践 · 霍因科技</title>
<!-- 栏目页则为「产品中心 · 霍因科技」；首页为「霍因科技 · 霍因科技」视你的 title 模板而定 -->"""),
    "HY_PAGE_URL": block("""<link rel="canonical" href="product/shuju.html" />"""),
    "HY_PAGE_DESC": block("""<meta name="description" content="本文介绍数据要素市场化的实践路径。" />"""),
    "HY_PAGE_KEYWORDS": block("""<meta name="keywords" content="数据要素,市场化" />"""),
    "HY_CAT_ID": block("""<div data-cat-id="a1b2c3d4-e5f6-7890-abcd-ef1234567890">"""),
    "HY_CAT_NAME": block("""<h1>产品中心</h1>"""),
    "HY_CAT_SLUG": block("""<!-- 常嵌在属性里，渲染后变成普通字符串 -->
<!-- _cat="product" -->"""),
    "HY_CAT_DESCRIPTION": block("""<p class="lead">面向政企的数据产品与解决方案</p>"""),
    "HY_CAT_COVER": block("""<img src="assets/covers/product.jpg" alt="产品中心" />"""),
    "HY_CAT_URL": block("""<a href="product/index.html">产品中心</a>"""),
    "HY_CAT_PARENT_NAME": block("""<span>上级：解决方案</span>
<!-- 顶级栏目时「上级：」后面为空 -->"""),
    "HY_CAT_META": block("""<p>面向政企的数据产品与解决方案</p>
<code></code>
<!-- _type 对不上字段时为空字符串 -->"""),
    "HY_CONTENT_TITLE": block("""<h1>数据要素市场化实践</h1>"""),
    "HY_CONTENT_BODY": block("""<article>
  <p>正文第一段。</p>
  <p>正文第二段（此处为编辑器里保存的 HTML，<strong>不转义</strong>）。</p>
</article>"""),
    "HY_CONTENT_URL": block("""<link rel="canonical" href="product/shuju.html" />"""),
    "HY_CONTENT_SUBTITLE": block("""<p class="subtitle">从确权到入表</p>"""),
    "HY_CONTENT_CAT_NAME": block("""<a href="product/index.html">产品中心</a>"""),
    "HY_CONTENT_CAT_URL": block("""<a href="product/index.html">产品中心</a>"""),
    "HY_CONTENT_DATE": block("""<time datetime="2026-08-01T09:00:00+08:00">2026-08-01T09:00:00+08:00</time>"""),
    "HY_CONTENT_DATE_SHORT": block("""<time>2026-08-01</time>"""),
    "HY_CONTENT_KEYWORDS": block("""<meta name="keywords" content="数据要素,确权" />"""),
    "HY_CONTENT_AUTHOR": block("""<span>作者：张三</span>"""),
    "HY_CONTENT_META": block("""<span>128 次阅读</span>"""),
    "HY_CONTENT_PREV": block("""<nav><a class="prev" href="product/qianyi.html">← 上一篇：数据确权路径</a></nav>
<!-- 没有上一篇时标签位置为空 -->"""),
    "HY_CONTENT_NEXT": block("""<nav><a class="next" href="product/rujie.html">下一篇：数据入表实践 →</a></nav>"""),
    "HY_CONTENT_PREV_URL / HY_CONTENT_NEXT_URL": block("""<a class="prev" href="product/qianyi.html">← 上一篇</a>
<a class="next" href="product/rujie.html">下一篇 →</a>
<!-- 从 prev/next 整块 HTML 里抽出的裸 href；没有上下篇时为空 -->"""),
    "HY_ITEM_ID": block("""<article id="post-11111111-2222-3333-4444-555555555555">"""),
    "HY_ITEM_TITLE": block("""<h3><a href="product/shuju.html">数据要素市场化实践</a></h3>"""),
    "HY_ITEM_URL": block("""<a href="product/shuju.html">阅读全文</a>"""),
    "HY_ITEM_SUMMARY": block("""<p>本文介绍数据要素市场化的实践路径。……</p>
<!-- truncate(120) 时超过 120 字会被截断 -->"""),
    "HY_ITEM_EXCERPT": block("""<p>本文介绍数据要素市场化的实践路径。</p>"""),
    "HY_ITEM_COVER": block("""<img src="assets/covers/shuju.jpg" alt="数据要素市场化实践" loading="lazy" />"""),
    "HY_ITEM_DATE": block("""<time>2026-08-01</time>"""),
    "HY_ITEM_DATE_YEAR": block("""<span class="year">2026</span>"""),
    "HY_ITEM_DATETIME": block("""<time datetime="2026-08-01T09:00:00+08:00">"""),
    "HY_ITEM_AUTHOR": block("""<span>张三</span>"""),
    "HY_ITEM_CAT_NAME / HY_ITEM_CAT_URL": block("""<a href="product/index.html">产品中心</a>"""),
    "HY_ITEM_TAGS": block("""<div class="tags"><a class="tag" href="/tag/ai.html">AI</a><a class="tag" href="/tag/data.html">数据要素</a></div>
<!-- 无标签时 <div class="tags"></div> 中间为空 -->"""),
    "HY_ITEM_HITS": block("""<span>128 阅读</span>"""),
    "HY_ITEM_META": block("""<span>shuju</span>"""),
    "HY_ITEM_BODY（别名）": block("""<div><p>列表循环内输出该条的 body HTML；详情页请优先用 HY_CONTENT_BODY。</p></div>"""),
    "HY_ITEM_PUBLISH_DATE（别名）": block("""<time>2026-08-01</time>
<!-- _format="YYYY" 时为 2026；YYYY.MM.DD 时为 2026.08.01 -->"""),
    "HY_CAT_ITEM_ID": block("""<li data-id="bbbbbbbb-cccc-dddd-eeee-ffffffffffff">"""),
    "HY_CAT_ITEM_NAME": block("""<a href="product/haishi/index.html">海石 AI 标签平台</a>"""),
    "HY_CAT_ITEM_SLUG": block("""<span>haishi</span>"""),
    "HY_CAT_ITEM_URL": block("""<a href="product/haishi/index.html">海石 AI 标签平台</a>"""),
    "HY_CAT_ITEM_COVER": block("""<img src="assets/covers/haishi.jpg" />"""),
    "HY_CAT_ITEM_DESCRIPTION": block("""<p>智能标签与分类</p>"""),
    "HY_CAT_ITEM_HAS_CHILDREN": block("""<!-- 标签本身输出 1 或空字符串，通常配合 HY_IF，而不是直接显示 -->
<!-- 有子栏目时条件为真，下面 li 会留下 -->
<li>海石 AI 标签平台</li>"""),
    "HY_CAT_ITEM_CHILD_COUNT": block("""<span>3 个子栏目</span>"""),
    "HY_SITE_CSS": block("""<link rel="stylesheet" href="assets/site.css">
    <link rel="stylesheet" href="assets/news-list.css">
<!-- 栏目子页深度+1 时 href 变为 ../assets/site.css -->"""),
    "HY_SITE_JS": block("""<script src="assets/app.js"></script>"""),
    "HY_ASSET_URL": block("""<link href="assets/site.css" rel="stylesheet" />
<img src="assets/logo.svg" />
<!-- 站点资源里没有该文件名时，href/src 变成空字符串 -->"""),
    "HY_MEDIA": block("""<img src="assets/media/photo.jpg" alt="" />
<!-- 媒体 ID 不存在时 src="" -->"""),
    "HY_CONTENTS_COUNT": block("""<p>共 36 篇文章</p>"""),
    "HY_CONTENTS_PAGINATION": block("""<nav class="pagination"><a class="prev" href="product/index.html">上一页</a><a href="product/index.html">1</a><span class="current" aria-current="page">2</span><a href="product/page-3.html">3</a><a class="next" href="product/page-3.html">下一页</a></nav>
<!-- 总条数不超过 _limit 时整段输出空，连 nav 都没有 -->"""),
    "HY_PAGINATION": block("""<!-- 与 HY_CONTENTS_PAGINATION 相同 -->
<nav class="pagination">…</nav>"""),
    "HY_RELATED_LIST": block("""<!-- 标签自己就会带 aside，模板里不必再套一层标题 -->
<aside class="related-reading"><h3>相关阅读</h3>
<ul class="related-list">
<li><a href="product/qianyi.html">数据确权路径</a></li>
<li><a href="product/rujie.html">数据入表实践</a></li>
</ul></aside>
<!-- 无相关文章时输出空字符串 -->"""),
    "HY_SITE_HERO": block("""<section class="hero">
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
<!-- 站点 settings.hero 无 title 时，section 内为空 -->"""),
    "HY_HOME_HERO": block("""<!-- 与 HY_SITE_HERO 完全相同 -->"""),
    "HY_SITE_STATS": block("""<section>
  <div class="stats-grid">
    <div class="stat"><div class="stat-value" data-count="120" data-suffix="+">0+</div><div class="stat-label">落地项目</div></div>
    <div class="stat"><div class="stat-value" data-count="30" data-suffix="">0</div><div class="stat-label">合作机构</div></div>
  </div>
</section>"""),
    "HY_SITE_PRODUCTS": block("""<section>
  <div class="products-grid">
    <div class="product-card"><div class="product-icon">◆</div><h3 class="product-name"><a href="product/haishi.html">海石平台</a></h3><p class="product-desc">智能标签</p></div>
  </div>
</section>"""),
    "HY_SITE_CTA": block("""<section>
  <div class="cta-inner">
    <h2 class="cta-title">预约演示</h2>
    <p class="cta-desc">了解如何落地数据要素。</p>
    <a class="btn btn-primary" href="contact/index.html">立即咨询 →</a>
  </div>
</section>"""),
    "HY_HOME_FEATURED": block("""<section>
<div class="featured-grid">
<article class="featured-card"><a href="product/shuju.html"><img src="assets/covers/shuju.jpg" alt="数据要素市场化实践" loading="lazy" /><h3>数据要素市场化实践</h3></a></article>
</div>
</section>"""),
    "HY_BREADCRUMB": block("""<nav><a href="index.html">首页</a> / <a href="product/index.html">产品中心</a> / 数据要素市场化实践</nav>
<!-- 实际 HTML 以发布时预渲染的 breadcrumb_html 为准 -->"""),
    "HY_MENU_ACTIVE": block("""<a href="/news/" class="nav-link active">新闻</a>
<!-- 当前路径不匹配时：class="nav-link"（active 前的空格也不会出现） -->"""),
    "HY_NAV": block("""<nav><!-- 等同 HY_SITE_MENU _location="header" 的预渲染菜单 HTML --></nav>"""),
    "HY_FOOTER": block("""<footer><!-- 等同 HY_SITE_MENU _location="footer" 的预渲染菜单 HTML --></footer>"""),
    "HY_CONTENTS": block("""<article>
    <h3><a href="product/shuju.html">数据要素市场化实践</a></h3>
    <p>本文介绍数据要素市场化的实践路径。</p>
  </article>
<article>
    <h3><a href="product/qianyi.html">数据确权路径</a></h3>
    <p>从登记到凭证。</p>
  </article>
<!-- 容器标签本身不生成 ul/div；你在容器里写什么结构，就重复多少遍 -->
<!-- 0 篇文章时容器位置为空，请紧跟 HY_CONTENTS_EMPTY -->"""),
    "HY_CONTENTS_EMPTY": block("""<p>暂无内容</p>
<!-- 上一轮 HY_CONTENTS 有结果时，这一段整段删掉（包括你写的 p） -->"""),
    "HY_CATS": block("""<li><a href="product/haishi/index.html">海石 AI 标签平台</a></li><li><a href="product/taitan/index.html">泰坦可信空间</a></li>
<!-- 同样只重复内部 HTML，不自动包 ul -->"""),
    "HY_IF": block("""<img src="assets/covers/shuju.jpg" />
<!-- 条件为假时，IF 内全部消失 -->"""),
    "HY_INCLUDE": block("""<!-- 替换为 partials/site-header.html 经同一套管线渲染后的 HTML -->
<header>霍因科技</header>"""),
    "HY_TEMPLATE": block("""<!-- 替换为 code=footer-corp 那份子模板渲染后的 HTML -->
<footer>© 2026 霍因科技</footer>
<!-- 找不到 code / 形成环时保留原标签或告警，以发布日志为准；可用 code 或 _code -->"""),
}


def main() -> None:
    text = MD.read_text(encoding="utf-8")
    lines = text.splitlines(keepends=True)
    out: list[str] = []
    i = 0
    n = 0
    while i < len(lines):
        line = lines[i]
        out.append(line)
        m = line.startswith("### ") and line[4:].strip()
        if m and m in RENDER:
            i += 1
            buf = []
            while i < len(lines):
                cur = lines[i]
                buf.append(cur)
                i += 1
                nxt = lines[i] if i < len(lines) else ""
                if cur.strip().startswith("|") and not nxt.strip().startswith("|"):
                    out.extend(buf)
                    already = MARKER in nxt or (
                        i < len(lines) and MARKER in lines[i]
                    )
                    # 跳过空行再看
                    j = i
                    while j < len(lines) and not lines[j].strip():
                        j += 1
                    if j < len(lines) and MARKER in lines[j]:
                        already = True
                    if not already:
                        out.append(RENDER[m])
                        n += 1
                    break
            continue
        i += 1
    MD.write_text("".join(out), encoding="utf-8")
    print(f"injected {n}")


if __name__ == "__main__":
    main()
