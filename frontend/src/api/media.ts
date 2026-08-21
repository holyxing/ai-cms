import { api } from './client';
import type { APIResponse } from '@/lib/utils';

export interface MediaFolder {
  id: string;
  site_id: string;
  parent_id: string | null;
  name: string;
  created_at: string;
  updated_at: string;
}

export interface MediaItem {
  id: string;
  site_id: string;
  folder_id: string | null;
  uploader_id: string;
  uploader_name?: string;
  filename: string;
  object_key: string;
  mime_type: string;
  size_bytes: number;
  width: number | null;
  height: number | null;
  alt_text: string | null;
  url: string;
  thumb_small_url: string | null;
  thumb_large_url: string | null;
  thumb_status: 'pending' | 'done' | 'failed';
  is_shared: boolean;
  tags?: MediaTagRef[];
  created_at: string;
  updated_at: string;
}

export interface MediaTagRef {
  id: string;
  name: string;
  color: string | null;
}

export interface MediaTag extends MediaTagRef {
  site_id: string;
  media_count: number;
  created_at: string;
}

export interface MediaListResponse {
  items: MediaItem[];
  total: number;
  page: number;
  page_size: number;
}

export const mediaApi = {
  // 上传 (multipart, 让浏览器自动设 boundary)
  upload(siteId: string, file: File, options?: { folder_id?: string; alt_text?: string }) {
    const fd = new FormData();
    fd.append('file', file);
    if (options?.folder_id) fd.append('folder_id', options.folder_id);
    if (options?.alt_text) fd.append('alt_text', options.alt_text);
    return api.post<APIResponse<MediaItem>>(`/sites/${siteId}/media/upload`, fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },

  list(siteId: string, params?: { page?: number; page_size?: number; folder_id?: string; mime_prefix?: string; q?: string; tags?: string }) {
    return api.get<APIResponse<MediaListResponse>>(`/sites/${siteId}/media`, { params });
  },

  // P3.6.1: 引用计数 (扫 contents.body + layouts.html)
  async getUsage(siteId: string, mediaId: string) {
    const r = await api.get<APIResponse<{ media_id: string; object_key: string; count: number; references: Array<{ type: string; id: string; title: string; context: string }> }>>(
      `/sites/${siteId}/media/${mediaId}/usage`,
    );
    return r.data.data!;
  },

  get(siteId: string, mediaId: string) {
    return api.get<APIResponse<MediaItem>>(`/sites/${siteId}/media/${mediaId}`);
  },

  update(siteId: string, mediaId: string, data: { filename?: string; alt_text?: string; folder_id?: string | null; is_shared?: boolean }) {
    return api.patch<APIResponse<MediaItem>>(`/sites/${siteId}/media/${mediaId}`, data);
  },

  // P3.6.1: 删除 (force=true 跳过引用检查)
  remove(siteId: string, mediaId: string, force = false) {
    return api.delete<APIResponse>(`/sites/${siteId}/media/${mediaId}`, { params: force ? { force: true } : {} });
  },

  listFolders(siteId: string) {
    // 后端返分页格式 {items, total, page, page_size}, 取 items 数组
    return api.get<APIResponse<{ items: MediaFolder[]; total: number; page: number; page_size: number }>>(
      `/sites/${siteId}/media-folders`,
    );
  },

  createFolder(siteId: string, data: { name: string; parent_id?: string }) {
    return api.post<APIResponse<MediaFolder>>(`/sites/${siteId}/media-folders`, data);
  },

  // ====== P3.6.2 F: 媒体标签 ======
  listTags(siteId: string, params?: { q?: string }) {
    return api.get<APIResponse<MediaTag[]>>(`/sites/${siteId}/media-tags`, { params });
  },
  createTag(siteId: string, data: { name: string; color?: string }) {
    return api.post<APIResponse<MediaTag>>(`/sites/${siteId}/media-tags`, data);
  },
  updateTag(siteId: string, tagId: string, data: { name?: string; color?: string | null }) {
    return api.patch<APIResponse<MediaTag>>(`/sites/${siteId}/media-tags/${tagId}`, data);
  },
  removeTag(siteId: string, tagId: string) {
    return api.delete<APIResponse>(`/sites/${siteId}/media-tags/${tagId}`);
  },
  setMediaTags(siteId: string, mediaId: string, tagIds: string[]) {
    return api.post<APIResponse>(`/sites/${siteId}/media/${mediaId}/tags`, { tag_ids: tagIds });
  },
  // P3.6.2 G: 跨站共享
  share(siteId: string, mediaId: string) {
    return api.post<APIResponse>(`/sites/${siteId}/media/${mediaId}/share`, {});
  },
  unshare(siteId: string, mediaId: string) {
    return api.post<APIResponse>(`/sites/${siteId}/media/${mediaId}/unshare`, {});
  },
  getMediaTags(siteId: string, mediaId: string) {
    return api.get<APIResponse<MediaTagRef[]>>(`/sites/${siteId}/media/${mediaId}/tags`);
  },
};
