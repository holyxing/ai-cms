// useDashboardLayout.ts - Dashboard 卡片顺序持久化 (P6.5 #17)
//
// 用户可在左/右两栏内拖拽重排卡片顺序, 跨栏拖不允许
// 顺序存 localStorage, 首次访问用默认顺序
// 提供 reset() 让用户回到默认

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

// 8 个可拖卡片 id (稳定 id, 改了就破坏旧 localStorage, 但只是用户偏好, 不影响功能)
// 加新 id 不影响老用户 localStorage — loadFromStorage 用 for-if 自动补齐缺失
export type CardId =
  | 'activity-feed'
  | 'recent-deployments'
  | 'quick-actions'
  | 'todos'
  | 'ai-summary'
  | 'content-health'
  // P6.6 dashboard 增强: 覆盖 CMS 特色 feature (主题/媒体)
  | 'current-theme'
  | 'media-highlights';

// 左侧主区: 数据/展示型 (主题 + 媒体缩略图 + 最近发布 + 健康度)
// 右侧侧栏: 操作/任务型 (快速入口 + 待办 + AI 协作 + 活动流)
export const LEFT_CARDS: CardId[] = [
  'current-theme',         // P6.6: CMS 特色 (主题是核心卖点)
  'media-highlights',      // P6.6: CMS 特色 (媒体是核心资产) — 有图缩略图, 放主区提升视觉冲击
  'recent-deployments',
  'content-health',
];
export const RIGHT_CARDS: CardId[] = [
  'quick-actions',         // 高频操作放顶部 (用户天天点)
  'todos',
  'ai-summary',
  'activity-feed',         // 信息流放底部 (内容多, 排到底部不会挤压其他)
];

const STORAGE_KEY = 'aicms.dashboard.layout.v1';

interface Layout {
  left: CardId[];
  right: CardId[];
}

// 合并默认: 第一次访问或字段缺失时用
function defaultLayout(): Layout {
  return { left: [...LEFT_CARDS], right: [...RIGHT_CARDS] };
}

function loadFromStorage(): Layout {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultLayout();
    const parsed = JSON.parse(raw) as Partial<Layout>;
    // 防御: 即使字段错了, 用默认补齐 + 过滤掉已移除的卡片
    const validIds = new Set<CardId>([...LEFT_CARDS, ...RIGHT_CARDS]);
    const left = Array.isArray(parsed.left)
      ? (parsed.left.filter((id) => validIds.has(id as CardId) && LEFT_CARDS.includes(id as CardId)) as CardId[])
      : [...LEFT_CARDS];
    const right = Array.isArray(parsed.right)
      ? (parsed.right.filter((id) => validIds.has(id as CardId) && RIGHT_CARDS.includes(id as CardId)) as CardId[])
      : [...RIGHT_CARDS];
    // 补齐缺失 (本地版本升级时可能新增卡片)
    for (const id of LEFT_CARDS) if (!left.includes(id)) left.push(id);
    for (const id of RIGHT_CARDS) if (!right.includes(id)) right.push(id);
    return { left, right };
  } catch {
    return defaultLayout();
  }
}

function saveToStorage(layout: Layout) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
  } catch {
    // ignore quota / private mode
  }
}

export function useDashboardLayout() {
  const [layout, setLayout] = useState<Layout>(() => defaultLayout());
  const [hydrated, setHydrated] = useState(false);

  // mount 时从 localStorage 读
  useEffect(() => {
    setLayout(loadFromStorage());
    setHydrated(true);
  }, []);

  const reorder = useCallback((column: 'left' | 'right', fromId: CardId, toId: CardId) => {
    setLayout((prev) => {
      const next = { ...prev };
      const arr = [...next[column]];
      const fromIdx = arr.indexOf(fromId);
      const toIdx = arr.indexOf(toId);
      if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return prev;
      const [moved] = arr.splice(fromIdx, 1);
      arr.splice(toIdx, 0, moved);
      next[column] = arr;
      saveToStorage(next);
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    const def = defaultLayout();
    setLayout(def);
    saveToStorage(def);
    toast.success('Dashboard 已恢复默认顺序');
  }, []);

  return { layout, reorder, reset, hydrated };
}