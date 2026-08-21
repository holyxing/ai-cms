// P6.3 #22: 草稿自动保存 hook
// - 自动存到 localStorage (key: 'draft:<scope>:<id>')
// - 节流 1s
// - 暴露 hasDraft / clearDraft / lastSavedAt
// - onRestore: 父组件决定如何恢复 (弹 dialog 或直接 setState)
//
// 用法:
//   const { hasDraft, getDraft, clearDraft, lastSavedAt } = useDraftAutosave({
//     scope: 'content',
//     id: contentId,
//     data: { title, body },
//   })
//
//   // 加载时检查
//   useEffect(() => {
//     const draft = getDraft()
//     if (draft && confirm('恢复草稿?')) applyDraft(draft)
//   }, [])
//
//   // 每次 data 变化时自动保存
//   useEffect(() => {
//     if (data.title || data.body) saveDraft(data)
//   }, [data])
import { useCallback, useEffect, useRef, useState } from 'react';

interface UseDraftAutosaveOptions<T> {
  scope: string;          // 'content' | 'site-settings' | 'member-invite' | ...
  id?: string | number;   // entity id, omit for 'new'
  data: T;                // 当前表单数据
  enabled?: boolean;      // 默认 true
  debounceMs?: number;    // 默认 1000
  version?: number;       // schema 版本号 (schema 改了就 ++)
}

interface DraftEnvelope<T> {
  v: number;
  savedAt: number;
  data: T;
}

export interface UseDraftAutosaveReturn<T> {
  hasDraft: boolean;
  lastSavedAt: number | null;
  saveDraft: (data?: T) => void;
  getDraft: () => T | null;
  clearDraft: () => void;
}

const PREFIX = 'aicms-draft:';

function makeKey(scope: string, id?: string | number) {
  return `${PREFIX}${scope}:${id ?? 'new'}`;
}

export function useDraftAutosave<T>({
  scope,
  id,
  data,
  enabled = true,
  debounceMs = 1000,
  version = 1,
}: UseDraftAutosaveOptions<T>): UseDraftAutosaveReturn<T> {
  const key = makeKey(scope, id);
  const [hasDraft, setHasDraft] = useState<boolean>(() => {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return false;
      const env = JSON.parse(raw) as DraftEnvelope<T>;
      return env.v === version;
    } catch {
      return false;
    }
  });
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(() => {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const env = JSON.parse(raw) as DraftEnvelope<T>;
      return env.v === version ? env.savedAt : null;
    } catch {
      return null;
    }
  });
  const timerRef = useRef<number | null>(null);
  const initialDataRef = useRef(data);
  const lastSerializedRef = useRef<string>(JSON.stringify(data));

  // 清除定时器
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        window.clearTimeout(timerRef.current);
      }
    };
  }, []);

  const saveDraft = useCallback(
    (override?: T) => {
      if (!enabled) return;
      try {
        const payload = override ?? data;
        const env: DraftEnvelope<T> = { v: version, savedAt: Date.now(), data: payload };
        localStorage.setItem(key, JSON.stringify(env));
        setHasDraft(true);
        setLastSavedAt(env.savedAt);
      } catch {
        // localStorage 满了或不可用, 静默
      }
    },
    [key, data, enabled, version],
  );

  const getDraft = useCallback((): T | null => {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const env = JSON.parse(raw) as DraftEnvelope<T>;
      if (env.v !== version) return null;
      return env.data;
    } catch {
      return null;
    }
  }, [key, version]);

  const clearDraft = useCallback(() => {
    try {
      localStorage.removeItem(key);
      setHasDraft(false);
      setLastSavedAt(null);
    } catch {
      // 静默
    }
  }, [key]);

  // 自动保存 (debounced)
  useEffect(() => {
    if (!enabled) return;
    // 跳过初次挂载时的 data (= initialData)
    const serialized = JSON.stringify(data);
    if (serialized === lastSerializedRef.current) return;
    lastSerializedRef.current = serialized;

    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
    }
    timerRef.current = window.setTimeout(() => {
      saveDraft();
    }, debounceMs);
  }, [data, debounceMs, enabled, saveDraft]);

  return { hasDraft, lastSavedAt, saveDraft, getDraft, clearDraft };
}

// 工具: 列出当前 scope 全部草稿 (调试用)
export function listAllDrafts(): Array<{ key: string; savedAt: number; preview: string }> {
  const out: Array<{ key: string; savedAt: number; preview: string }> = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k?.startsWith(PREFIX)) continue;
      const raw = localStorage.getItem(k);
      if (!raw) continue;
      const env = JSON.parse(raw) as DraftEnvelope<unknown>;
      out.push({ key: k, savedAt: env.savedAt, preview: JSON.stringify(env.data).slice(0, 60) });
    }
  } catch {
    // 静默
  }
  return out.sort((a, b) => b.savedAt - a.savedAt);
}