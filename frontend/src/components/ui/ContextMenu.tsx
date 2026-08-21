// ContextMenu.tsx - 通用右键菜单 (P2.8 D2)
// 依据: docs/17-站点树重构.md §5.4
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';

export interface MenuItem {
  /** 唯一 key */
  key: string;
  /** 标签 */
  label: string;
  /** 图标 (lucide) */
  icon?: React.ComponentType<{ className?: string; strokeWidth?: number | string }>;
  /** 快捷键提示 */
  shortcut?: string;
  /** 危险项 (红色) */
  danger?: boolean;
  /** 分隔线 */
  divider?: boolean;
  /** 禁用 */
  disabled?: boolean;
  /** 点击 */
  onClick?: () => void;
}

interface Props {
  open: boolean;
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}

export function ContextMenu({ open, x, y, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [adjusted, setAdjusted] = useState({ x, y });

  // 边界检测: 防止菜单超出视口
  useEffect(() => {
    if (!open || !ref.current) {
      setAdjusted({ x, y });
      return;
    }
    const el = ref.current;
    const rect = el.getBoundingClientRect();
    let nx = x;
    let ny = y;
    if (x + rect.width > window.innerWidth - 8) {
      nx = window.innerWidth - rect.width - 8;
    }
    if (y + rect.height > window.innerHeight - 8) {
      ny = window.innerHeight - rect.height - 8;
    }
    setAdjusted({ x: Math.max(8, nx), y: Math.max(8, ny) });
  }, [open, x, y, items]);

  // 点外面 / Esc 关闭
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      ref={ref}
      role="menu"
      style={{ position: 'fixed', top: adjusted.y, left: adjusted.x, zIndex: 9999 }}
      className="min-w-[180px] rounded-md border border-border bg-popover p-1 shadow-md ring-1 ring-border"
    >
      {items.map((item) => {
        if (item.divider) {
          return <div key={item.key} className="my-1 h-px bg-border" />;
        }
        const Icon = item.icon;
        return (
          <button
            key={item.key}
            role="menuitem"
            disabled={item.disabled}
            onClick={() => {
              if (item.disabled) return;
              item.onClick?.();
              onClose();
            }}
            className={cn(
              'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-[12px] transition-colors',
              item.disabled
                ? 'cursor-not-allowed text-muted-foreground/50'
                : item.danger
                  ? 'text-destructive hover:bg-destructive/10'
                  : 'text-foreground hover:bg-secondary/80',
            )}
          >
            {Icon && <Icon className="h-3.5 w-3.5 flex-shrink-0" strokeWidth={2} />}
            <span className="flex-1 truncate">{item.label}</span>
            {item.shortcut && (
              <span className="text-[10px] text-muted-foreground">{item.shortcut}</span>
            )}
          </button>
        );
      })}
    </div>,
    document.body
  );
}
