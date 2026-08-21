// categories.ts - 栏目 API (P2.7)
// 依据: docs/17-站点树重构.md §4.1
import { api } from './client';
import type { APIResponse } from '@/lib/utils';

export interface CategoryNode {
  id: string;
  site_id: string;
  parent_id: string | null;
  name: string;
  slug: string;
  path: string;
  description: string | null;
  order_num: number;
  seo: Record<string, unknown>;
  content_count: number;
  // 栏目列表模板
  template: string;
  // 栏目详情模板
  content_template: string;
  created_at: string;
  updated_at: string;
  // 详情接口可能不含 children, 所以可选
  children?: CategoryNode[];
}

export interface CategoryFlat extends Omit<CategoryNode, 'children'> {}

export interface CategoryTreeResponse {
  site_id: string;
  total: number;
  tree: CategoryNode[];
}

export interface CategoryFlatResponse {
  site_id: string;
  total: number;
  items: CategoryFlat[];
}

export interface CategoryCreatePayload {
  name: string;
  slug: string;
  description?: string;
  parent_id?: string | null;
  // 栏目列表模板
  template?: string;
  // 栏目详情模板
  content_template?: string;
}

export interface CategoryUpdatePayload {
  name?: string;
  slug?: string;
  description?: string;
  parent_id?: string | null;
  order_num?: number;
  seo?: Record<string, unknown>;
  // 栏目列表模板
  template?: string;
  // 栏目详情模板
  content_template?: string;
}

/** P7+: 批量导入返回的条目 */
export interface CategoryImportItem {
  id: string;
  name: string;
  slug: string;
  level: number;
  parent_id: string | null;
}

export const categoriesApi = {
  /** 拉整棵树 (默认) */
  async tree(siteId: string): Promise<CategoryTreeResponse> {
    const r = await api.get<{ data: CategoryTreeResponse }>(
      `/sites/${siteId}/categories`
    );
    return r.data.data;
  },

  /** 拉扁平列表 (供拖拽用) */
  async flat(siteId: string): Promise<CategoryFlatResponse> {
    const r = await api.get<{ data: CategoryFlatResponse }>(
      `/sites/${siteId}/categories?flat=true`
    );
    return r.data.data;
  },

  async create(siteId: string, payload: CategoryCreatePayload): Promise<CategoryFlat> {
    const r = await api.post<{ data: CategoryFlat }>(
      `/sites/${siteId}/categories`,
      payload
    );
    return r.data.data;
  },

  /**
   * 批量导入栏目 (Excel .xlsx)
   *
   * 后端期望 multipart/form-data, file 字段携带 .xlsx
   * Excel 格式: 3 列 一级栏目/二级栏目/三级栏目, 空单元格继承上一行的上一级
   *
   * 返回 { created: [{id, name, slug, level, parent_id}], total }
   */
  async importXlsx(
    siteId: string,
    file: File
  ): Promise<{ created: CategoryImportItem[]; total: number }> {
    const form = new FormData();
    form.append('file', file);
    const r = await api.post<{ data: { created: CategoryImportItem[]; total: number } }>(
      `/sites/${siteId}/categories/import`,
      form
      // 注意: 不要手动设 Content-Type, axios 会自动加 boundary
    );
    const data = r.data.data;
    if (!data || typeof data.total !== 'number' || !Array.isArray(data.created)) {
      throw new Error((r.data as any)?.message || '栏目导入失败');
    }
    return data;
  },

  /** 拉当前站点指定 scope 的模板列表 */
  async listTemplates(siteId: string, scope: 'category' | 'content' = 'category'): Promise<Array<{ code: string; name: string; is_default: boolean }>> {
    const r = await api.get<APIResponse<{ items: Array<{ code: string; name: string; is_default: boolean }>; total: number }>>(
      `/sites/${siteId}/layouts?scope=${scope}`
    );
    return r.data.data?.items ?? [];
  },

  async get(id: string, opts?: { skipToast?: boolean }): Promise<CategoryFlat & { children_count: number }> {
    const r = await api.get<{ data: CategoryFlat & { children_count: number } }>(
      `/categories/${id}`,
      { _skipToast: opts?.skipToast } as any,
    );
    return r.data.data;
  },

  async update(id: string, payload: CategoryUpdatePayload): Promise<CategoryFlat> {
    const r = await api.patch<{ data: CategoryFlat }>(
      `/categories/${id}`,
      payload
    );
    return r.data.data;
  },

  async delete(id: string): Promise<void> {
    await api.delete(`/categories/${id}`);
  },

  async move(id: string, parentId: string | null, position = 0): Promise<CategoryFlat> {
    const r = await api.post<{ data: CategoryFlat }>(
      `/categories/${id}/move`,
      { parent_id: parentId, position }
    );
    return r.data.data;
  },

  async copy(id: string, payload: { name_suffix?: string; slug_suffix?: string } = {}): Promise<CategoryFlat> {
    const r = await api.post<{ data: CategoryFlat }>(
      `/categories/${id}/copy`,
      payload
    );
    return r.data.data;
  },

  /** 触发栏目级静态部署 (P3.6.1+, 重 build 该栏目页 + 所有文章) */
  async publishStatic(siteId: string, categoryId: string) {
    const r = await api.post<{ data: { id: string; status: string } }>(
      `/sites/${siteId}/categories/${categoryId}/static-publish`,
      {},
    );
    return r.data.data;
  },

  /** 删除栏目已发布的 index.html */
  async deleteIndexPage(categoryId: string) {
    const r = await api.delete<{ data: { removed: boolean } }>(
      `/categories/${categoryId}/index-page`,
    );
    return r.data.data;
  },

};
