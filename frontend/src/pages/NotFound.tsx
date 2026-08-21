import { useNavigate } from 'react-router-dom';
import { Compass, Home } from 'lucide-react';
import { Button, Card, CardContent } from '@/components/ui';

/**
 * 404 兜底页 — 替代 `* → /` 静默重定向
 * 让用户知道"路径错了", 而不是莫名跳到工作区
 */
export function NotFoundPage() {
  const navigate = useNavigate();
  return (
    <div className="flex h-full min-h-[400px] items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardContent className="flex flex-col items-center gap-4 py-10 text-center">
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-muted text-muted-foreground">
            <Compass className="h-5 w-5" strokeWidth={1.5} />
          </div>
          <div className="space-y-1">
            <h2 className="text-base font-semibold">404 · 页面不存在</h2>
            <p className="text-[12px] text-muted-foreground">
              你访问的路径未匹配任何路由, 可能链接已失效。
            </p>
          </div>
          <code className="rounded bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
            {window.location.pathname}
          </code>
          <Button size="sm" onClick={() => navigate('/', { replace: true })}>
            <Home className="mr-1 h-3.5 w-3.5" />
            回到工作区
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
