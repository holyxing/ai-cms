// publish.ts - 发布相关 API (P2)
import { api } from './client';
import type { Paginated } from '@/lib/utils';

export type DeploymentStatus = 'pending' | 'building' | 'success' | 'failed' | 'cancelled';
export type TriggeredBy = 'manual' | 'scheduled' | 'api' | 'rollback';

export interface Deployment {
  id: string;
  site_id: string;
  theme_version_id: string | null;
  status: DeploymentStatus;
  triggered_by: TriggeredBy;
  trigger_user_id: string | null;
  started_at: string | null;
  finished_at: string | null;
  duration_ms: number | null;
  content_count: number | null;
  artifact_path: string | null;
  artifact_size: number | null;
  build_log: string | null;
  retry_count: number;
  error_message: string | null;
  created_at: string;
}

export interface DeploymentListItem {
  id: string;
  status: DeploymentStatus;
  triggered_by: TriggeredBy;
  duration_ms: number | null;
  content_count: number | null;
  artifact_size: number | null;
  retry_count: number;
  error_message: string | null;
  created_at: string;
  finished_at: string | null;
  scope: string;
  scope_id: string | null;
}

export interface DeploymentJobAccepted {
  deployment_id: string;
  status: DeploymentStatus;
  message: string;
}

export interface RecentDeploymentItem {
  id: string;
  site_id: string;
  site_slug: string;
  site_name: string;
  status: string;
  triggered_by: string;
  duration_ms: number | null;
  content_count: number | null;
  artifact_size: number | null;
  // P3.9.6+ (holy 反馈 #12565): 该站首个根栏目 ID, 用于点击卡片直接跳 /c/{root_category_id}
  root_category_id: string | null;
  created_at: string;
  finished_at: string | null;
}

export const publishApi = {
  // P3.9.5+ (holy 反馈): 跨站最近发布 (Dashboard top3 卡片用)
  recent: async (limit: number = 3, siteId?: string) => {
    const params: any = { limit };
    if (siteId) params.site_id = siteId;
    const { data } = await api.get<{ data: { items: RecentDeploymentItem[]; total: number } }>(
      `/deployments/recent`,
      { params },
    );
    return data.data;
  },
  trigger: async (siteId: string, params: { triggered_by?: TriggeredBy; theme_version_id?: string; force?: boolean } = {}) => {
    const { data } = await api.post<{ data: DeploymentJobAccepted; message?: string; code?: number }>(
      `/sites/${siteId}/publish`,
      params,
      { _skipToast: true } as any,  // P3.6+ publish 自己处理 toast
    );
    // axios 拦截器把 HTTP 4xx 改成 { data: null }，这里必须抛错，否则 onSuccess 会读 null.message
    if (!data.data) {
      const err: any = new Error(data.message || '触发失败');
      err.response = { data, status: typeof data.code === 'number' ? data.code : 400 };
      throw err;
    }
    return data.data;
  },
  list: async (siteId: string, params: { status?: string; page?: number; page_size?: number } = {}) => {
    const { data } = await api.get<Paginated<DeploymentListItem>>(
      `/sites/${siteId}/publish/jobs`,
      { params }
    );
    return data;
  },
  get: async (deploymentId: string) => {
    const { data } = await api.get<{ data: Deployment }>(`/publish/jobs/${deploymentId}`);
    return data.data;
  },
  rollback: async (siteId: string, targetDeploymentId: string, changeNote?: string) => {
    const { data } = await api.post<{ data: Deployment; message: string }>(
      `/sites/${siteId}/publish/rollback`,
      { target_deployment_id: targetDeploymentId, change_note: changeNote }
    );
    return data;
  },
};
