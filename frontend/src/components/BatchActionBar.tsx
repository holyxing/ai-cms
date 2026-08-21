// BatchActionBar.tsx - 表格底部批量操作条 (P6.2 #16)
//
// 浮在表格底部, 显示已选 N 项 + 动作按钮 (configurable)
// 用法:
//   <BatchActionBar
//     count={selectedIds.length}
//     onClear={() => setSelected([])}
//     actions={[
//       { key: 'publish', label: '批量发布', icon: Rocket, tone: 'primary',
//         onAction: () => doBatch('publish'), confirm: true, confirmMessage: '...' },
//       ...
//     ]}
//   />

import { Loader2, X } from 'lucide-react';
import { useState } from 'react';
import type { ComponentType } from 'react';
import { cn } from '@/lib/utils';

interface BatchAction {
  key: string;
  label: string;
  icon?: ComponentType<{ className?: string }>;
  tone?: 'primary' | 'destructive' | 'secondary';
  onAction: () => void | Promise<unknown>;
  confirm?: boolean;            // 点击时弹确认
  confirmMessage?: string;      // 确认文案
  confirmDestructive?: boolean; // 红色确认按钮
}

interface Props {
  count: number;
  onClear: () => void;
  actions: BatchAction[];
  className?: string;
}

export function BatchActionBar({ count, onClear, actions, className }: Props) {
  const [pending, setPending] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<BatchAction | null>(null);

  if (count === 0) return null;

  const toneClass = (tone?: BatchAction['tone']) => {
    switch (tone) {
      case 'primary':
        return 'bg-primary text-primary-foreground hover:bg-primary/90';
      case 'destructive':
        return 'bg-red-600 text-white hover:bg-red-700';
      default:
        return 'bg-background border text-foreground hover:bg-secondary';
    }
  };

  const handleClick = async (a: BatchAction) => {
    if (a.confirm && !confirm) {
      setConfirm(a);
      return;
    }
    setConfirm(null);
    setPending(a.key);
    try {
      await a.onAction();
    } finally {
      setPending(null);
    }
  };

  return (
    <>
      <div className={cn(
        'fixed bottom-4 left-1/2 z-40 -translate-x-1/2',
        'flex items-center gap-2 rounded-lg border bg-popover shadow-md ring-1 ring-border',
        'px-3 py-2',
        className,
      )}>
        <span className="text-xs text-muted-foreground">
          已选 <strong className="font-semibold tabular-nums text-foreground">{count}</strong> 项
        </span>
        <div className="mx-1 h-4 w-px bg-border" />
        {actions.map((a) => {
          const isPending = pending === a.key;
          const Icon = a.icon;
          return (
            <button
              key={a.key}
              type="button"
              onClick={() => handleClick(a)}
              disabled={pending !== null}
              className={cn(
                'flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors',
                'disabled:cursor-not-allowed disabled:opacity-50',
                toneClass(a.tone),
              )}
            >
              {isPending ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : Icon ? (
                <Icon className="h-3 w-3" />
              ) : null}
              {a.label}
            </button>
          );
        })}
        <div className="mx-1 h-4 w-px bg-border" />
        <button
          type="button"
          onClick={onClear}
          disabled={pending !== null}
          className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"
          aria-label="取消选择"
          title="取消选择"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* 确认弹窗 (浏览器原生 confirm, 简单) */}
      {confirm && (
        <ConfirmDialogInline
          action={confirm}
          onCancel={() => setConfirm(null)}
          onConfirm={() => handleClick({ ...confirm, confirm: false })}
        />
      )}
    </>
  );
}

// 简单内嵌确认 (不引入 Modal, 保持轻量)
function ConfirmDialogInline({
  action,
  onCancel,
  onConfirm,
}: {
  action: BatchAction;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onCancel}>
      <div
        className="w-full max-w-md rounded-lg border bg-popover p-5 shadow-md ring-1 ring-border"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-sm font-semibold">确认 {action.label}</h3>
        <p className="mt-2 text-[13px] text-muted-foreground">
          {action.confirmMessage || '确定要执行此操作吗?'}
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="h-8 rounded-md border px-3 text-xs font-medium hover:bg-secondary"
          >
            取消
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={cn(
              'h-8 rounded-md px-3 text-xs font-medium text-white',
              action.confirmDestructive ? 'bg-red-600 hover:bg-red-700' : 'bg-primary text-primary-foreground hover:bg-primary/90',
            )}
          >
            {action.label}
          </button>
        </div>
      </div>
    </div>
  );
}