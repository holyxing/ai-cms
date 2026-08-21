import { Skeleton, SkeletonList, SkeletonDetail, SkeletonCards } from './Skeleton';

/**
 * 统一 loading 占位 (P4.4)
 *
 * 用法:
 *   if (isLoading) return <QueryLoading variant="cards" count={6} />;
 *   if (isError) return <QueryError error={error} onRetry={refetch} />;
 *
 * 5 种变体:
 *   - "list"    列表 (5 行, 表格/列表)
 *   - "cards"   卡片网格 (3x2 卡片)
 *   - "detail"  详情 (标题 + 元信息 + 段落)
 *   - "rows"    简单行 (SkeletonList rows=N)
 *   - "block"   单个块 (Skeleton 占位)
 */
export type QueryLoadingVariant = 'list' | 'cards' | 'detail' | 'rows' | 'block';

interface Props {
  variant?: QueryLoadingVariant;
  count?: number;
  className?: string;
}

export function QueryLoading({ variant = 'list', count = 5, className }: Props) {
  switch (variant) {
    case 'cards':
      return <SkeletonCards count={count} />;
    case 'detail':
      return <SkeletonDetail />;
    case 'rows':
      return <SkeletonList rows={count} className={className} />;
    case 'block':
      return <Skeleton className={className ?? 'h-32 w-full'} />;
    case 'list':
    default:
      return <SkeletonList rows={count} className={className} />;
  }
}
