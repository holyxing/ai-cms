// useRecentCategories.ts - 栏目最近访问 (P2.9 D1 配套 OQ5)
// 用法: 进入栏目内容页时 pushRecent(categoryId)
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface State {
  /** 最近栏目 id 列表 (newest first, max=5) */
  categories: string[];
  /** 推入一个栏目 (自动去重 + 上限) */
  pushRecent: (id: string) => void;
  /** 清空 */
  clear: () => void;
}

const MAX = 5;

export const useRecentCategories = create<State>()(
  persist(
    (set) => ({
      categories: [],
      pushRecent: (id) =>
        set((s) => {
          const next = [id, ...s.categories.filter((c) => c !== id)].slice(0, MAX);
          return { categories: next };
        }),
      clear: () => set({ categories: [] }),
    }),
    { name: 'ai-cms-recent-categories' }
  )
);
