// P6.2 #14: 全局键盘快捷键 Provider
// 用 react-hotkeys-hook (轻量, 3KB)
//
// 全局快捷键 (P6.2):
// - /         聚焦顶部搜索框 (如果有)
// - ?         打开快捷键帮助面板
// - Esc       关闭最顶层 Modal/Drawer/CommandPalette
// - g + d/s/c 连续键 → 跳 dashboard / sites / contents
// - ⌘K / Ctrl+K  全局搜索面板 (复用 P3 已有 ⌘K)
//
// 各页可注册自己的快捷键 (e.g. ContentsPage 的 'c' = 新建文章)
import { useEffect, useState, type ReactNode } from 'react';
import { useHotkeys } from 'react-hotkeys-hook';
import { useNavigate } from 'react-router-dom';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui';
import { Keyboard, X } from 'lucide-react';

interface ShortcutItem {
  keys: string;
  desc: string;
  scope?: string;
}

const GLOBAL_SHORTCUTS: ShortcutItem[] = [
  { keys: '/', desc: '聚焦搜索框' },
  { keys: '⌘ K / Ctrl K', desc: '打开全局搜索面板' },
  { keys: '?', desc: '打开快捷键帮助 (本面板)' },
  { keys: 'Esc', desc: '关闭弹窗' },
  { keys: 'g d', desc: '跳到 Dashboard' },
  { keys: 'g s', desc: '跳到 Sites' },
  { keys: 'g c', desc: '跳到 Contents' },
  { keys: 'g t', desc: '跳到 Themes' },
  { keys: 'g l', desc: '跳到 Layouts' },
  { keys: 'g p', desc: '跳到 Publish' },
];

export function ShortcutsProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [helpOpen, setHelpOpen] = useState(false);

  // ? → 帮助
  useHotkeys(
    'shift+/',
    (e) => {
      e.preventDefault();
      setHelpOpen((v) => !v);
    },
    { enableOnFormTags: false },
  );

  // / → 聚焦搜索框
  useHotkeys(
    'slash',
    (e) => {
      // 跳过已经在 input/textarea 里输入的情况
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea') return;
      e.preventDefault();
      const search = document.querySelector<HTMLInputElement>('input[data-shortcut="global-search"]');
      if (search) {
        search.focus();
        search.select();
      }
    },
    { enableOnFormTags: false },
  );

  // g + d/s/c/t/l/p → 跳 (序列键用 > 分隔)
  useHotkeys(
    'g>d',
    () => navigate('/dashboard'),
    { enableOnFormTags: false },
  );
  useHotkeys('g>s', () => navigate('/sites'), { enableOnFormTags: false });
  useHotkeys('g>c', () => navigate('/contents'), { enableOnFormTags: false });
  useHotkeys('g>t', () => navigate('/themes'), { enableOnFormTags: false });
  useHotkeys('g>l', () => navigate('/layouts'), { enableOnFormTags: false });
  useHotkeys('g>p', () => navigate('/publish'), { enableOnFormTags: false });

  return (
    <>
      {children}
      <ShortcutsHelpModal open={helpOpen} onClose={() => setHelpOpen(false)} />
    </>
  );
}

function ShortcutsHelpModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  // Esc 关闭 (Modal 自己有, 这里兜底)
  useHotkeys(
    'escape',
    () => onClose(),
    { enableOnFormTags: true, enabled: open },
  );
  return (
    <Modal open={open} onClose={onClose} maxWidth="max-w-lg" className="overflow-hidden p-0">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <Keyboard className="h-4 w-4 text-primary" />
          <h2 className="text-[13px] font-semibold">键盘快捷键</h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md p-1 text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="p-4">
        <p className="mb-3 text-[11px] text-muted-foreground">
          全平台通用快捷键 — 点击 <kbd className="rounded border bg-secondary px-1 font-mono text-[10px]">?</kbd> 随时打开本面板
        </p>
        <div className="space-y-1">
          {GLOBAL_SHORTCUTS.map((s) => (
            <div
              key={s.keys}
              className="flex items-center justify-between rounded-md px-2 py-1.5 hover:bg-secondary/40"
            >
              <span className="text-[12px] text-foreground/80">{s.desc}</span>
              <div className="flex items-center gap-1">
                {s.keys.split(' ').map((k, j) => (
                  <kbd
                    key={j}
                    className="rounded border border-border bg-secondary px-1.5 py-0.5 font-mono text-[10.5px] text-foreground/70 shadow-sm"
                  >
                    {k}
                  </kbd>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="flex justify-end border-t px-4 py-2.5">
        <Button size="sm" variant="outline" onClick={onClose}>关闭</Button>
      </div>
    </Modal>
  );
}

// 给 ⌘K command palette 触发 (Settings 文档用)
export { GLOBAL_SHORTCUTS };