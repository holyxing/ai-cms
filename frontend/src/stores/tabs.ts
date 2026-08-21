// tabs.ts - 多 tab 系统 (P3.8, holy 反馈 #10440)
//
// 设计:
// - Q1=A 全局 tab: 任何页面 (Dashboard/模板/主题/AI/Users/Settings...) 可同时开多个
// - Q2=B 持久化: localStorage 存, 刷新恢复
// - Q3=A 同 pathname 单 tab (distinct): query 只是页内状态，不另开 tab
//
// 跟 react-router 协作:
// - AppLayout Outlet 永远渲染 **当前 active tab** 的页面
// - active tab = 当前 URL pathname
// - 当 location 变 (含 redirect), 调 syncWithLocation() 自动 open/activate tab
// - 关闭 tab → 跳到 neighbors[0] (浏览器行为)
//
// 数据结构:
// - Tab: { id, pathname, search, title, icon?, closable, pinned, scrollY, createdAt }
// - store: { tabs: Tab[], activeId: string|null, openTab, closeTab, activate, ... }

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface Tab {
  id: string;          // = pathname（同页单 tab）
  pathname: string;    // 路由 path
  search: string;      // 不含 '?' 的 query（页内状态，不参与去重）
  title: string;       // 显示名 (面包屑生成)
  icon?: string;       // lucide-react 名字
  closable: boolean;   // 是否可关 (默认 true, dashboard/pinned = false)
  pinned: boolean;     // 固定 (不参与 close all, 永远在左)
  scrollY: number;     // 切走时记录, 切回还原
  createdAt: number;
}

interface TabsState {
  tabs: Tab[];
  activeId: string | null;
  /** 同 pathname 单 tab (distinct) */
  tabId: (pathname: string, search?: string) => string;
  /** 规范化 search（去掉前导 ?） */
  normalizeSearch: (search?: string) => string;
  /** 启动时合并同 pathname 的重复 tab */
  dedupeTabs: () => void;
  /** P3.8.1: 确保默认 dashboard tab 存在 (pinned + 不可关) */
  ensureDefault: () => void;
  /** 创建或激活 tab (Q3=A) */
  openTab: (t: { pathname: string; search?: string; title: string; icon?: string; pinned?: boolean; closable?: boolean }) => string;
  /** 激活已有 tab */
  activate: (id: string) => void;
  /** 关闭 tab (跳到 neighbor) */
  closeTab: (id: string) => string | null;  // 返回新 activeId
  /** 关闭其他 */
  closeOthers: (id: string) => void;
  /** 关闭所有可关 */
  closeAll: () => void;
  /** 关闭右边 */
  closeRight: (id: string) => void;
  /** 重命名 (e.g. 文档改名) */
  renameTab: (id: string, title: string) => void;
  /** 切走时记 scrollY */
  saveScroll: (id: string, y: number) => void;
  /** 同步 location (AppLayout useEffect 调, 路由变 → open/activate) */
  syncWithLocation: (pathname: string, search: string, title: string, icon?: string) => void;
  /** 拖拽排序 */
  reorder: (fromId: string, toId: string) => void;
  /** 启动时把抽象/过长的 tab 标题换成真实名 */
  migrateLayoutTabTitles: () => Promise<void>;
}

const MAX_TABS = 20;  // 防止用户狂开

function normalizeSearch(search?: string): string {
  return (search || '').replace(/^\?+/, '');
}

/** 从旧 id（pathname?search）或 pathname 解析出 pathname */
function pathnameOf(idOrPath: string): string {
  const q = idOrPath.indexOf('?');
  return q === -1 ? idOrPath : idOrPath.slice(0, q);
}

export const useTabsStore = create<TabsState>()(
  persist(
    (set, get) => ({
      tabs: [],
      activeId: null,

      normalizeSearch,

      // 同一 pathname = 同一 tab；search 不参与 id
      tabId: (pathname, _search = '') => pathname,

      dedupeTabs: () => {
        const { tabs, activeId } = get();
        if (tabs.length === 0) return;

        const byPath = new Map<string, Tab>();
        for (const t of tabs) {
          const pathname = t.pathname || pathnameOf(t.id);
          const search = normalizeSearch(t.search);
          const prev = byPath.get(pathname);
          if (!prev) {
            byPath.set(pathname, {
              ...t,
              id: pathname,
              pathname,
              search,
            });
            continue;
          }
          // 同 pathname：保留更新的；标题优先非占位名
          const placeholder = (title?: string) =>
            !title ||
            title === '栏目' ||
            title === '文章' ||
            title === '站点资源' ||
            title === '模板编辑';
          const preferNew =
            (t.createdAt ?? 0) >= (prev.createdAt ?? 0) ||
            (placeholder(prev.title) && !placeholder(t.title));
          const keep = preferNew ? t : prev;
          const drop = preferNew ? prev : t;
          byPath.set(pathname, {
            ...keep,
            id: pathname,
            pathname,
            search: normalizeSearch(keep.search) || normalizeSearch(drop.search),
            title: keep.title || drop.title,
            icon: keep.icon || drop.icon,
            pinned: keep.pinned || drop.pinned,
            closable: keep.pinned || drop.pinned ? false : keep.closable,
            createdAt: Math.min(keep.createdAt ?? 0, drop.createdAt ?? 0),
          });
        }

        const next = Array.from(byPath.values());
        const activePath = activeId ? pathnameOf(activeId) : null;
        const nextActive =
          (activePath && next.find((t) => t.id === activePath)?.id) ||
          next.find((t) => t.pinned)?.id ||
          next[0]?.id ||
          null;

        const same =
          next.length === tabs.length &&
          next.every((t, i) => {
            const o = tabs[i];
            return o && o.id === t.id && o.search === t.search && o.pathname === t.pathname;
          }) &&
          nextActive === activeId;
        if (same) return;

        set({ tabs: next, activeId: nextActive });
      },

      openTab: ({ pathname, search = '', title, icon, pinned = false, closable = true }) => {
        const id = get().tabId(pathname);
        const normSearch = normalizeSearch(search);
        const existing = get().tabs.find((t) => t.id === id || t.pathname === pathname);
        if (existing) {
          set((s) => ({
            activeId: id,
            tabs: s.tabs.map((t) =>
              t.id === existing.id
                ? {
                    ...t,
                    id,
                    pathname,
                    search: normSearch || t.search,
                    title:
                      title &&
                      (!t.title ||
                        t.title === '栏目' ||
                        t.title === '文章' ||
                        t.title === '模板编辑' ||
                        t.title === '站点资源')
                        ? title
                        : t.title,
                    icon: icon || t.icon,
                  }
                : t,
            ),
          }));
          return id;
        }
        const newTab: Tab = {
          id,
          pathname,
          search: normSearch,
          title,
          icon,
          closable,
          pinned,
          scrollY: 0,
          createdAt: Date.now(),
        };
        set((s) => {
          let tabs = [...s.tabs, newTab];
          if (tabs.length > MAX_TABS) {
            const removable = tabs.filter((t) => !t.pinned && t.closable);
            if (removable.length > 0) {
              const oldest = removable.reduce((a, b) => (a.createdAt < b.createdAt ? a : b));
              tabs = tabs.filter((t) => t.id !== oldest.id);
            }
          }
          return { tabs, activeId: id };
        });
        return id;
      },

      activate: (id) => {
        const path = pathnameOf(id);
        const tab = get().tabs.find((t) => t.id === path || t.id === id || t.pathname === path);
        set({ activeId: tab?.id ?? path });
      },

      ensureDefault: () => {
        get().dedupeTabs();
        const state = get();
        const defaultId = state.tabId('/dashboard');
        const exists = state.tabs.find((t) => t.id === defaultId || t.pathname === '/dashboard');
        if (!exists) {
          set((s) => ({
            tabs: [
              {
                id: defaultId,
                pathname: '/dashboard',
                search: '',
                title: '工作台',
                closable: false,
                pinned: true,
                scrollY: 0,
                createdAt: Date.now(),
              },
              ...s.tabs,
            ],
          }));
        } else if (!exists.pinned) {
          set((s) => ({
            tabs: s.tabs.map((t) =>
              t.pathname === '/dashboard' ? { ...t, id: defaultId, pinned: true, closable: false } : t,
            ),
          }));
        }
      },

      closeTab: (id) => {
        const { tabs, activeId } = get();
        const path = pathnameOf(id);
        const target = tabs.find((t) => t.id === id || t.id === path || t.pathname === path);
        if (!target || !target.closable) return activeId;

        const idx = tabs.findIndex((t) => t.id === target.id);
        const newTabs = tabs.filter((t) => t.id !== target.id);
        let newActiveId = activeId;

        if (activeId === target.id || (activeId && pathnameOf(activeId) === target.pathname)) {
          const neighbor =
            newTabs.find((t) => t.pinned) ||
            newTabs[idx] ||
            newTabs[idx - 1] ||
            newTabs[0];
          newActiveId = neighbor ? neighbor.id : null;
        }
        set({ tabs: newTabs, activeId: newActiveId });
        return newActiveId;
      },

      closeOthers: (id) =>
        set((s) => {
          const path = pathnameOf(id);
          const target = s.tabs.find((t) => t.id === id || t.id === path || t.pathname === path);
          if (!target) return s;
          return {
            tabs: s.tabs.filter((t) => t.id === target.id || t.pinned),
            activeId: target.id,
          };
        }),

      closeAll: () =>
        set((s) => {
          const pinned = s.tabs.filter((t) => t.pinned);
          return { tabs: pinned, activeId: pinned[0]?.id ?? null };
        }),

      closeRight: (id) =>
        set((s) => {
          const path = pathnameOf(id);
          const idx = s.tabs.findIndex((t) => t.id === id || t.id === path || t.pathname === path);
          if (idx === -1) return s;
          const keepId = s.tabs[idx].id;
          const activeIdx = s.activeId
            ? s.tabs.findIndex((t) => t.id === s.activeId || t.pathname === pathnameOf(s.activeId || ''))
            : -1;
          return {
            tabs: s.tabs.filter((t, i) => i <= idx || t.pinned),
            activeId: activeIdx !== -1 && activeIdx <= idx ? pathnameOf(s.activeId!) : keepId,
          };
        }),

      renameTab: (id, title) => {
        const path = pathnameOf(id);
        set((s) => ({
          tabs: s.tabs.map((t) =>
            t.id === id || t.id === path || t.pathname === path ? { ...t, title } : t,
          ),
        }));
      },

      migrateLayoutTabTitles: async () => {
        get().dedupeTabs();
        const s = get();
        const layoutDetailRe = /^\/sites\/[^/]+\/layouts\/[^/]+/;
        const categoryRe = /^\/c\/[^/]+/;
        const contentRe = /^\/sites\/[^/]+\/contents\/[^/]+/;

        const layoutNeeds = s.tabs.filter((t) => {
          if (!layoutDetailRe.test(t.pathname || '')) return false;
          if (!t.title) return true;
          if (t.title === '模板编辑') return true;
          if (/[0-9a-f]{8}-[0-9a-f]{4}/i.test(t.title)) return true;
          if (/\s·\s(v\d+|home|content|category|partial)/i.test(t.title)) return true;
          return false;
        });

        const catNeeds = s.tabs.filter(
          (t) => categoryRe.test(t.pathname || '') && (!t.title || t.title === '栏目'),
        );

        const contentNeeds = s.tabs.filter(
          (t) =>
            contentRe.test(t.pathname || '') &&
            (!t.title || t.title === '文章' || t.title === '新建文章'),
        );

        const tasks: Promise<void>[] = [];

        if (layoutNeeds.length > 0) {
          const { layoutsApi } = await import('@/api/layouts');
          for (const t of layoutNeeds) {
            tasks.push(
              (async () => {
                const m = (t.pathname || '').match(/\/layouts\/([^/?]+)/);
                if (!m) return;
                try {
                  const lay: any = await layoutsApi.get(m[1]);
                  get().renameTab(t.id, (lay.name || lay.code || '模板').trim());
                } catch {
                  /* ignore */
                }
              })(),
            );
          }
        }

        if (catNeeds.length > 0) {
          const { categoriesApi } = await import('@/api/categories');
          for (const t of catNeeds) {
            tasks.push(
              (async () => {
                const m = (t.pathname || '').match(/^\/c\/([^/?]+)/);
                if (!m) return;
                try {
                  const cat = await categoriesApi.get(m[1], { skipToast: true });
                  if (cat?.name) get().renameTab(t.id, cat.name);
                } catch {
                  /* ignore */
                }
              })(),
            );
          }
        }

        if (contentNeeds.length > 0) {
          const { contentsApi } = await import('@/api/contents');
          for (const t of contentNeeds) {
            tasks.push(
              (async () => {
                const m = (t.pathname || '').match(/^\/sites\/([^/]+)\/contents\/([^/?]+)/);
                if (!m || m[2] === 'new') return;
                try {
                  const c = await contentsApi.get(m[1], m[2]);
                  if (c?.title) get().renameTab(t.id, c.title);
                } catch {
                  /* ignore */
                }
              })(),
            );
          }
        }

        await Promise.all(tasks);
      },

      saveScroll: (id, y) => {
        const path = pathnameOf(id);
        set((s) => ({
          tabs: s.tabs.map((t) =>
            t.id === id || t.id === path || t.pathname === path ? { ...t, scrollY: y } : t,
          ),
        }));
      },

      syncWithLocation: (pathname, search, title, icon) => {
        // openTab 内部按 pathname 去重并激活
        get().openTab({ pathname, search: normalizeSearch(search), title, icon });
      },

      reorder: (fromId, toId) =>
        set((s) => {
          const fromPath = pathnameOf(fromId);
          const toPath = pathnameOf(toId);
          if (fromPath === toPath) return s;
          const fromIdx = s.tabs.findIndex(
            (t) => t.id === fromId || t.id === fromPath || t.pathname === fromPath,
          );
          const toIdx = s.tabs.findIndex(
            (t) => t.id === toId || t.id === toPath || t.pathname === toPath,
          );
          if (fromIdx === -1 || toIdx === -1) return s;
          const tabs = [...s.tabs];
          const [moved] = tabs.splice(fromIdx, 1);
          tabs.splice(toIdx, 0, moved);
          return { tabs };
        }),
    }),
    {
      name: 'ai-cms-tabs',
      partialize: (s) => ({ tabs: s.tabs, activeId: s.activeId }),
      version: 2,
      migrate: (persisted: any) => {
        if (!persisted || typeof persisted !== 'object') return persisted;
        const state = persisted.state ?? persisted;
        const tabs: Tab[] = Array.isArray(state.tabs) ? state.tabs : [];
        const byPath = new Map<string, Tab>();
        for (const t of tabs) {
          const pathname = t.pathname || pathnameOf(t.id || '');
          if (!pathname) continue;
          const search = normalizeSearch(t.search);
          const prev = byPath.get(pathname);
          if (!prev || (t.createdAt ?? 0) >= (prev.createdAt ?? 0)) {
            byPath.set(pathname, {
              ...t,
              id: pathname,
              pathname,
              search,
            });
          }
        }
        const nextTabs = Array.from(byPath.values());
        const activePath = state.activeId ? pathnameOf(state.activeId) : null;
        const activeId =
          (activePath && nextTabs.find((t) => t.id === activePath)?.id) ||
          nextTabs.find((t) => t.pinned)?.id ||
          nextTabs[0]?.id ||
          null;
        if (persisted.state) {
          return { ...persisted, state: { ...state, tabs: nextTabs, activeId } };
        }
        return { ...state, tabs: nextTabs, activeId };
      },
    },
  ),
);
