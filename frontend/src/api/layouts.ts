// Layouts API - 模板管理 (P3.6.1 + 2026-06-06 完善)
import { api } from './client';
import type { APIResponse } from '@/lib/utils';

export type LayoutScope = 'site' | 'category' | 'content' | 'home' | 'partial';
export type LayoutTemplateKind = 'page' | 'partial';

export interface LayoutListItem {
  id: string;
  site_id: string;
  scope: LayoutScope;
  code: string;
  name: string;
  is_default: boolean;
  is_active: boolean;
  version: number;
  template_kind: LayoutTemplateKind;
  parent_code: string | null;
  updated_at: string;
}

export interface Layout extends LayoutListItem {
  html: string;
  created_at: string;
}

export interface LayoutVersion {
  id: string;
  layout_id: string;
  version: number;
  change_note: string | null;
  author_id: string;
  created_at: string;
}

export interface LayoutValidateResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  tag_stats: Record<string, number>;
}

export interface LayoutPreviewResult {
  html: string;
  warnings: string[];
  errors: string[];
}

export interface ZipImportResult {
  assets_created: number;
  assets_overwritten: number;
  assets_skipped?: number;
  layouts: Array<{
    id: string;
    scope: LayoutScope;
    code: string;
    name: string;
    action: 'created' | 'overwritten' | 'reused' | 'skipped';
    version: number;
  }>;
  pages_classified: Array<{ path: string; scope: string }>;
  warnings: string[];
  ai_used: boolean;
}

export const layoutsApi = {
  // 列表 (按 site + scope) - 后端裸返 {items, total}
  // include_inactive=true 显示已禁用模板, 默认 false
  list: async (siteId: string, params?: { scope?: LayoutScope; q?: string; include_inactive?: boolean }): Promise<{ items: LayoutListItem[]; total: number }> => {
    const r = await api.get<{ items: LayoutListItem[]; total: number }>(
      `/sites/${siteId}/layouts`,
      { params },
    );
    return r.data.data!;
  },

  // 详情
  get: async (id: string): Promise<Layout> => {
    const r = await api.get<APIResponse<Layout>>(`/layouts/${id}`);
    return r.data.data!;
  },

  // 创建
  create: async (siteId: string, body: { scope: LayoutScope; code: string; name: string; html: string; is_default?: boolean; template_kind?: LayoutTemplateKind; parent_code?: string | null; change_note?: string }): Promise<Layout> => {
    const r = await api.post<APIResponse<Layout>>(`/sites/${siteId}/layouts`, body);
    return r.data.data!;
  },

  // 更新 (html 改才会 +1 version)
  update: async (id: string, body: { name?: string; html?: string; is_default?: boolean; template_kind?: LayoutTemplateKind; parent_code?: string | null; change_note?: string }): Promise<Layout> => {
    const r = await api.put<APIResponse<Layout>>(`/layouts/${id}`, body);
    if (!r.data.data) {
      throw new Error(r.data.message || '保存失败');
    }
    return r.data.data;
  },

  // 软删 (P3.7+ holy 反馈: 默认布局也能删, 传 force=true 跳过检查)
  remove: async (id: string, force = false): Promise<void> => {
    await api.delete(`/layouts/${id}`, { params: force ? { force: true } : undefined });
  },

  // P3.7.3: 查模板被哪些栏目 + 哪些文章引用 (刪除时弹窗展示 + 右侧栏展示)
  references: async (id: string): Promise<{
    is_default: boolean;
    scope: string;
    code: string;
    reference_count: number;
    references: Array<{ id: string; name: string }>;
    content_uses: Array<{
      category_id: string;
      category_name: string;
      content_count: number;
      recent_contents: Array<{ id: string; title: string }>;
      more_count: number;
    }>;
    total_content_count: number;
  }> => {
    const r = await api.get(`/layouts/${id}/references`);
    return r.data.data!;
  },

  // P3.7+: 启用/禁用 (PATCH 独立端点, 不用 PUT 整对象)
  toggleActive: async (id: string, isActive: boolean): Promise<Layout> => {
    const r = await api.patch<APIResponse<Layout>>(`/layouts/${id}/active`, { is_active: isActive });
    return r.data.data!;
  },

  // 回滚到指定 version
  rollback: async (id: string, targetVersion: number, changeNote?: string): Promise<Layout> => {
    const r = await api.post<APIResponse<Layout>>(`/layouts/${id}/rollback`, {
      target_version: targetVersion,
      change_note: changeNote,
    });
    return r.data.data!;
  },

  // 版本列表
  listVersions: async (id: string): Promise<{ items: LayoutVersion[]; total: number }> => {
    const r = await api.get<{ items: LayoutVersion[]; total: number }>(`/layouts/${id}/versions`);
    return r.data.data!;
  },

  // 预览 (传 html 用临时, 不传用当前)
  preview: async (id: string, html?: string): Promise<LayoutPreviewResult> => {
    const r = await api.post<APIResponse<LayoutPreviewResult>>(`/layouts/${id}/preview`, html ? { html } : { html: null });
    return r.data.data!;
  },

  // 校验标签
  validate: async (id: string, html?: string): Promise<LayoutValidateResult> => {
    const r = await api.post<APIResponse<LayoutValidateResult>>(`/layouts/${id}/validate`, html ? { html } : { html: null });
    return r.data.data!;
  },

  // 导入静态网站 ZIP：资源进站点资源，并生成 5 类 HY_ 模板
  importZip: async (siteId: string, file: File, useAi = true): Promise<ZipImportResult> => {
    const form = new FormData();
    form.append('file', file);
    form.append('use_ai', useAi ? 'true' : 'false');
    const r = await api.post<APIResponse<ZipImportResult>>(
      `/sites/${siteId}/layouts/import-zip`,
      form,
      { timeout: 120_000 },
    );
    if (!r.data.data) {
      throw new Error(r.data.message || '导入失败');
    }
    return r.data.data;
  },
};

// === HY_ 标签 cheatsheet (UI 内嵌) ===
// 依据: docs/18-布局系统与标签占位符.md §3
export const HY_TAGS = [
  // === 全局 (任意 scope 都可用) ===
  { code: 'HY_SITE_NAME', scope: 'all', desc: '站点名称', example: '<h1><HY_SITE_NAME /></h1>' },
  { code: 'HY_SITE_DESCRIPTION', scope: 'all', desc: '站点描述', example: '<p><HY_SITE_DESCRIPTION /></p>' },
  { code: 'HY_SITE_LOGO', scope: 'all', desc: '站点 logo URL', example: '<img src="<HY_SITE_LOGO />" />' },
  { code: 'HY_SITE_URL', scope: 'all', desc: '站点主域名', example: '<a href="<HY_SITE_URL />">首页</a>' },
  { code: 'HY_PAGE_TITLE', scope: 'all', desc: '当前页 title', example: '<title><HY_PAGE_TITLE /></title>' },
  { code: 'HY_BREADCRUMB', scope: 'all', desc: '面包屑 (按 context 自动)', example: '<nav><HY_BREADCRUMB _separator=" / " /></nav>' },
  { code: 'HY_MEDIA', scope: 'all', desc: '媒体库图片 URL (需 _id)', example: '<img src="<HY_MEDIA _id="uuid" />" alt="" />' },
  { code: 'HY_ASSET_URL', scope: 'all', desc: '站点资源 URL (需 _name)', example: '<link href="<HY_ASSET_URL _name="site.css" />" />' },
  { code: 'HY_NOW', scope: 'all', desc: '构建时间 ISO', example: '<time><HY_NOW /></time>' },
  { code: 'HY_BUILD_ID', scope: 'all', desc: '发布 build UUID', example: '<meta name="build-id" content="<HY_BUILD_ID />" />' },
  { code: 'HY_SITE_ICP', scope: 'all', desc: '备案号', example: '<footer><HY_SITE_ICP /></footer>' },
  { code: 'HY_SITE_COPYRIGHT', scope: 'all', desc: '版权声明', example: '<footer><HY_SITE_COPYRIGHT /></footer>' },
  { code: 'HY_SITE_SLOGAN', scope: 'all', desc: '站点口号', example: '<p><HY_SITE_SLOGAN /></p>' },
  { code: 'HY_PAGE_DESC', scope: 'all', desc: '当前页 description', example: '<meta name="description" content="<HY_PAGE_DESC />" />' },
  { code: 'HY_PAGE_URL', scope: 'all', desc: '当前页 canonical URL', example: '<link rel="canonical" href="<HY_PAGE_URL />" />' },

  // === Category scope ===
  { code: 'HY_CAT_NAME', scope: 'category', desc: '栏目名', example: '<h1><HY_CAT_NAME /></h1>' },
  { code: 'HY_CAT_URL', scope: 'category', desc: '栏目链接', example: '<a href="<HY_CAT_URL />"><HY_CAT_NAME /></a>' },
  { code: 'HY_CAT_DESCRIPTION', scope: 'category', desc: '栏目描述', example: '<p><HY_CAT_DESCRIPTION /></p>' },
  { code: 'HY_CAT_COVER', scope: 'category', desc: '栏目封面图', example: '<img src="<HY_CAT_COVER />" />' },
  { code: 'HY_CONTENTS', scope: 'category', desc: '内容循环；_banner/_featured/_include_children/_has_cover/_has_banner/_limit_per_cat', example: '<HY_CONTENTS _banner="true" _order="newest">...</HY_CONTENTS>' },
  { code: 'HY_CONTENTS_EMPTY', scope: 'category', desc: '列表为空时显示', example: '<HY_CONTENTS_EMPTY><p>暂无内容</p></HY_CONTENTS_EMPTY>' },
  { code: 'HY_CONTENTS_PAGINATION', scope: 'category', desc: '分页器 (HY_PAGINATION 别名)', example: '<HY_CONTENTS_PAGINATION _show_numbers="true" />' },
  { code: 'HY_PAGINATION', scope: 'category', desc: '分页器别名', example: '<HY_PAGINATION _show_numbers="true" />' },
  { code: 'HY_CONTENTS_COUNT', scope: 'category', desc: '列表总数（可带 _include_children）', example: '<span>共 <HY_CONTENTS_COUNT _include_children="true" /> 篇</span>' },
  { code: 'HY_CATS', scope: 'category', desc: '栏目循环；_type=children|siblings|root', example: '<HY_CATS _type="siblings"><a class="<HY_CAT_ITEM_CURRENT_CLASS />" href="<HY_CAT_ITEM_URL />"><HY_CAT_ITEM_NAME /></a></HY_CATS>' },
  { code: 'HY_CAT_ITEM_CURRENT_CLASS', scope: 'category', desc: '当前栏目 class（is-current）', example: '<a class="<HY_CAT_ITEM_CURRENT_CLASS />">' },

  // === Content scope (详情页) ===
  { code: 'HY_CONTENT_TITLE', scope: 'content', desc: '文章标题', example: '<h1><HY_CONTENT_TITLE /></h1>' },
  { code: 'HY_CONTENT_SUMMARY', scope: 'content', desc: '文章摘要', example: '<p><HY_CONTENT_SUMMARY /></p>' },
  { code: 'HY_CONTENT_BODY', scope: 'content', desc: '正文 HTML', example: '<article><HY_CONTENT_BODY /></article>' },
  { code: 'HY_CONTENT_DATE_SHORT', scope: 'content', desc: '发布日期 YYYY-MM-DD', example: '<time datetime="<HY_CONTENT_DATE_SHORT />"><HY_CONTENT_PUBLISH_DATE _format="YYYY.MM.DD" /></time>' },
  { code: 'HY_CONTENT_PUBLISH_DATE', scope: 'content', desc: '发布日期 (_format)', example: '<HY_CONTENT_PUBLISH_DATE _format="YYYY.MM.DD" />' },
  { code: 'HY_CONTENT_READ_TIME', scope: 'content', desc: '阅读时长（按正文估算）', example: '<span><HY_CONTENT_READ_TIME /></span>' },
  { code: 'HY_CONTENT_AUTHOR', scope: 'content', desc: '作者名', example: '<span><HY_CONTENT_AUTHOR /></span>' },
  { code: 'HY_CONTENT_PREV_URL', scope: 'content', desc: '上一篇 URL', example: '<a href="<HY_CONTENT_PREV_URL />">上一篇</a>' },
  { code: 'HY_CONTENT_NEXT_URL', scope: 'content', desc: '下一篇 URL', example: '<a href="<HY_CONTENT_NEXT_URL />">下一篇</a>' },
  { code: 'HY_RELATED_LIST', scope: 'content', desc: '同栏目相关文章', example: '<HY_RELATED_LIST _limit="5" />' },
  { code: 'HY_ITEM_BODY', scope: 'content', desc: '正文别名 (同 HY_CONTENT_BODY)', example: '<article><HY_ITEM_BODY /></article>' },
  { code: 'HY_ITEM_PUBLISH_DATE', scope: 'content', desc: '发布日期 (_format)', example: '<HY_ITEM_PUBLISH_DATE _format="YYYY-MM-DD" />' },

  // === HY_CONTENTS 循环内 item 标签 ===
  { code: 'HY_ITEM_TITLE', scope: 'category', desc: '列表项标题', example: '<a href="<HY_ITEM_URL />"><HY_ITEM_TITLE /></a>' },
  { code: 'HY_ITEM_URL', scope: 'category', desc: '列表项链接', example: '<a href="<HY_ITEM_URL />">查看</a>' },
  { code: 'HY_ITEM_DATE', scope: 'category', desc: '列表项日期', example: '<time><HY_ITEM_DATE /></time>' },
  { code: 'HY_ITEM_SUMMARY', scope: 'category', desc: '列表项摘要', example: '<p><HY_ITEM_SUMMARY /></p>' },
  { code: 'HY_ITEM_COVER', scope: 'category', desc: '列表项缩略图', example: '<img src="<HY_ITEM_COVER />" />' },
  { code: 'HY_ITEM_BANNER', scope: 'category', desc: '列表项 Banner 大图', example: '<img src="<HY_ITEM_BANNER />" />' },
  { code: 'HY_ITEM_AUTHOR', scope: 'category', desc: '列表项作者', example: '<span><HY_ITEM_AUTHOR /></span>' },
  { code: 'HY_ITEM_TAGS', scope: 'category', desc: '列表项标签 HTML', example: '<HY_ITEM_TAGS />' },

  // === Home scope ===
  { code: 'HY_SITE_HERO', scope: 'home', desc: '首页 Hero 块', example: '<section><HY_SITE_HERO /></section>' },
  { code: 'HY_HOME_HERO', scope: 'home', desc: 'Hero 别名', example: '<section><HY_HOME_HERO /></section>' },
  { code: 'HY_HOME_FEATURED', scope: 'home', desc: '精选内容 grid', example: '<HY_HOME_FEATURED _limit="6" />' },
  { code: 'HY_SITE_STATS', scope: 'home', desc: '数字指标块', example: '<section><HY_SITE_STATS /></section>' },
  { code: 'HY_SITE_PRODUCTS', scope: 'home', desc: '产品展示块', example: '<section><HY_SITE_PRODUCTS /></section>' },
  { code: 'HY_SITE_CTA', scope: 'home', desc: '行动号召块', example: '<section><HY_SITE_CTA /></section>' },

  // === Site scope ===
  { code: 'HY_SITE_CSS', scope: 'site', desc: '引入站点 CSS', example: '<HY_SITE_CSS _include="style.css" />' },
  { code: 'HY_SITE_JS', scope: 'site', desc: '引入站点 JS', example: '<HY_SITE_JS _include="app.js" />' },
  { code: 'HY_MENU_ACTIVE', scope: 'site', desc: '导航选中态 class', example: '<a class="nav-link<HY_MENU_ACTIVE _match="/news/" />">新闻</a>' },
  { code: 'HY_NAV', scope: 'site', desc: '顶栏导航别名', example: '<nav><HY_NAV /></nav>' },
  { code: 'HY_FOOTER', scope: 'site', desc: '页脚导航别名', example: '<footer><HY_FOOTER /></footer>' },
  { code: 'HY_IF', scope: 'all', desc: '条件容器', example: '<HY_IF _condition="content.has_cover">...</HY_IF>' },
  { code: 'HY_INCLUDE', scope: 'all', desc: '引入 partial 片段', example: '<HY_INCLUDE _file="header.html" />' },
  { code: 'HY_TEMPLATE', scope: 'all', desc: '引用子模板', example: '<HY_TEMPLATE code="header-v1" />' },
];

export const CONTENT_TAGS_ALSO_HOME_SCOPE = ['HY_CONTENTS']; // HY_CONTENTS 在 home scope 也能用

// HY_ 容器标签白名单: 校验时允许 </HY_xxx> 闭合, autocomplete 插入时走容器格式
// 跟 backend CONTAINER_TAGS (layout_renderer.py) 对齐: HY_CONTENTS/HY_CATS/HY_IF/HY_INCLUDE
// HY_TEMPLATE 不在内 — example 是 <HY_TEMPLATE code="x" /> 自闭合 (后端 regex 也不要求闭合)
export const CONTAINER_HY_CODES = new Set(['HY_CONTENTS', 'HY_CATS', 'HY_IF', 'HY_INCLUDE', 'HY_CONTENTS_EMPTY']);

export const SCOPE_LABELS: Record<LayoutScope, string> = {
  site: '站点布局',
  category: '栏目布局',
  content: '详情布局',
  home: '首页布局',
  partial: '子模板',
};

// P3.7: 模板目录顺序 (左栏树顺序) + 5 个固定目录
export const SCOPE_ORDER: LayoutScope[] = ['site', 'home', 'category', 'content', 'partial'];

/** 模板 code 在 UI 上的说明（default = 站点兑底） */
export function layoutCodeHint(code: string, scope: LayoutScope): string {
  if (code === 'default') {
    if (scope === 'category') return '站点兑底：栏目未指定 template 或 template=default 时使用';
    if (scope === 'content') return '站点兑底：文章未指定 template 或 template=default 时使用';
    if (scope === 'home') return '站点默认首页模板';
    if (scope === 'site') return '站点默认外壳模板';
    return '站点默认模板';
  }
  return `栏目分组 code=${code}（栏目/文章的 template 字段指向此 code）`;
}

// === HY_ 验证 (P3.6.2 前端实时 lint) ===
export interface HyValidationIssue {
  level: 'error' | 'warning';
  message: string;
  index: number;
  match: string;
}

/** 校验 HTML 中的 HY_ 标签 (供 HtmlEditor 实时调用) */
export function validateHyTags(html: string): HyValidationIssue[] {
  const issues: HyValidationIssue[] = [];
  // 抽取所有 HY_ code → 合并 HY_TAGS
  const codes = new Set<string>();
  HY_TAGS.forEach((t) => codes.add(t.code.toUpperCase()));

  // 业务属性白名单: code 是 HY_TEMPLATE 的必需属性, 不是 HTML 原生, 不报 warning
  const BUSINESS_ATTRS = new Set(['code', 'id', 'class', 'style', 'data-id']);

  // 1) 开标签
  const openRe = /<HY_([A-Z_]+)((?:\s+[a-zA-Z_][\w-]*="[^"]*")*)\s*(\/?)>/gi;
  let m: RegExpExecArray | null;
  while ((m = openRe.exec(html))) {
    const code = `HY_${m[1].toUpperCase()}`;
    const attrsStr = m[2] || '';
    const selfClose = m[3] === '/';
    const matchStart = m.index;

    if (!codes.has(code)) {
      issues.push({ level: 'error', message: `未知 HY_ 标签 ${code} (不在白名单)`, index: matchStart, match: m[0] });
    }
    // 2) 属性 _ 前缀 (code 等业务属性豁免)
    const attrRe = /\s([a-zA-Z_][a-zA-Z0-9_-]*)=/g;
    let am: RegExpExecArray | null;
    while ((am = attrRe.exec(attrsStr))) {
      if (!am[1].startsWith('_') && !BUSINESS_ATTRS.has(am[1])) {
        issues.push({ level: 'warning', message: `属性 ${am[1]} 应以 _ 开头 (避免与 HTML 原生属性冲突)`, index: matchStart, match: am[0].trim() });
      }
    }
    // 3) HY_CONTENTS 误写成 </HY_CONTENTS> 的检查 (4) 里做
  }

  // 4) 自闭合标签被写成 </HY_xxx> 形式
  for (const t of HY_TAGS) {
    // 容器标签允许闭合 (跟后端 CONTAINER_TAGS 对齐), 不报"自闭合"误警
    if (CONTAINER_HY_CODES.has(t.code)) continue;
    const re = new RegExp(`<\\/${t.code}\\s*>`, 'gi');
    if (re.test(html)) {
      issues.push({ level: 'warning', message: `${t.code} 是自闭合标签, 不应有 </${t.code}> 闭合`, index: 0, match: t.code });
    }
  }

  return issues;
}
