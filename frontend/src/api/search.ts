// P5.1 全局搜索 API (跨站, 走 /api/v1/search 端点)
import { api } from './client';
import type { APIResponse } from '@/lib/utils';
import type { ContentStatus } from './contents';

export interface SearchHit {
  id: string;
  site_id: string;
  site_name: string | null;
  site_slug: string | null;
  author_id: string;
  author_name: string | null;
  title: string;
  title_highlight: string;  // ts_headline 后的高亮 HTML
  slug: string;
  excerpt: string | null;
  status: ContentStatus;
  category_id: string | null;
  updated_at: string;
  published_at: string | null;
}

export interface SearchResult {
  items: SearchHit[];
  total: number;
  page: number;
  page_size: number;
}

export const searchApi = {
  global: (params: { q: string; site_id?: string; status?: ContentStatus; page?: number; page_size?: number }) => {
    const sp = new URLSearchParams({ q: params.q });
    if (params.site_id) sp.set('site_id', params.site_id);
    if (params.status) sp.set('status', params.status);
    if (params.page) sp.set('page', String(params.page));
    if (params.page_size) sp.set('page_size', String(params.page_size));
    return api.get<APIResponse<SearchResult>>(`/search?${sp.toString()}`).then((r) => r.data.data);
  },
};
