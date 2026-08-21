/**
 * 原生 <dialog> 实现的右侧抽屉
 * - 不引第三方 UI 库
 * - Esc 自动关闭 (浏览器默认)
 * - 背景遮罩 + 滑入动画 (CSS only)
 */
import * as React from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  width?: string; // 默认 w-[420px]
  className?: string;
}

export const Drawer: React.FC<DrawerProps> = ({
  open,
  onClose,
  title,
  description,
  children,
  width = 'w-[420px]',
  className,
}) => {
  const ref = React.useRef<HTMLDialogElement>(null);

  React.useEffect(() => {
    const dlg = ref.current;
    if (!dlg) return;
    if (open && !dlg.open) dlg.showModal();
    if (!open && dlg.open) dlg.close();
  }, [open]);

  // 拦截 backdrop 点击 (浏览器原生 dialog 点击外部不会关, 自己加)
  const onClick = (e: React.MouseEvent<HTMLDialogElement>) => {
    if (e.target === ref.current) onClose();
  };

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={onClick}
      className={cn(
        'fixed inset-0 m-0 ml-auto h-screen max-h-screen',
        'bg-transparent p-0 backdrop:bg-black/40',
        'open:animate-[drawer-in_200ms_ease-out]',
        width,
        className,
      )}
    >
      <div className="flex h-full flex-col border-l bg-background shadow-md">
        {(title || description) && (
          <div className="flex items-start gap-2 border-b px-4 py-3">
            <div className="flex-1 min-w-0">
              {title && <h2 className="text-sm font-semibold leading-tight">{title}</h2>}
              {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-secondary hover:text-foreground"
              aria-label="关闭"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
        <div className="flex-1 overflow-y-auto">{children}</div>
      </div>
    </dialog>
  );
};
