/**
 * 居中 Modal (原生 <dialog> 实现)
 * - 不引第三方 UI 库
 * - 区别于 Drawer: 居中弹窗, 适合表单/预览场景
 * - Esc 自动关闭, backdrop 点击关闭
 */
import * as React from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  /** 最大宽度, 默认 560px */
  maxWidth?: string; // e.g. 'max-w-lg' | 'max-w-2xl'
  className?: string;
}

export const Modal: React.FC<ModalProps> = ({
  open,
  onClose,
  title,
  description,
  children,
  maxWidth = 'max-w-lg',
  className,
}) => {
  const ref = React.useRef<HTMLDialogElement>(null);

  React.useEffect(() => {
    const dlg = ref.current;
    if (!dlg) return;
    if (open && !dlg.open) dlg.showModal();
    if (!open && dlg.open) dlg.close();
  }, [open]);

  const onClick = (e: React.MouseEvent<HTMLDialogElement>) => {
    if (e.target === ref.current) onClose();
  };

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={onClick}
      className={cn(
        'fixed inset-0 m-auto h-fit bg-transparent p-0 backdrop:bg-black/40',
        'open:animate-[modal-in_160ms_ease-out]',
        'w-[calc(100vw-2rem)]',
        maxWidth,
        className,
      )}
    >
      <div className="rounded-lg border bg-background shadow-md">
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
        <div>{children}</div>
      </div>
    </dialog>
  );
};
