// RBAC: 角色/权限/用户管理 API (P0 2026-06-06)
import { api } from './client';
import type { APIResponse } from '@/lib/utils';

export interface Permission {
  id: string;
  code: string;
  resource: string;
  description: string | null;
}

export interface PermissionGroup {
  resource: string;
  label: string;
  permissions: Permission[];
}

export interface Role {
  id: string;
  code: string;
  name: string;
  description: string | null;
  is_system: boolean;
  permission_count: number;
  user_count: number;
  created_at: string;
  updated_at: string;
}

export interface RoleDetail extends Role {
  permission_codes: string[];
}

export interface UserListItem {
  id: string;
  email: string;
  name: string;
  avatar: string | null;
  is_active: boolean;
  is_super_admin: boolean;
  last_login_at: string | null;
  last_login_ip: string | null;
  created_at: string;
  role_codes: string[];
  site_count: number;
}

export interface SiteMember {
  id: string;
  site_id: string;
  site_name: string;
  site_slug: string;
  name: string;  // owner/editor/viewer
  joined_at: string;
}

export interface SiteAssignment {
  site_id: string;
  name: 'owner' | 'editor' | 'viewer';
}

export const rbacApi = {
  // === Permissions ===
  // P4.4 fix: RBAC 端点裸返 list (后端 response_model=list[X]), 不是包装响应
  listPermissionsGrouped: async (): Promise<PermissionGroup[]> => {
    const r = await api.get<APIResponse<PermissionGroup[]>>('/permissions');
    return r.data.data!;
  },

  // === Roles ===
  listRoles: async (q?: string): Promise<Role[]> => {
    const r = await api.get<APIResponse<Role[]>>('/roles', { params: q ? { q } : undefined });
    return r.data.data!;
  },
  getRole: async (id: string): Promise<RoleDetail> => {
    const r = await api.get<APIResponse<RoleDetail>>(`/roles/${id}`);
    return r.data.data!;
  },
  createRole: async (body: { code: string; name: string; description?: string; permission_codes: string[] }): Promise<RoleDetail> => {
    const r = await api.post<APIResponse<RoleDetail>>('/roles', body);
    return r.data.data!;
  },
  updateRole: async (id: string, body: { name?: string; description?: string; permission_codes?: string[] }): Promise<RoleDetail> => {
    const r = await api.patch<APIResponse<RoleDetail>>(`/roles/${id}`, body);
    return r.data.data!;
  },
  deleteRole: async (id: string): Promise<void> => {
    await api.delete(`/roles/${id}`);
  },
  cloneRole: async (id: string): Promise<RoleDetail> => {
    const r = await api.post<APIResponse<RoleDetail>>(`/roles/${id}/clone`);
    return r.data.data!;
  },
  listRoleUsers: async (id: string): Promise<UserListItem[]> => {
    const r = await api.get<APIResponse<UserListItem[]>>(`/roles/${id}/users`);
    return r.data.data!;
  },

  // === Users ===
  listUsers: async (params?: { q?: string; is_active?: boolean; role_code?: string; page?: number; page_size?: number }): Promise<UserListItem[]> => {
    const r = await api.get<APIResponse<UserListItem[]>>('/users', { params });
    return r.data.data!;
  },
  getUser: async (id: string): Promise<UserListItem> => {
    const r = await api.get<APIResponse<UserListItem>>(`/users/${id}`);
    return r.data.data!;
  },
  createUser: async (body: { email: string; name: string; password: string; is_active?: boolean; role_codes?: string[] }): Promise<UserListItem> => {
    const r = await api.post<APIResponse<UserListItem>>('/users', body);
    return r.data.data!;
  },
  updateUser: async (id: string, body: { name?: string; password?: string; is_active?: boolean; role_codes?: string[] }): Promise<UserListItem> => {
    const r = await api.patch<APIResponse<UserListItem>>(`/users/${id}`, body);
    return r.data.data!;
  },
  deleteUser: async (id: string): Promise<void> => {
    await api.delete(`/users/${id}`);
  },

  // === User → Sites ===
  getUserSites: async (id: string): Promise<SiteMember[]> => {
    const r = await api.get<APIResponse<SiteMember[]>>(`/users/${id}/sites`);
    return r.data.data!;
  },
  assignUserSites: async (id: string, assignments: SiteAssignment[]): Promise<SiteMember[]> => {
    const r = await api.put<APIResponse<SiteMember[]>>(`/users/${id}/sites`, { assignments });
    return r.data.data!;
  },
};
