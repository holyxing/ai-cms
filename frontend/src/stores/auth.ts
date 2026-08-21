import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import type { User } from '@/api/auth';

interface AuthState {
  accessToken: string | null;
  refreshToken: string | null;
  user: User | null;

  setTokens: (access: string, refresh: string) => void;
  setAccessToken: (access: string) => void;
  setUser: (user: User) => void;
  login: (data: { access_token: string; refresh_token: string; user: User }) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      accessToken: null,
      refreshToken: null,
      user: null,

      setTokens: (access, refresh) =>
        set({ accessToken: access, refreshToken: refresh }),
      setAccessToken: (access) => set({ accessToken: access }),
      setUser: (user) => set({ user }),

      login: ({ access_token, refresh_token, user }) =>
        set({
          accessToken: access_token,
          refreshToken: refresh_token,
          user,
        }),

      logout: () => set({ accessToken: null, refreshToken: null, user: null }),
    }),
    {
      name: 'ai-cms-auth',
      // P4.1: 跳过 persist 自动 hydrate (它是 async 的会跟 bootstrapAuth 同步 setState 冲突)
      // 由 bootstrapAuth 手动同步注入, 防止 reload 踢人 bug
      skipHydration: true,
    }
  )
);

// 启动时同步 hydrate (修 P4.1 发现的 reload 踢人 bug)
// P4.1: zustand v5 persist 默认 async hydrate, ProtectedRoute 在 hydrate 完成前看到 accessToken=null 跳 /login
// axios 拦截器 401 → logout() → ls 被覆盖清空 (即便后续 hydrate 完成也来不及)
// 修复: 同步从 localStorage 读 token, setState 直接写入 (绕开 persist async)
//       + 手动调 rehydrate 触发 ProtectedRoute 的 onFinishHydration 事件
export function bootstrapAuth() {
  try {
    const ls = typeof window !== 'undefined' ? window.localStorage.getItem('ai-cms-auth') : null;
    if (ls) {
      const parsed = JSON.parse(ls);
      if (parsed?.state?.accessToken && parsed?.state?.user) {
        useAuthStore.setState({
          accessToken: parsed.state.accessToken,
          refreshToken: parsed.state.refreshToken ?? '',
          user: parsed.state.user,
        });
      }
    }
  } catch {
    // localStorage 不可用或 JSON 损坏, 忽略
  }
  // 调 rehydrate 让 hasHydrated() 变 true + 触发 onFinishHydration
  useAuthStore.persist.rehydrate();
}

// P4.1: Dev/E2E 测试 hook, 仅 import.meta.env.DEV 暴露
// 让 playwright 可以同步注入 auth state (绕开 zustand persist async hydrate)
// 用法: window.__cmsSetAuth({ accessToken, user }) 或 window.__cmsStore.getState()
if (typeof window !== 'undefined' && import.meta.env?.DEV) {
  (window as any).__cmsSetAuth = (data: { accessToken: string; refreshToken?: string; user: any }) => {
    useAuthStore.setState({
      accessToken: data.accessToken,
      refreshToken: data.refreshToken ?? '',
      user: data.user,
    });
    return useAuthStore.getState();
  };
  (window as any).__cmsStore = useAuthStore;
}
