# AI-CMS 架构图集 (DrawIO 版)

> **版本**: v3.9.5+ (2026-06-12)  
> **配套**: `../19-架构图集.md` (Mermaid 版) — 两版内容一致  
> **覆盖**: 文档导入 (#12096) + 静态发布图片真静态化 (#137) + LLMRequest 修

## 5 张图

| # | 文件 | 类型 | 泳道 | 重点 |
|---|---|---|---|---|
| 01 | `01-产品架构图.drawio` | graph TB | — | 5 层: 入口/应用/数据/资产/AI |
| 02 | `02-技术架构图.drawio` | graph LR | — | 6 层: Client/Edge/App/Worker/Storage/AI + Build |
| 03 | `03-数据库架构图(ER).drawio` | entity-relationship | — | 31 张表 + 主外键 |
| 04 | `04-数据血缘图.drawio` | flowchart LR | — | 输入→MinIO→解析→DB→发布→产物 |
| 05 | `05-文档导入多泳道序列图.drawio` | sequence | 6 泳道 | 运营/前端/API/Worker/MinIO/LLM |

## 打开方式

### 方式 1: DrawIO Desktop (推荐)
- 下载: https://github.com/jgraph/drawio-desktop/releases
- macOS: `brew install --cask drawio`
- 直接双击 `.drawio` 文件即可

### 方式 2: DrawIO 官网编辑器
- 打开: https://app.diagrams.net
- File → Open from Device → 选 `.drawio` 文件

### 方式 3: VS Code 插件
- 装 "Draw.io Integration" 扩展
- 在 VS Code 里直接预览/编辑

### 方式 4: 导出 PNG/SVG (PPT/Notion 友好)
- DrawIO 里: File → Export as → PNG / SVG / PDF
- 或命令行: `drawio --export --format png 01-产品架构图.drawio`

## P3.9.5 关键改进 (在图里都标了)

1. **新增 5 张 P3 表**:
   - `ai_run_steps` (执行步骤跟踪)
   - `ai_usage_daily` (用户每日用量)
   - `media_tags` + `media_tag_links` (媒体标签)
   - `site_assets` (站点 CSS/JS 资源)

2. **`ai_runs.task_type` 18 个值** (含 3 个 import_*):
   - `rewrite / expand / shorten / polish / translate / draft`
   - `audit / theme / image / optimize_design / responsive / a11y / seo`
   - `format_html / extract_assets`
   - **`import_docx / import_pdf / import_paste_html`** ← P3.9.4+

3. **`_inline_content_media()` 静态发布图片真静态化** (P3.9.5+):
   - 扫 `*.html` 抓 `<img src="/media/...">`
   - `boto3 get_object` 拉 MinIO → `public/assets/{basename}`
   - 改写 src 为相对路径
   - 产物**离线可看**

4. **`provider.stream()` 替代 `LLMRequest`**:
   - LLMRequest 类不存在 (P3.9.4 写错, 静默被 except 吞掉)
   - 改: 跟 `_text_transform.py` 一样用 `provider.stream(messages, model, temperature, max_tokens)`
   - 累计 token + cost

## 文件大小

```
01-产品架构图.drawio              14K
02-技术架构图.drawio              12K
03-数据库架构图(ER).drawio        27K
04-数据血缘图.drawio              18K
05-文档导入多泳道序列图.drawio    16K
─────────────────────────────────
总计                              87K
```

## 与 Mermaid 版对比

| 维度 | Mermaid 版 | DrawIO 版 |
|---|---|---|
| 文件 | `../19-架构图集.md` | `*.drawio` |
| 编辑 | 改 Markdown | GUI 拖拽 |
| 渲染 | GitHub/Typora 自动 | DrawIO/VSCode 插件 |
| 导出 | 不便 (要 pandoc) | 一键 PNG/SVG/PDF |
| 协作 | git diff 不友好 | 改 XML 也可 diff |
| 大图 | 100+ 节点会乱 | 自由排版, 性能好 |
| **使用场景** | 文档内嵌 | PPT/Notion/团队评审 |
