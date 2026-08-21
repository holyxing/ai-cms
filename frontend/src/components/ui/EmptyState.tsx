import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  secondaryAction?: React.ReactNode;  // P6.1.1: 第二按钮 (e.g. "导入" + "新建")
  size?: 'sm' | 'md' | 'lg';  // P6.1.1: sm=列表 inline, md=卡片, lg=全页 hero
  variant?: 'default' | 'dashed' | 'plain';  // P6.1.1: 边框样式
  className?: string;
}

const SIZE_MAP = {
  sm: { wrapper: 'py-6 px-4', iconBox: 'h-8 w-8', icon: 'h-4 w-4', title: 'text-[13px]' },
  md: { wrapper: 'py-10 px-6', iconBox: 'h-10 w-10', icon: 'h-5 w-5', title: 'text-sm' },
  lg: { wrapper: 'py-16 px-8', iconBox: 'h-14 w-14', icon: 'h-7 w-7', title: 'text-base' },
} as const;

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  secondaryAction,
  size = 'md',
  variant = 'dashed',
  className,
}: EmptyStateProps) {
  const s = SIZE_MAP[size];
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-lg text-center',
        variant === 'dashed' && 'border border-dashed',
        variant === 'default' && 'border bg-card',
        variant === 'plain' && '',
        s.wrapper,
        className,
      )}
    >
      {Icon && (
        <div
          className={cn(
            'mb-3 flex items-center justify-center rounded-lg bg-muted text-muted-foreground',
            s.iconBox,
          )}
        >
          <Icon className={s.icon} strokeWidth={1.5} />
        </div>
      )}
      <h3 className={cn('font-semibold', s.title)}>{title}</h3>
      {description && (
        <p className="mt-1 max-w-md text-xs text-muted-foreground">{description}</p>
      )}
      {(action || secondaryAction) && (
        <div className="mt-4 flex items-center gap-2">
          {action}
          {secondaryAction}
        </div>
      )}
    </div>
  );
}