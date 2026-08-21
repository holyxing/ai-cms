import { api } from './client';
import type { APIResponse } from '@/lib/utils';

export type NotificationLevel = 'success' | 'info' | 'warning' | 'error';

export interface ServerNotification {
  id: string;
  title: string;
  body: string | null;
  link: string | null;
  level: NotificationLevel;
  kind: string | null;
  duration_ms: number | null;
  read_at: string | null;
  created_at: string;
}

export interface NotificationListResult {
  items: ServerNotification[];
  total: number;
  page: number;
  page_size: number;
  unread_count: number;
}

export const notificationsApi = {
  async list(opts: {
    unread?: boolean;
    level?: NotificationLevel;
    page?: number;
    page_size?: number;
  } = {}) {
    const params = new URLSearchParams();
    if (opts.unread) params.set('unread', '1');
    if (opts.level) params.set('level', opts.level);
    if (opts.page) params.set('page', String(opts.page));
    if (opts.page_size) params.set('page_size', String(opts.page_size));
    const qs = params.toString();
    const r = await api.get<APIResponse<NotificationListResult>>(`/notifications${qs ? `?${qs}` : ''}`);
    return r.data.data ?? { items: [], total: 0, page: 1, page_size: 50, unread_count: 0 };
  },

  async markRead(id: string) {
    await api.patch(`/notifications/${id}/read`);
  },

  async markAllRead() {
    await api.post('/notifications/read-all');
  },

  async remove(id: string) {
    await api.delete(`/notifications/${id}`);
  },

  async clear() {
    await api.delete('/notifications');
  },
};
