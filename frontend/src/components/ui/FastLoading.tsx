// P6.3 #21 加载分级 (FastLoading)
// 三档:
// - <FastSkeleton /> — 200ms 内不显示 (避免快查询的闪烁)
// - <InlineSpinner /> — 按钮/行内小 spinner (不阻断布局)
// - <ProgressBar /> — 进度条 (已用 NProgress, 这里补通用版)
//
// 设计原则: loading 状态应该"看不见比看得见更好"
// - <200ms: 不显示任何指示
// - 200ms-3s: 局部 skeleton 或 spinner
// - >3s: skeleton + 进度提示
import { useEffect, useState, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

const DEFAULT_DELAY_MS = 200;

interface FastLoadingProps {
  loading: boolean;
  /** 延迟显示 loading 状态的毫秒数, 默认 200 */
  delayMs?: number;
  /** skeleton 渲染函数 */
  children: ReactNode;
  /** 没显示 loading 时直接渲染 fallback (默认 children 自身) */
  fallback?: ReactNode;
}

/**
 * 智能 loading wrapper: loading=true 时, 延迟 delayMs 才显示 children (skeleton)
 * delayMs 内 loading 完成 → 直接显示内容, 不闪烁
 */
export function FastLoading({ loading, delayMs = DEFAULT_DELAY_MS, children, fallback }: FastLoadingProps) {
  const [showLoading, setShowLoading] = useState(false);
  useEffect(() => {
    if (!loading) {
      setShowLoading(false);
      return;
    }
    const t = window.setTimeout(() => setShowLoading(true), delayMs);
    return () => window.clearTimeout(t);
  }, [loading, delayMs]);

  if (loading && showLoading) {
    return <>{fallback ?? children}</>;
  }
  if (loading) {
    // 还没到 delay 阈值, 不显示 loading
    return <span style={{ visibility: 'hidden' }}>{children}</span>;
  }
  return <>{children}</>;
}

interface InlineSpinnerProps {
  size?: 'xs' | 'sm' | 'md';
  className?: string;
}

/** 按钮/行内小 spinner, 用 Loader2 (lucide-react) */
export function InlineSpinner({ size = 'sm', className }: InlineSpinnerProps) {
  const sizeClass = size === 'xs' ? 'h-3 w-3' : size === 'md' ? 'h-4 w-4' : 'h-3.5 w-3.5';
  return <Loader2 className={cn(sizeClass, 'animate-spin text-muted-foreground', className)} />;
}

/** 整页 spinner (中央, 适合全屏加载) */
export function PageSpinner({ label }: { label?: string }) {
  return (
    <div className="flex min-h-[400px] flex-col items-center justify-center gap-2 text-muted-foreground">
      <Loader2 className="h-6 w-6 animate-spin" />
      {label && <span className="text-[12px]">{label}</span>}
    </div>
  );
}