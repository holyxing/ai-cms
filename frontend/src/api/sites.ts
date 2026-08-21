import { api } from './client';
import type { APIResponse, Paginated } from '@/lib/utils';

export interface SiteListItem {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  logo_url: string | null;
  status: 'active' | 'archived';
  domain_count?: number;  // P5: 列表里只返数量, 详情才返完整
  publish_status?: 'never_published' | 'publishing' | 'published' | 'failed' | 'out_sync';  // P2.6
  // P3.6+: 聚合统计 (后端在 list endpoint 通过 model_dump 注入, 前端 SiteListItem 加 ?)
  content_count?: number;
  category_count?: number;
  layout_count?: number;
  media_count?: number;
  deployment_count?: number;
  asset_count?: number;  // P3.6.4: 站点资源
  created_at: string;
  updated_at: string;
}

export interface Site extends SiteListItem {
  owner_id: string;
  settings: Record<string, unknown>;
  domains?: SiteDomain[];
}

export interface SiteDomain {
  id: string;
  site_id: string;
  domain: string;
  type: 'primary' | 'alias' | 'preview';
  ssl_status: 'pending' | 'active' | 'failed';
  verified_at: string | null;
  created_at: string;
}

export interface SiteCreatePayload {
  slug: string;
  name: string;
  description?: string;
  logo_url?: string;
  settings?: Record<string, unknown>;
}

export interface SiteUpdatePayload {
  slug?: string;  // P5: 可改 slug (URL 标识, 需谨慎)
  name?: string;
  description?: string;
  logo_url?: string | null;  // P5: null = 清空
  status?: 'active' | 'archived';
  settings?: Record<string, unknown>;
}

export interface SiteListParams {
  page?: number;
  page_size?: number;
  q?: string;
  status?: 'active' | 'archived';
}

export const sitesApi = {
  async list(params: SiteListParams = {}) {
    const r = await api.get<APIResponse<Paginated<SiteListItem>>>('/sites', { params });
    return r.data.data!;
  },

  async get(id: string, opts?: { skipToast?: boolean }) {
    const r = await api.get<APIResponse<Site>>(`/sites/${id}`, { _skipToast: opts?.skipToast } as any);
    return r.data.data!;
  },

  async create(payload: SiteCreatePayload) {
    const r = await api.post<APIResponse<Site>>('/sites', payload);
    return r.data.data!;
  },

  async update(id: string, payload: SiteUpdatePayload) {
    const r = await api.patch<APIResponse<Site>>(`/sites/${id}`, payload);
    return r.data.data!;
  },

  async delete(id: string) {
    await api.delete(`/sites/${id}`);
  },

  async addDomain(siteId: string, domain: string, type: 'primary' | 'alias' | 'preview' = 'primary') {
    const r = await api.post<APIResponse<SiteDomain>>(`/sites/${siteId}/domains`, {
      domain,
      type,
    });
    return r.data.data!;
  },

  async updateDomain(
    siteId: string,
    domainId: string,
    payload: { domain?: string; type?: 'primary' | 'alias' | 'preview' },
  ) {
    const r = await api.patch<APIResponse<SiteDomain>>(
      `/sites/${siteId}/domains/${domainId}`,
      payload,
    );
    return r.data.data!;
  },

  async removeDomain(siteId: string, domainId: string) {
    await api.delete(`/sites/${siteId}/domains/${domainId}`);
  },

  // === 首页块配置 (P3.6.5+) ===
  // 拿/改 site.settings.hero / stats / products / cta
  // 模板用 <HY_SITE_HERO /> 等标签读
  async getBlocks(siteId: string): Promise<Record<string, any>> {
    const r = await api.get<APIResponse<Record<string, any>>>(`/sites/${siteId}/blocks`);
    return r.data.data!;
  },

  async updateBlock(
    siteId: string,
    name: 'hero' | 'stats' | 'products' | 'cta',
    content: any,
  ): Promise<any> {
    const r = await api.put<APIResponse<any>>(
      `/sites/${siteId}/blocks/${name}`,
      { content },
    );
    return r.data.data!;
  },

  // === P3.7: 模板目录名称 (可自定义, 存 site.settings) ===
  async getTemplateScopeLabels(siteId: string): Promise<Record<string, string>> {
    const r = await api.get<APIResponse<Record<string, string>>>(
      `/sites/${siteId}/template-scope-labels`,
    );
    return r.data.data!;
  },

  async updateTemplateScopeLabels(
    siteId: string,
    labels: Partial<Record<'site' | 'home' | 'category' | 'content' | 'partial', string>>,
  ): Promise<Record<string, string>> {
    const r = await api.put<APIResponse<Record<string, string>>>(
      `/sites/${siteId}/template-scope-labels`,
      labels,
    );
    return r.data.data!;
  },

  // === 回收站 (super_admin only) ===
  async listRecycleBin(params: { page?: number; page_size?: number; q?: string } = {}) {
    const r = await api.get<APIResponse<Paginated<SiteListItem>>>('/sites/recycle-bin/list', {
      params,
    });
    return r.data.data!;
  },

  async restore(id: string) {
    const r = await api.post<APIResponse<Site>>(`/sites/${id}/restore`);
    return r.data.data!;
  },

  async permanentDelete(id: string) {
    await api.delete(`/sites/${id}/permanent`);
  },

  // === P6.2 #16: 批量动作 ===
  async batch(
    action: 'delete' | 'restore',
    siteIds: string[],
  ) {
    const r = await api.post<APIResponse<{
      results: Array<{ site_id: string; success: boolean; error?: string }>;
      total: number;
      succeeded: number;
      failed: number;
    }>>('/sites/batch', {
      action,
      site_ids: siteIds,
    });
    return r.data.data!;
  },
};
