// P6.3 通知中心：铃铛抽屉 + 服务端同步
import { create } from 'zustand';
import { Bell, Check, Info, AlertCircle, AlertTriangle, X, ExternalLink } from 'lucide-react';
import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { notificationsApi, type NotificationLevel } from '@/api/notifications';

export interface NotificationItem {
  id: string;
  level: NotificationLevel;
  title: string;
  description?: string;
  href?: string;
  kind?: string | null;
  duration_ms?: number | null;
  createdAt: number;
  read: boolean;
}

interface NotificationStore {
  items: NotificationItem[];
  unreadCount: number;
  hydrate: (items: NotificationItem[], unreadCount?: number) => void;
  markRead: (id: string) => void;
  markAllRead: () => void;
  clear: () => void;
  remove: (id: string) => void;
}

function mapServer(r: {
  id: string;
  title: string;
  body: string | null;
  link: string | null;
  level?: string;
  kind?: string | null;
  duration_ms?: number | null;
  read_at: string | null;
  created_at: string;
}): NotificationItem {
  const level = (r.level || 'info') as NotificationLevel;
  return {
    id: r.id,
    level: ['success', 'info', 'warning', 'error'].includes(level) ? level : 'info',
    title: r.title,
    description: r.body ?? undefined,
    href: r.link ?? undefined,
    kind: r.kind,
    duration_ms: r.duration_ms,
    createdAt: new Date(r.created_at).getTime(),
    read: !!r.read_at,
  };
}

/** 供 notificationsSync 等外部模块复用 */
export const mapServerNotification = mapServer;

export const useNotificationStore = create<NotificationStore>()((set) => ({
  items: [],
  unreadCount: 0,
  hydrate: (items, unreadCount) =>
    set({
      items,
      unreadCount: unreadCount ?? items.filter((i) => !i.read).length,
    }),
  markRead: (id) =>
    set((s) => {
      const items = s.items.map((it) => (it.id === id ? { ...it, read: true } : it));
      return { items, unreadCount: items.filter((i) => !i.read).length };
    }),
  markAllRead: () =>
    set((s) => ({
      items: s.items.map((it) => ({ ...it, read: true })),
      unreadCount: 0,
    })),
  clear: () => set({ items: [], unreadCount: 0 }),
  remove: (id) =>
    set((s) => {
      const items = s.items.filter((it) => it.id !== id);
      return { items, unreadCount: items.filter((i) => !i.read).length };
    }),
}));

const levelIcon = {
  success: { Icon: Check, color: 'text-emerald-600 bg-emerald-50' },
  info: { Icon: Info, color: 'text-blue-600 bg-blue-50' },
  warning: { Icon: AlertTriangle, color: 'text-amber-600 bg-amber-50' },
  error: { Icon: AlertCircle, color: 'text-red-600 bg-red-50' },
} as const;

function timeAgo(ts: number): string {
  const sec = Math.floor((Date.now() - ts) / 1000);
  if (sec < 60) return '刚刚';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} 分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 小时前`;
  return `${Math.floor(hr / 24)} 天前`;
}

function fmtDuration(ms?: number | null): string | null {
  if (ms == null || ms < 0) return null;
  const sec = ms / 1000;
  return sec < 10 ? `${sec.toFixed(1)} 秒` : `${Math.round(sec)} 秒`;
}

/** 供外部（发布完成等）主动刷新铃铛 */
export async function refreshNotifications(): Promise<void> {
  try {
    const data = await notificationsApi.list({ page: 1, page_size: 30 });
    useNotificationStore.getState().hydrate(
      data.items.map(mapServer),
      data.unread_count,
    );
  } catch {
    /* 忽略 */
  }
}

export function NotificationCenter() {
  const items = useNotificationStore((s) => s.items);
  const unread = useNotificationStore((s) => s.unreadCount);
  const markAllReadLocal = useNotificationStore((s) => s.markAllRead);
  const clearLocal = useNotificationStore((s) => s.clear);
  const markReadLocal = useNotificationStore((s) => s.markRead);
  const removeLocal = useNotificationStore((s) => s.remove);
  const [open, setOpen] = useState(false);

  const refresh = useCallback(() => {
    void refreshNotifications();
  }, []);

  useEffect(() => {
    refresh();
    const tick = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    const t = window.setInterval(tick, 3000);
    const onVis = () => { if (document.visibilityState === 'visible') refresh(); };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.clearInterval(t);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [refresh]);

  useEffect(() => {
    if (open) refresh();
  }, [open, refresh]);

  const markRead = (id: string) => {
    markReadLocal(id);
    notificationsApi.markRead(id).catch(() => {});
  };
  const markAllRead = () => {
    markAllReadLocal();
    notificationsApi.markAllRead().catch(() => {});
  };
  const remove = (id: string) => {
    removeLocal(id);
    notificationsApi.remove(id).catch(() => {});
  };
  const clear = () => {
    clearLocal();
    notificationsApi.clear().catch(() => {});
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="relative flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
        aria-label={`通知 ${unread} 条未读`}
      >
        <Bell className="h-4 w-4" />
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-md bg-red-500 px-1 text-[10px] font-semibold leading-none text-white">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-10 z-50 flex max-h-[480px] w-80 flex-col rounded-md border bg-popover text-popover-foreground shadow-md">
            <div className="flex items-center justify-between border-b px-3 py-2">
              <h3 className="text-[13px] font-semibold">消息</h3>
              <div className="flex items-center gap-1">
                {unread > 0 && (
                  <button
                    type="button"
                    onClick={markAllRead}
                    className="text-[10.5px] text-muted-foreground hover:text-foreground"
                  >
                    全部已读
                  </button>
                )}
                {items.length > 0 && (
                  <button
                    type="button"
                    onClick={clear}
                    className="text-[10.5px] text-muted-foreground hover:text-foreground"
                  >
                    清空
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded p-0.5 text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
                  aria-label="关闭"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto">
              {items.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-2 py-12 text-muted-foreground">
                  <Bell className="h-6 w-6 opacity-30" />
                  <span className="text-[12px]">暂无消息</span>
                </div>
              ) : (
                <ul className="divide-y">
                  {items.map((n) => {
                    const { Icon, color } = levelIcon[n.level] || levelIcon.info;
                    const dur = fmtDuration(n.duration_ms);
                    return (
                      <li
                        key={n.id}
                        className={cn(
                          'group flex items-start gap-2.5 border-l-2 px-3 py-2.5 transition-colors hover:bg-secondary/40',
                          n.read
                            ? 'border-l-transparent'
                            : 'border-l-primary bg-blue-50',
                        )}
                      >
                        <div className={cn('flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md', color)}>
                          <Icon className="h-3.5 w-3.5" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline justify-between gap-1">
                            <span className="flex min-w-0 items-center gap-1.5">
                              {!n.read && (
                                <span
                                  className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-primary"
                                  aria-hidden
                                />
                              )}
                              <span
                                className={cn(
                                  'truncate text-[12px]',
                                  n.read
                                    ? 'font-normal text-muted-foreground'
                                    : 'font-semibold text-foreground',
                                )}
                              >
                                {n.title}
                              </span>
                            </span>
                            <button
                              type="button"
                              onClick={() => remove(n.id)}
                              className="invisible flex-shrink-0 rounded p-0.5 text-muted-foreground hover:bg-secondary/80 hover:text-foreground group-hover:visible"
                              aria-label="删除"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </div>
                          {n.description && (
                            <p
                              className={cn(
                                'mt-0.5 line-clamp-3 whitespace-pre-line text-[11px]',
                                n.read ? 'text-muted-foreground/70' : 'text-muted-foreground',
                              )}
                            >
                              {n.description}
                            </p>
                          )}
                          <div className="mt-0.5 flex items-center justify-between gap-1">
                            <span className="text-[10px] text-muted-foreground/70">
                              {timeAgo(n.createdAt)}
                              {dur ? ` · ${dur}` : ''}
                            </span>
                            {n.href && (
                              <Link
                                to={n.href}
                                onClick={() => { markRead(n.id); setOpen(false); }}
                                className="inline-flex items-center gap-0.5 text-[10px] font-medium text-primary hover:underline"
                              >
                                查看
                                <ExternalLink className="h-2.5 w-2.5" />
                              </Link>
                            )}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
            <div className="flex items-center justify-between border-t px-3 py-2">
              <span className="text-[10.5px] text-muted-foreground">
                {items.length} 条 · 未读 {unread}
              </span>
              <Link
                to="/notifications"
                onClick={() => setOpen(false)}
                className="text-[11px] font-medium text-primary hover:underline"
              >
                管理我的消息
              </Link>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
