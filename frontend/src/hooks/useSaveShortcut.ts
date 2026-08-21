// useSaveShortcut.ts - ⌘S / Ctrl+S 全局保存快捷键 (P3.6.2)
//
// 用法:
//   useSaveShortcut({ onSave: () => form.submit(), enabled: dirty });
//
// 行为:
//   - Mac: ⌘ + S
//   - Win/Linux: Ctrl + S
//   - 输入框聚焦时也生效 (override 浏览器默认的保存网页)
//   - enabled=false 时不响应
//   - 自动解绑 (useEffect cleanup)
import { useEffect } from 'react';

export interface UseSaveShortcutOptions {
  onSave: () => void;
  enabled?: boolean;
  /** 阻止默认行为 (默认 true, 避免 "保存网页" 弹窗) */
  preventDefault?: boolean;
}

export function useSaveShortcut({ onSave, enabled = true, preventDefault = true }: UseSaveShortcutOptions) {
  useEffect(() => {
    if (!enabled) return;
    const handler = (e: KeyboardEvent) => {
      // ⌘S (mac) 或 Ctrl+S (其他)
      if ((e.metaKey || e.ctrlKey) && e.key === 's' && !e.shiftKey && !e.altKey) {
        if (preventDefault) e.preventDefault();
        onSave();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onSave, enabled, preventDefault]);
}
