import { cn } from '@/lib/utils';

function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('animate-pulse rounded-md bg-muted', className)}
      {...props}
    />
  );
}

/** 列表/表格 loading 占位: 多行 skeleton */
function SkeletonList({ rows = 5, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn('space-y-2 p-4', className)}>
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  );
}

/** 详情页 loading: 标题 + 元信息 + 段落 */
function SkeletonDetail() {
  return (
    <div className="space-y-4 p-6">
      <Skeleton className="h-7 w-2/3" />
      <div className="space-y-1.5">
        <Skeleton className="h-3 w-1/3" />
        <Skeleton className="h-3 w-1/4" />
      </div>
      <div className="space-y-2 pt-4">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
      </div>
    </div>
  );
}

/** 卡片 grid loading: 多张卡 */
function SkeletonCards({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className="h-32 w-full" />
      ))}
    </div>
  );
}

export { Skeleton, SkeletonList, SkeletonDetail, SkeletonCards };
