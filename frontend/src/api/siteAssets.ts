// siteAssets.ts - 站点级静态资源 API (P3.6.2)
// 模板/主题自带的 CSS/JS/字体/Logo 等, 走 HY_ASSET_URL 标签引用
import { api } from './client';
import type { APIResponse } from '@/lib/utils';

export interface SiteAsset {
  id: string;
  category: 'css' | 'js' | 'assets';  // P3.6.5: 3 个内置目录
  name: string;
  original_filename: string;
  content_type: string;
  byte_size: number;
  description: string | null;
  created_at: string;
  updated_at: string;
  url: string; // 静态发布后的公开 URL: /sites/{slug}/assets/{name}
}

// P3.6.5+: admin 内部预览, 走 API binary 端点 (不依赖 public URL, 永不 404)
export function previewUrl(siteId: string, category: string, name: string): string {
  return `/api/v1/sites/${siteId}/assets/${category}/${encodeURIComponent(name)}/binary`;
}

// P3.6.5: 3 个内置目录及允许的扩展名 (跟后端一致)
export const ASSET_CATEGORIES = ['css', 'js', 'assets'] as const;
export type AssetCategory = typeof ASSET_CATEGORIES[number];

const CATEGORY_EXTS: Record<AssetCategory, string[]> = {
  css: ['.css'],
  js: ['.js'],
  assets: [
    '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.bmp',
    '.woff', '.woff2', '.ttf', '.otf', '.eot',
    '.txt', '.json', '.xml', '.pdf', '.mp4', '.webm', '.mp3',
  ],
};

export const CATEGORY_META: Record<AssetCategory, { label: string; color: string; bg: string; description: string; icon: string }> = {
  css: { label: 'CSS', color: 'text-blue-700', bg: 'bg-blue-50', description: '样式表 (只接受 .css)', icon: '🎨' },
  js: { label: 'JS', color: 'text-amber-700', bg: 'bg-amber-50', description: '脚本 (只接受 .js)', icon: '⚡' },
  assets: { label: '图片', color: 'text-emerald-700', bg: 'bg-emerald-50', description: '图片 / 字体 / 其他 (png/jpg/svg/woff/...)', icon: '📦' },
};

export function validateCategoryForExt(category: AssetCategory, name: string): string | null {
  const exts = CATEGORY_EXTS[category];
  const nameLower = name.toLowerCase();
  if (!exts.some(e => nameLower.endsWith(e))) {
    return `目录「${CATEGORY_META[category].label}」不接受该扩展名 (允许: ${exts.slice(0, 5).join(', ')}${exts.length > 5 ? '...' : ''})`;
  }
  return null;
}

export interface SiteAssetListResp {
  items: SiteAsset[];
  total: number;
}

export const siteAssetsApi = {
  list: (siteId: string, category?: AssetCategory) => {
    const qs = category ? `?category=${category}` : '';
    // P5.3: 后端全量统一返 APIResponse {code, message, data}, 这里取 .data.data
    return api.get<APIResponse<SiteAssetListResp>>(`/sites/${siteId}/assets${qs}`).then((r) => r.data.data!);
  },

  get: (siteId: string, category: AssetCategory, name: string) =>
    api.get<APIResponse<SiteAsset>>(`/sites/${siteId}/assets/${category}/${encodeURIComponent(name)}`).then((r) => r.data.data!),

  // 上传: category + name + file + 可选 description
  upload: (siteId: string, params: { category: AssetCategory; name: string; file: File; description?: string }) => {
    const fd = new FormData();
    fd.append('category', params.category);
    fd.append('name', params.name);
    if (params.description) fd.append('description', params.description);
    fd.append('file', params.file);
    return api
      .post<APIResponse<SiteAsset>>(`/sites/${siteId}/assets`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      .then((r) => r.data.data!);
  },

  // 重命名 / 更新描述 (跨 category 不允许, 后端会拒绝)
  update: (siteId: string, category: AssetCategory, name: string, payload: { name?: string; description?: string }) =>
    api
      .patch<APIResponse<SiteAsset>>(
        `/sites/${siteId}/assets/${category}/${encodeURIComponent(name)}`,
        payload,
      )
      .then((r) => r.data.data!),

  remove: (siteId: string, category: AssetCategory, name: string) =>
    api.delete<APIResponse<void>>(`/sites/${siteId}/assets/${category}/${encodeURIComponent(name)}`).then((r) => r.data.data!),

  // P3.6.3: 在线编辑资源内容
  getContent: (siteId: string, category: AssetCategory, name: string) =>
    api
      .get<APIResponse<{
        name: string;
        content_type: string;
        byte_size: number;
        editable: boolean;
        content: string;
      }>>(`/sites/${siteId}/assets/${category}/${encodeURIComponent(name)}/content`)
      .then((r) => r.data.data!),

  updateContent: (siteId: string, category: AssetCategory, name: string, content: string) =>
    api
      .put<SiteAsset>(
        `/sites/${siteId}/assets/${category}/${encodeURIComponent(name)}/content`,
        { content },
      )
      .then((r) => r.data),

  /** 服务端拉取外链并写入站点资源（绕过浏览器 CORS） */
  importFromUrl: (siteId: string, params: { url: string; name?: string; category?: AssetCategory }) =>
    api
      .post<APIResponse<SiteAsset>>(
        `/sites/${siteId}/assets/import-from-url`,
        {
          url: params.url,
          name: params.name,
          category: params.category ?? 'assets',
        },
        { _skipToast: true } as any,
      )
      .then((r) => {
        const asset = r.data?.data;
        if (!asset) {
          throw new Error(r.data?.message || '导入站点资源失败');
        }
        return asset;
      }),
};
