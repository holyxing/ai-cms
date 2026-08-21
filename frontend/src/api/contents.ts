import { api } from './client';
import type { APIResponse } from '@/lib/utils';

export type ContentStatus = 'draft' | 'pending' | 'published' | 'scheduled' | 'archived';

export interface ContentListItem {
  id: string;
  site_id: string;
  author_id: string;
  author_name: string | null;
  title: string;
  subtitle: string | null;  // P3.5.2
  slug: string;
  excerpt: string | null;
  // P3.6.1: 缩略图（列表卡片）
  cover_image?: string | null;
  /** Banner 大图（栏目头条轮播） */
  banner_image?: string | null;
  /** 头条：进入栏目 banner 轮播 */
  is_featured?: boolean;
  status: ContentStatus;
  published_at: string | null;
  scheduled_at: string | null;
  taxonomy_ids: string[];
  primary_taxonomy_id: string | null;
  // P2.7
  category_id?: string | null;
  // P3.9.1+ (holy 反馈 #11279 续): 副本溯源
  is_copy_of?: string | null;
  view_count: number;
  created_at: string;
  updated_at: string;
}

export interface Content extends ContentListItem {
  body: string;
}

export interface ContentVersion {
  id: string;
  content_id: string;
  version_num: number;
  title: string;
  body: string;
  excerpt: string | null;
  author_id: string;
  author_name: string | null;
  is_auto_save: boolean;
  created_at: string;
}

export interface ContentCreate {
  title: string;
  subtitle?: string;  // P3.5.2
  slug: string;
  body?: string;
  excerpt?: string;
  // P3.6.1
  cover_image?: string | null;
  banner_image?: string | null;
  is_featured?: boolean;
  status?: ContentStatus;
  taxonomy_ids?: string[];
  primary_taxonomy_id?: string | null;
  // P2.7
  category_id?: string | null;
}

export interface ContentUpdate {
  title?: string;
  subtitle?: string;  // P3.5.2
  slug?: string;
  body?: string;
  excerpt?: string;
  // P3.6.1
  cover_image?: string | null;
  banner_image?: string | null;
  is_featured?: boolean;
  status?: ContentStatus;
  taxonomy_ids?: string[];
  primary_taxonomy_id?: string | null;
  // P2.7
  category_id?: string | null;
  // P3.9.1+ (holy 反馈 #11279 续): 多选栏目 = 后端复制多份副本
  category_ids?: string[];
}

export const contentsApi = {
  async list(
    siteId: string,
    opts: {
      status?: ContentStatus;
      taxonomy_id?: string;
      category_id?: string;  // P2.7
      q?: string;
      no_cover?: boolean;
      no_tags?: boolean;
      stale_days?: number;
      page?: number;
      page_size?: number;
    } = {},
  ) {
    const params = new URLSearchParams();
    if (opts.status) params.set('status', opts.status);
    if (opts.taxonomy_id) params.set('taxonomy_id', opts.taxonomy_id);
    if (opts.category_id) params.set('category_id', opts.category_id);
    if (opts.q) params.set('q', opts.q);
    if (opts.no_cover) params.set('no_cover', '1');
    if (opts.no_tags) params.set('no_tags', '1');
    if (opts.stale_days) params.set('stale_days', String(opts.stale_days));
    if (opts.page) params.set('page', String(opts.page));
    if (opts.page_size) params.set('page_size', String(opts.page_size));
    const qs = params.toString();
    const r = await api.get<APIResponse<{ items: ContentListItem[]; total: number; page: number; page_size: number }>>(
      `/sites/${siteId}/contents${qs ? '?' + qs : ''}`,
    );
    return r.data.data!;
  },

  async get(siteId: string, contentId: string) {
    const r = await api.get<APIResponse<Content>>(`/sites/${siteId}/contents/${contentId}`);
    return r.data.data!;
  },

  async create(siteId: string, body: ContentCreate) {
    const r = await api.post<APIResponse<Content>>(`/sites/${siteId}/contents`, body);
    const data = r.data.data;
    if (!data?.id) {
      throw new Error(r.data.message || '创建失败');
    }
    return data;
  },

  async update(siteId: string, contentId: string, body: ContentUpdate) {
    const r = await api.patch<{ code?: number; message?: string; data?: unknown }>(
      `/sites/${siteId}/contents/${contentId}`,
      body,
    );
    // axios 拦截器对 4xx 不抛错，这里必须显式判断，否则会误走 onSuccess「已保存」
    const status = (r as { status?: number }).status;
    const code = r.data?.code;
    if ((typeof status === 'number' && status >= 400) || (typeof code === 'number' && code !== 0)) {
      throw new Error(r.data?.message || '保存失败');
    }
  },

  async remove(siteId: string, contentId: string) {
    await api.delete(`/sites/${siteId}/contents/${contentId}`);
  },

  async listVersions(siteId: string, contentId: string) {
    const r = await api.get<APIResponse<ContentVersion[]>>(
      `/sites/${siteId}/contents/${contentId}/versions`,
    );
    return r.data.data!;
  },

  async publish(siteId: string, contentId: string) {
    const r = await api.post<APIResponse<{ id: string; status: ContentStatus; published_at: string | null }>>(
      `/sites/${siteId}/contents/${contentId}/publish`,
    );
    return r.data.data!;
  },

  /** 取消发布 (published → draft), 走 PATCH status */
  async unpublish(siteId: string, contentId: string) {
    const r = await api.patch<APIResponse<{ id: string; status: ContentStatus }>>(
      `/sites/${siteId}/contents/${contentId}`,
      { status: 'draft' },
    );
    return r.data.data!;
  },

  /** 触发文章级静态部署 (P3.6.1+, 重 build 该文章详情页 + 所属栏目页) */
  async publishStatic(siteId: string, contentId: string, opts?: { force?: boolean }) {
    const r = await api.post<APIResponse<{ id: string; status: string }>>(
      `/sites/${siteId}/contents/${contentId}/static-publish`,
      { force: opts?.force ?? false },
    );
    return r.data.data!;
  },

  /** 实时预览 HTML（POST 当前编辑器正文；走 JWT，Tab 用 srcDoc） */
  async previewHtml(siteId: string, contentId: string, body: string) {
    const r = await api.post<string>(
      `/sites/${siteId}/contents/${contentId}/preview-html`,
      { body },
      { responseType: 'text', transformResponse: [(data) => data] },
    );
    return r.data;
  },

  /** 新窗预览 URL（顶层打开，带 access_token query） */
  previewHtmlUrl(siteId: string, contentId: string, accessToken: string) {
    const q = new URLSearchParams({ access_token: accessToken });
    return `/sites/${siteId}/contents/${contentId}/preview-html?${q.toString()}`;
  },

  // === 状态机专用端点 (P3.5) ===
  async archive(siteId: string, contentId: string) {
    await api.post(`/sites/${siteId}/contents/${contentId}/archive`);
  },

  async submit(siteId: string, contentId: string) {
    // draft → pending (提交审)
    await api.patch(`/sites/${siteId}/contents/${contentId}`, { status: 'pending' });
  },

  async schedule(siteId: string, contentId: string, scheduledAt: string) {
    // 任意状态 → scheduled (需 scheduled_at)
    await api.patch(`/sites/${siteId}/contents/${contentId}`, {
      status: 'scheduled', scheduled_at: scheduledAt,
    });
  },

  // === 回收站 (P3.5) ===
  async listTrash(
    siteId: string,
    opts: { page?: number; page_size?: number } = {},
  ) {
    const params = new URLSearchParams();
    if (opts.page) params.set('page', String(opts.page));
    if (opts.page_size) params.set('page_size', String(opts.page_size));
    const qs = params.toString();
    const r = await api.get<APIResponse<{ items: ContentListItem[]; total: number; page: number; page_size: number }>>(
      `/sites/${siteId}/contents/trash${qs ? '?' + qs : ''}`,
    );
    return r.data.data!;
  },

  async restore(siteId: string, contentId: string) {
    await api.post(`/sites/${siteId}/contents/${contentId}/restore`);
  },

  async permanentDelete(siteId: string, contentId: string) {
    await api.delete(`/sites/${siteId}/contents/${contentId}/permanent`);
  },

  /** 服务端代拉外链文本（HTML/CSS/JS），绕过 CORS */
  async fetchRemote(siteId: string, url: string) {
    const r = await api.post<APIResponse<{
      url: string;
      final_url: string;
      content_type: string;
      text: string;
    }>>(`/sites/${siteId}/contents/fetch-remote`, { url });
    if (!r.data.data) {
      throw new Error(r.data.message || '拉取失败');
    }
    return r.data.data;
  },

  // === P6.2 #16: 批量动作 ===
  async batch(
    siteId: string,
    action: 'delete' | 'archive' | 'publish' | 'restore' | 'permanent',
    contentIds: string[],
  ) {
    const r = await api.post<APIResponse<{
      results: Array<{ content_id: string; success: boolean; error?: string; noop?: boolean }>;
      total: number;
      succeeded: number;
      failed: number;
    }>>(`/sites/${siteId}/contents/batch`, {
      action,
      content_ids: contentIds,
    });
    if (!r.data.data) {
      throw new Error(r.data.message || '批量操作失败');
    }
    return r.data.data;
  },
};
