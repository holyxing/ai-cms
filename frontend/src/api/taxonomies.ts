import { api } from './client';
import type { APIResponse } from '@/lib/utils';

export type TaxonomyType = 'category' | 'tag';

export interface Taxonomy {
  id: string;
  site_id: string;
  parent_id: string | null;
  name: string;
  slug: string;
  type: TaxonomyType;
  path: string;
  description: string | null;
  order_num: number;
  seo: Record<string, any>;
  created_at: string;
  updated_at: string;
  children_count?: number;
}

export interface TaxonomyTreeNode extends Taxonomy {
  depth: number;
  children: TaxonomyTreeNode[];
}

export interface TaxonomyCreate {
  name: string;
  slug: string;
  type?: TaxonomyType;
  parent_id?: string | null;
  description?: string;
}

export interface TaxonomyUpdate {
  name?: string;
  slug?: string;
  description?: string;
  parent_id?: string | null;
  order_num?: number;
  seo?: Record<string, any>;
}

export const taxonomiesApi = {
  async list(siteId: string, opts: { type?: TaxonomyType; tree?: boolean } = {}) {
    const params = new URLSearchParams();
    if (opts.type) params.set('type', opts.type);
    if (opts.tree) params.set('tree', 'true');
    const qs = params.toString();
    // 后端返 {items, total, page, page_size} (分页格式)
    // tree=true 时 items 元素带 children/depth (TaxonomyTreeNode)
    // 返 items 数组, 强转以让 tree=true 时仍保留 children/depth
    const r = await api.get<APIResponse<{ items: Taxonomy[]; total: number; page: number; page_size: number }>>(
      `/sites/${siteId}/taxonomies${qs ? '?' + qs : ''}`,
    );
    return r.data.data!.items as (Taxonomy & { children?: TaxonomyTreeNode[]; depth?: number })[];
  },

  async get(siteId: string, taxId: string) {
    const r = await api.get<APIResponse<Taxonomy>>(`/sites/${siteId}/taxonomies/${taxId}`);
    return r.data.data!;
  },

  async create(siteId: string, body: TaxonomyCreate) {
    const r = await api.post<APIResponse<Taxonomy>>(`/sites/${siteId}/taxonomies`, body);
    return r.data.data!;
  },

  async update(siteId: string, taxId: string, body: TaxonomyUpdate) {
    const r = await api.patch<APIResponse<Taxonomy>>(`/sites/${siteId}/taxonomies/${taxId}`, body);
    return r.data.data!;
  },

  async remove(siteId: string, taxId: string) {
    await api.delete(`/sites/${siteId}/taxonomies/${taxId}`);
  },
};
