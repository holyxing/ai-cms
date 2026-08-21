// PublishStatusBadge.tsx - 发布状态 badge (P2.6)
// 依据: docs/06-设计系统.md (token 优先, 不用硬编码颜色)
// 状态: never_published / building / published / failed / out_of_sync

import { Badge } from './Badge';
import type { ReactNode } from 'react';

export type PublishStatus =
  | 'never_published'
  | 'building'
  | 'published'
  | 'failed'
  | 'out_of_sync'
  | string; // 兼容后端未来扩展

const META: Record<
  string,
  { label: string; variant: 'default' | 'outline' | 'muted' | 'success' | 'warning' | 'info' }
> = {
  never_published: { label: '未发布', variant: 'muted' },
  building: { label: '发布中', variant: 'info' },
  published: { label: '已发布', variant: 'success' },
  failed: { label: '发布失败', variant: 'warning' },
  out_of_sync: { label: '有更新', variant: 'outline' },
};

export function PublishStatusBadge({
  status,
  className,
}: {
  status: PublishStatus;
  className?: string;
}): ReactNode {
  const m = META[status] ?? META.never_published;
  return (
    <Badge variant={m.variant} className={className}>
      {m.label}
    </Badge>
  );
}
