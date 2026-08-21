import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';
import { Button, Card, CardContent } from '@/components/ui';

/**
 * 全局错误边界
 *
 * 捕获子树渲染错误, 防止整页白屏。
 * 用户可点 "重试" 重置 boundary, 或 "回到首页" 离开故障区。
 */
interface Props {
  children: ReactNode;
  /** 可选 fallback, 默认使用下方默认错误页 */
  fallback?: ReactNode;
  /** 错误时上报 (P5 接 Sentry 留口) */
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}
interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[ErrorBoundary]', error, errorInfo);
    this.props.onError?.(error, errorInfo);
  }

  reset = () => this.setState({ hasError: false, error: null });

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return <DefaultErrorFallback error={this.state.error} onRetry={this.reset} />;
    }
    return this.props.children;
  }
}

interface FallbackProps {
  error: Error | null;
  onRetry: () => void;
}

export function DefaultErrorFallback({ error, onRetry }: FallbackProps) {
  const isDev = import.meta.env.DEV;
  return (
    <div className="flex h-full min-h-[400px] items-center justify-center p-6">
      <Card className="w-full max-w-lg">
        <CardContent className="flex flex-col items-center gap-4 py-10 text-center">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <AlertTriangle className="h-5 w-5" strokeWidth={1.5} />
          </div>
          <div className="space-y-1">
            <h2 className="text-base font-semibold">出错了</h2>
            <p className="text-[12px] text-muted-foreground">
              页面渲染遇到意外, 已记录到控制台。
            </p>
          </div>
          {isDev && error && (
            <pre className="max-h-32 w-full overflow-auto rounded-md border bg-muted/30 p-3 text-left text-[10px] text-muted-foreground">
              {error.name}: {error.message}
              {'\n\n'}
              {error.stack?.split('\n').slice(0, 6).join('\n')}
            </pre>
          )}
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => window.location.href = '/'}>
              回到首页
            </Button>
            <Button size="sm" onClick={onRetry}>
              <RotateCcw className="mr-1 h-3.5 w-3.5" />
              重试
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
