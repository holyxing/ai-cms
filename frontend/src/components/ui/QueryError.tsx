import { AlertTriangle, RotateCcw, WifiOff, ShieldAlert, FileX2 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Button } from './Button';
import { Card, CardContent } from './Card';

/**
 * 统一错误展示 (P4.4)
 *
 * 用法:
 *   if (isError) return <QueryError error={error} onRetry={refetch} />;
 *
 * 根据 HTTP 状态自动选 icon + 文案:
 *   - 401 / 403  → 无权限
 *   - 404        → 数据不存在
 *   - 5xx / 网络 → 加载失败
 *   - 其他       → 通用错误
 */

interface Props {
  error: unknown;
  onRetry?: () => void;
  /** 上下文标签, 显示在 "加载 X 失败" (例: "加载站点列表失败") */
  context?: string;
  /** 自定义标题/描述/图标 (覆盖自动判断) */
  title?: string;
  description?: string;
  icon?: LucideIcon;
  className?: string;
}

function getErrorMeta(error: any, context?: string): { icon: LucideIcon; title: string; description: string } {
  // 优先看 HTTP 状态 (axios error.response.status)
  const status: number | undefined =
    error?.response?.status ?? error?.status ?? error?.code;
  const apiMessage: string | undefined = error?.response?.data?.message ?? error?.message;

  if (status === 401) {
    return {
      icon: ShieldAlert,
      title: '登录已过期',
      description: '请刷新页面重新登录。',
    };
  }
  if (status === 403) {
    return {
      icon: ShieldAlert,
      title: '无权限访问',
      description: '你没有查看此资源的权限, 请联系管理员。',
    };
  }
  if (status === 404) {
    return {
      icon: FileX2,
      title: '数据不存在',
      description: '该资源可能已被删除, 或链接已失效。',
    };
  }
  if (status === 422) {
    // P4.5 Bug Bash: 422 是参数校验错 (例: UUID 格式不对), 不应该说"不存在"
    return {
      icon: AlertTriangle,
      title: context ? `${context}失败` : '请求参数错误',
      description: apiMessage || '请求参数不符合要求, 请检查链接是否正确。',
    };
  }
  if (status === 0 || error?.code === 'ERR_NETWORK' || apiMessage?.includes('Network')) {
    return {
      icon: WifiOff,
      title: '网络连接失败',
      description: '无法连接到服务器, 请检查网络后重试。',
    };
  }
  if (status && status >= 500) {
    return {
      icon: AlertTriangle,
      title: '服务异常',
      description: '服务器内部错误, 已记录日志, 请稍后重试。',
    };
  }
  return {
    icon: AlertTriangle,
    title: context ? `${context}失败` : '加载失败',
    description: apiMessage || '请稍后重试, 或联系管理员。',
  };
}

export function QueryError({
  error,
  onRetry,
  context,
  title,
  description,
  icon,
  className,
}: Props) {
  const meta = getErrorMeta(error, context);
  const Icon = icon ?? meta.icon;
  return (
    <div className={`flex h-full min-h-[300px] items-center justify-center p-6 ${className ?? ''}`}>
      <Card className="w-full max-w-md">
        <CardContent className="flex flex-col items-center gap-4 py-10 text-center">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <Icon className="h-5 w-5" strokeWidth={1.5} />
          </div>
          <div className="space-y-1">
            <h3 className="text-base font-semibold">{title ?? meta.title}</h3>
            <p className="text-[12px] text-muted-foreground">{description ?? meta.description}</p>
          </div>
          {onRetry && (
            <Button size="sm" onClick={onRetry}>
              <RotateCcw className="mr-1 h-3.5 w-3.5" />
              重试
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
