/** 发布入队后跟随 deployment，终态立刻刷新铃铛 */
import { publishApi } from '@/api/publish';
import { refreshNotifications } from '@/components/notifications/NotificationCenter';

export { refreshNotifications };

/** 发布入队后调用：轮询 job，终态后立刻刷新铃铛（并再补拉一次防竞态） */
export function watchDeploymentForNotifications(deploymentId: string | null | undefined): void {
  if (!deploymentId) return;
  let n = 0;
  const tick = async () => {
    try {
      const d = await publishApi.get(deploymentId);
      if (d.status === 'success' || d.status === 'failed' || d.status === 'cancelled') {
        await refreshNotifications();
        window.setTimeout(() => { void refreshNotifications(); }, 500);
        return;
      }
    } catch {
      /* 继续重试 */
    }
    if (++n < 100) window.setTimeout(() => { void tick(); }, 1200);
  };
  window.setTimeout(() => { void tick(); }, 600);
}
