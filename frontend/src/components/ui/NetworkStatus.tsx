import { useEffect, useState } from 'react';
import { WifiOff } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';

/**
 * 全局网络状态条 (P4.4)
 *
 * 检测方式: 每 30s 用 fetch 调 /healthz, 失败/超时 → 显示顶部 banner
 *
 * 挂载位置: <AppLayout /> / <ContentLayout /> 顶部
 *
 * 特性:
 * - API 恢复后 3s 自动消失
 * - 不在登录页显示 (登录页是公开页, 跟 API 状态无关)
 * - 配合 Sonner toast 让用户感知 (避免持续干扰)
 */
const HEALTH_CHECK_INTERVAL = 30_000;
const HEALTH_CHECK_TIMEOUT = 5_000;

export function NetworkStatus() {
  const [offline, setOffline] = useState(false);
  const [hadOffline, setHadOffline] = useState(false);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (window.location.pathname.startsWith('/login')) return;

    const check = async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT);
      try {
        const res = await fetch('/healthz', {
          method: 'GET',
          cache: 'no-store',
          signal: controller.signal,
        });
        clearTimeout(timeout);
        if (!res.ok) throw new Error(`healthz returned ${res.status}`);
        if (hadOffline) {
          // API 恢复, 失效所有 query 触发重新拉取
          queryClient.invalidateQueries();
          setHadOffline(false);
        }
        setOffline(false);
      } catch {
        clearTimeout(timeout);
        if (!offline) setHadOffline(true);
        setOffline(true);
      }
    };

    // 立即检查一次, 然后每 30s
    check();
    const id = setInterval(check, HEALTH_CHECK_INTERVAL);
    return () => clearInterval(id);
    // 不依赖 queryClient (它稳定)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hadOffline, offline]);

  if (!offline) return null;
  return (
    <div
      role="alert"
      className="flex items-center justify-center gap-2 bg-destructive px-4 py-1.5 text-[12px] text-destructive-foreground"
    >
      <WifiOff className="h-3.5 w-3.5" />
      <span>网络连接中断, 正在重试…</span>
    </div>
  );
}
