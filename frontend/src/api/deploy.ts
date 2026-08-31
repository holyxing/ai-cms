// deploy.ts - 远程 SSH 部署配置
import { api } from './client';
import type { APIResponse } from '@/lib/utils';

export interface DeployServer {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  auth_type: 'pem' | 'password';
  private_key_path: string | null;
  remote_base_path: string;
  is_default: boolean;
  has_password: boolean;
  has_private_key: boolean;
}

export interface DeployServerCreatePayload {
  name: string;
  host: string;
  port?: number;
  username: string;
  auth_type: 'pem' | 'password';
  password?: string;
  private_key?: string;
  private_key_path?: string;
  remote_base_path?: string;
  is_default?: boolean;
}

export interface SiteRemoteDeployConfig {
  enabled: boolean;
  server_id: string | null;
  remote_path: string | null;
}

export const deployApi = {
  listServers: async (): Promise<DeployServer[]> => {
    const r = await api.get<APIResponse<{ items: DeployServer[]; total: number }>>('/deploy-servers');
    return r.data.data?.items ?? [];
  },

  createServer: async (payload: DeployServerCreatePayload): Promise<DeployServer> => {
    const r = await api.post<APIResponse<DeployServer>>('/deploy-servers', payload);
    return r.data.data!;
  },

  updateServer: async (id: string, payload: Partial<DeployServerCreatePayload>): Promise<DeployServer> => {
    const r = await api.patch<APIResponse<DeployServer>>(`/deploy-servers/${id}`, payload);
    return r.data.data!;
  },

  deleteServer: async (id: string): Promise<void> => {
    await api.delete(`/deploy-servers/${id}`);
  },

  testServer: async (id: string): Promise<{ ok: boolean; duration_ms: number; log: string }> => {
    const r = await api.post<APIResponse<{ ok: boolean; duration_ms: number; log: string }>>(
      `/deploy-servers/${id}/test`,
      {},
    );
    return r.data.data!;
  },

  getSiteConfig: async (siteId: string) => {
    const r = await api.get<APIResponse<{
      config: SiteRemoteDeployConfig;
      resolved_server: DeployServer | null;
      remote_path_preview: string | null;
    }>>(`/sites/${siteId}/remote-deploy`);
    return r.data.data!;
  },

  updateSiteConfig: async (siteId: string, config: SiteRemoteDeployConfig) => {
    const r = await api.put<APIResponse<SiteRemoteDeployConfig>>(
      `/sites/${siteId}/remote-deploy`,
      config,
    );
    return r.data.data!;
  },

  syncNow: async (siteId: string, deleteExtraneous = false) => {
    const r = await api.post<APIResponse<{ ok: boolean; duration_ms: number; remote_path: string; log: string }>>(
      `/sites/${siteId}/remote-sync`,
      { delete_extraneous: deleteExtraneous },
    );
    return r.data;
  },
};
