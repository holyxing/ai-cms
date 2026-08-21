// Stats API (P6.1.2/3 + P6.4-A)
// Dashboard 趋势 + 时间序列 + 活动 + AI 摘要 + 内容健康度
import { api } from './client';
import type { APIResponse } from '@/lib/utils';

export interface TrendData {
  current: number;
  last_week: number;
  delta: number;
  trend: 'up' | 'down' | 'flat';
}

export interface Trends {
  contents: TrendData;
  pending: TrendData;
  sites: TrendData;
  deployments_30d: TrendData;
}

export interface DeploymentPoint {
  date: string;
  count: number;
}

// P6.4-A #3: 活动时间线 (合并: 内容发布 + 部署 + AI run)
export interface ActivityItem {
  type:
    | 'content_published'
    | 'deployment_success'
    | 'deployment_failed'
    | 'ai_run_success'
    | 'ai_run_failed';
  at: string | null;
  site_id: string | null;
  site_name: string | null;
  actor_name: string | null;
  payload: {
    content_id?: string;
    title?: string;
    deployment_id?: string;
    duration_ms?: number;
    content_count?: number;
    ai_run_id?: string;
    task_type?: string;
    model?: string;
    tokens?: number;
  };
}

export interface ActivityFeed {
  items: ActivityItem[];
  count: number;
}

// P6.4-A #7: AI 协作摘要
export interface AISummary {
  month: {
    runs: number;
    failed: number;
    tokens: number;
    estimated_minutes: number;
  };
  by_task_type: Array<{ task_type: string; count: number }>;
  all_time: {
    runs: number;
    tokens: number;
  };
}

// P6.4-A #8: 内容健康度
export interface ContentHealthItem {
  key: string;
  label: string;
  value: number;
  severity: 'info' | 'warning' | 'error';
  to: string;
}

export interface ContentHealth {
  items: ContentHealthItem[];
  total_issues: number;
}

export const statsApi = {
  async getTrends() {
    const r = await api.get<APIResponse<Trends>>('/stats/trends');
    return r.data.data!;
  },

  async getDeploymentSeries(days = 7) {
    const r = await api.get<APIResponse<{ days: number; series: DeploymentPoint[] }>>(
      `/stats/deployments?days=${days}`
    );
    return r.data.data!;
  },

  // P6.4-A #3
  async getActivity(limit = 20) {
    const r = await api.get<APIResponse<ActivityFeed>>(`/stats/activity?limit=${limit}`);
    return r.data.data!;
  },

  // P6.4-A #7
  async getAISummary() {
    const r = await api.get<APIResponse<AISummary>>('/stats/ai');
    return r.data.data!;
  },

  // P6.4-A #8
  async getContentHealth() {
    const r = await api.get<APIResponse<ContentHealth>>('/stats/content-health');
    return r.data.data!;
  },
};

// P6.4-A #4: 站点 pin 状态 (localStorage 持久化, 不走后端)
const PIN_KEY = 'aicms.pinned_sites.v1';

export const pinnedSitesStore = {
  list(): string[] {
    try {
      const raw = localStorage.getItem(PIN_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  },
  toggle(siteId: string): string[] {
    const cur = this.list();
    const next = cur.includes(siteId)
      ? cur.filter((id) => id !== siteId)
      : [...cur, siteId];
    localStorage.setItem(PIN_KEY, JSON.stringify(next));
    return next;
  },
  isPinned(siteId: string): boolean {
    return this.list().includes(siteId);
  },
};