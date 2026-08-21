// SortableCard.tsx - Dashboard 卡片拖拽包装 (P6.5 #17)
//
// 把任意 dashboard 卡片包成可拖:
// - grip 手柄 (左侧 hover 显)
// - 拖动时半透明 + 上浮阴影
// - 拖动时整卡 transform, 不影响布局
// - column 数据透传到 useSortable, 跨栏 drop 拒收 (by checking data.column)

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import type { CardId } from '@/hooks/useDashboardLayout';

interface Props {
  id: CardId;
  column: 'left' | 'right';
  children: ReactNode;
  className?: string;
}

export function SortableCard({ id, column, children, className }: Props) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id,
    data: { column },
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'group/sortable relative',
        isDragging && 'z-10 opacity-60 shadow-lg ring-1 ring-primary/30 rounded-lg',
        className,
      )}
    >
      {/* grip 手柄: hover 卡片才显示 */}
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label="拖动重排"
        title="拖动重排"
        className={cn(
          'absolute -left-2 top-1/2 z-20 -translate-y-1/2',
          'flex h-7 w-5 items-center justify-center rounded-md',
          'bg-background border text-muted-foreground shadow-sm',
          'opacity-0 transition-opacity',
          'group-hover/sortable:opacity-100',
          'hover:text-foreground hover:bg-secondary cursor-grab active:cursor-grabbing',
          // 拖动时强制显示
          isDragging && 'opacity-100',
        )}
      >
        <GripVertical className="h-3.5 w-3.5" />
      </button>
      {children}
    </div>
  );
}