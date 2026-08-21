// recentSites.ts - 最近访问站点 (localStorage 缓存, max=5)
// 依据: docs/17-站点树重构.md §10 OQ1
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface RecentSite {
  id: string;
  slug: string;
  name: string;
  visitedAt: number;  // ms timestamp
}

interface RecentSitesState {
  sites: RecentSite[];
  push: (site: { id: string; slug: string; name: string }) => void;
  // P3.6+: 改名后更新 (保留 visitedAt)
  replace: (site: { id: string; slug: string; name: string }) => void;
  // P3.6+: 软删后移除
  remove: (id: string) => void;
  clear: () => void;
}

const MAX_RECENT = 5;

export const useRecentSites = create<RecentSitesState>()(
  persist(
    (set) => ({
      sites: [],
      push: (site) =>
        set((state) => {
          // 去掉已存在的, 推入头部, 截断到 max
          const filtered = state.sites.filter((s) => s.id !== site.id);
          const next = [{ ...site, visitedAt: Date.now() }, ...filtered].slice(0, MAX_RECENT);
          return { sites: next };
        }),
      replace: (site) =>
        set((state) => ({
          sites: state.sites.map((s) => (s.id === site.id ? { ...s, slug: site.slug, name: site.name } : s)),
        })),
      remove: (id) =>
        set((state) => ({
          sites: state.sites.filter((s) => s.id !== id),
        })),
      clear: () => set({ sites: [] }),
    }),
    {
      name: 'recent_sites',
      version: 2,  // P3.6+ 加 replace/remove action, bump version 强制 reload
    }
  )
);
