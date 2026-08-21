// siteTrash.ts - 站点级回收站 API
import { api } from './client';
import type { APIResponse } from '@/lib/utils';

export type TrashItemType = 'content' | 'category' | 'layout' | 'media';

export interface TrashItem {
  id: string;
  type: TrashItemType;
  type_label: string;
  title: string;
  slug: string;
  deleted_at: string | null;
  extra: Record<string, unknown>;
}

export interface TrashListResult {
  items: TrashItem[];
  total: number;
  page: number;
  page_size: number;
  counts: Record<TrashItemType, number>;
}

export interface TrashCounts {
  counts: Record<TrashItemType, number>;
  total: number;
}

export const siteTrashApi = {
  async list(
    siteId: string,
    opts: { type?: TrashItemType | ''; page?: number; page_size?: number; q?: string } = {},
  ): Promise<TrashListResult> {
    const params = new URLSearchParams();
    if (opts.type) params.set('type', opts.type);
    if (opts.page) params.set('page', String(opts.page));
    if (opts.page_size) params.set('page_size', String(opts.page_size));
    if (opts.q) params.set('q', opts.q);
    const qs = params.toString();
    const r = await api.get<APIResponse<TrashListResult>>(
      `/sites/${siteId}/trash${qs ? `?${qs}` : ''}`,
    );
    return r.data.data!;
  },

  async counts(siteId: string): Promise<TrashCounts> {
    const r = await api.get<APIResponse<TrashCounts>>(`/sites/${siteId}/trash/counts`);
    return r.data.data!;
  },

  async restore(siteId: string, type: TrashItemType, id: string) {
    await api.post(`/sites/${siteId}/trash/${type}/${id}/restore`);
  },

  async permanentDelete(siteId: string, type: TrashItemType, id: string) {
    await api.delete(`/sites/${siteId}/trash/${type}/${id}/permanent`);
  },

  async batch(
    siteId: string,
    action: 'restore' | 'permanent',
    items: Array<{ type: TrashItemType; id: string }>,
  ) {
    const r = await api.post<APIResponse<{
      results: Array<{ type: TrashItemType; id: string; success: boolean; error?: string }>;
      total: number;
      succeeded: number;
      failed: number;
    }>>(`/sites/${siteId}/trash/batch`, { action, items });
    const data = r.data.data;
    if (!data) throw new Error(r.data.message || '批量操作失败');
    return data;
  },
};
