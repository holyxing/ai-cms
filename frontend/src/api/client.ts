import axios, { type AxiosError, type InternalAxiosRequestConfig } from 'axios';
import { toast } from 'sonner';

import { useAuthStore } from '@/stores/auth';
import type { APIResponse } from '@/lib/utils';

export const API_BASE = import.meta.env.VITE_API_BASE || '/api/v1';

export const api = axios.create({
  baseURL: API_BASE,
  timeout: 30_000,
  headers: { 'Content-Type': 'application/json' },
});

// 并发 401 共用同一次 refresh, 避免竞态覆盖 token
let refreshPromise: Promise<string | null> | null = null;

async function refreshAccessToken(refreshToken: string): Promise<string | null> {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      try {
        const r = await axios.post<APIResponse<{ access_token: string; expires_in: number }>>(
          `${API_BASE}/auth/refresh`,
          { refresh_token: refreshToken },
        );
        const token = r.data.data?.access_token ?? null;
        if (token) useAuthStore.getState().setAccessToken(token);
        return token;
      } catch {
        return null;
      } finally {
        refreshPromise = null;
      }
    })();
  }
  return refreshPromise;
}

// 请求拦截: 注入 token
api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = useAuthStore.getState().accessToken;
  if (token && config.headers) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  // 实例默认 application/json 会盖掉 FormData 的 boundary，后端就会报 body.file: Field required
  if (typeof FormData !== 'undefined' && config.data instanceof FormData) {
    const headers = config.headers;
    if (headers && typeof (headers as { delete?: (k: string) => void }).delete === 'function') {
      (headers as { delete: (k: string) => void }).delete('Content-Type');
    } else if (headers) {
      delete (headers as Record<string, unknown>)['Content-Type'];
    }
  }
  return config;
});

// 响应拦截: 统一处理
api.interceptors.response.use(
  (response) => {
    // 后端业务错误: HTTP 200 但 code !== 0
    // 注意: 有些端点 (如 /layouts/{id}) 返裸对象, 自身也有 code 字段 (layout.code 是字符串)
    // 只在 code 是 number (包装响应) 且 !== 0 时才认为业务错
    // 修复 (P3.9): 不抛错, 改为把 data 改成 null + 在 console 警告, 避免 useQuery 拿到 undefined
    const data = response.data as APIResponse | undefined;
    if (
      data && typeof data === 'object'
      && 'code' in data && typeof (data as any).code === 'number'
      && (data as any).code !== 0
    ) {
      const message = data.message || '请求失败';
      // P3.6+: caller 可设 _skipToast 跳过全局 toast (自己处理)
      if (!(response.config as any)?._skipToast) toast.error(message);
      // 不抛错, 改成把 response.data = {code, message, data: null}
      // caller 用 r.data.data 拿到的就是 null, useQuery 不会报 "Query data cannot be undefined"
      response.data = { code: (data as any).code, message, data: null, errors: (data as any).errors } as any;
      return response;
    }
    return response;
  },
  async (error: AxiosError<APIResponse>) => {
    const status = error.response?.status;
    const data = error.response?.data;
    const message = data?.message || error.message || '请求失败';
    const skipToast = !!(error.config as any)?._skipToast;

    // 401: 尝试刷新 token, 否则登出
    if (status === 401) {
      const refreshToken = useAuthStore.getState().refreshToken;
      if (refreshToken && !error.config?.url?.includes('/auth/refresh')) {
        const newToken = await refreshAccessToken(refreshToken);
        if (newToken && error.config) {
          error.config.headers.Authorization = `Bearer ${newToken}`;
          return api.request(error.config);
        }
      }
      useAuthStore.getState().logout();
      if (!window.location.pathname.startsWith('/login')) {
        toast.error('登录已过期,请重新登录');
        window.location.href = '/login';
      }
    } else if (status && status >= 400 && !skipToast) {
      toast.error(message);
    }

    // 修复 (P3.9): 不抛错, 返一个带 data: null 的 response 对象, 让 useQuery 不报 undefined
    return { data: { code: status || 0, message, data: null, errors: null }, status: status || 0, statusText: error.message, config: error.config, headers: error.response?.headers } as any;
  }
);
