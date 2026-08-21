// themes.ts - 主题相关 API (P2)
import { api } from './client';
import type { APIResponse, Paginated } from '@/lib/utils';

// === Theme (全局库) ===
export interface ThemeListItem {
  id: string;
  code: string;
  display_name: string;
  type: 'preset' | 'custom';
  template_name: string;
  preview_image: string | null;
  is_default: boolean;
  color_count: number;
  primary_color: string | null;
}

export interface Theme {
  id: string;
  code: string;
  display_name: string;
  type: 'preset' | 'custom';
  base_theme_id: string | null;
  template_name: string;
  preview_image: string | null;
  is_default: boolean;
  default_tokens: Record<string, any>;
  tokens_schema: Record<string, any>;
  created_at: string;
  updated_at: string;
}

// === ThemeVersion (站级) ===
export interface ThemeVersion {
  id: string;
  site_id: string;
  theme_id: string;
  version: number;
  tokens: Record<string, any>;
  is_active: boolean;
  is_ai_generated: boolean;
  prompt: string | null;
  change_note: string | null;
  author_id: string;
  author_name: string | null;
  theme_code: string | null;
  created_at: string;
}

export interface ThemeVersionListItem {
  id: string;
  version: number;
  is_active: boolean;
  is_ai_generated: boolean;
  change_note: string | null;
  author_id: string;
  author_name: string | null;
  theme_code: string | null;
  created_at: string;
}

export interface ThemeCurrent {
  version: ThemeVersion;
  theme: {
    id: string;
    code: string;
    display_name: string;
    type: string;
    is_default: boolean;
  };
}

// === Theme API ===
export const themesApi = {
  // 主题库 (全局)
  list: async (params: { type?: string; page?: number; page_size?: number } = {}) => {
    const r = await api.get<APIResponse<Paginated<ThemeListItem>>>('/themes', { params });
    return r.data.data;
  },
  get: async (themeId: string) => {
    const { data } = await api.get<{ data: Theme }>(`/themes/${themeId}`);
    return data.data;
  },
  // 站级
  getCurrent: async (siteId: string) => {
    // 未应用主题时后端 404，属正常空态，不弹全局 toast
    const { data } = await api.get<{ data: ThemeCurrent }>(
      `/sites/${siteId}/themes/current`,
      { _skipToast: true } as any,
    );
    return data.data;
  },
  apply: async (siteId: string, themeId: string, changeNote?: string) => {
    const { data } = await api.post<{ data: ThemeVersion; message: string }>(
      `/sites/${siteId}/themes/apply`,
      { theme_id: themeId, change_note: changeNote }
    );
    return data;
  },
  updateTokens: async (siteId: string, tokens: Record<string, any>, changeNote?: string) => {
    const { data } = await api.post<{ data: ThemeVersion; message: string }>(
      `/sites/${siteId}/themes/current`,
      { tokens, change_note: changeNote }
    );
    return data;
  },
  history: async (siteId: string, params: { page?: number; page_size?: number } = {}) => {
    const { data } = await api.get<Paginated<ThemeVersionListItem>>(
      `/sites/${siteId}/themes/history`,
      { params }
    );
    return data;
  },
  revert: async (siteId: string, versionId: string) => {
    const { data } = await api.post<{ data: ThemeVersion; message: string }>(
      `/sites/${siteId}/themes/revert/${versionId}`
    );
    return data;
  },
};
