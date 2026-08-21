import { api } from './client';
import type { APIResponse } from '@/lib/utils';

export type SiteRole = 'owner' | 'editor' | 'viewer';

export interface Member {
  id: string;
  user_id: string;
  user_email: string;
  user_name: string | null;
  name: SiteRole;
  invited_by: string | null;
  joined_at: string;
}

export interface Invitation {
  id: string;
  site_id: string;
  email: string;
  name: SiteRole;
  invited_by: string;
  expires_at: string;
  accepted_at: string | null;
  created_at: string;
  status?: 'pending' | 'accepted' | 'expired';
}

export interface InvitationWithToken extends Invitation {
  token: string;
  accept_url: string;
}

export interface AcceptResult {
  site_id: string;
  site_name: string;
  site_slug: string;
  role: SiteRole;
}

export const membersApi = {
  // === 成员 ===
  async listMembers(siteId: string) {
    const r = await api.get<APIResponse<Member[]>>(`/sites/${siteId}/members`);
    return r.data.data!;
  },

  async updateMemberRole(siteId: string, memberId: string, name: SiteRole) {
    await api.patch(`/sites/${siteId}/members/${memberId}`, { name });
  },

  async removeMember(siteId: string, memberId: string) {
    await api.delete(`/sites/${siteId}/members/${memberId}`);
  },

  // === 邀请 ===
  async listInvitations(siteId: string) {
    const r = await api.get<APIResponse<Invitation[]>>(`/sites/${siteId}/invitations`);
    return r.data.data!;
  },

  async createInvitation(siteId: string, email: string, name: SiteRole = 'viewer') {
    const r = await api.post<APIResponse<InvitationWithToken>>(
      `/sites/${siteId}/invitations`,
      { email, name },
    );
    return r.data.data!;
  },

  async revokeInvitation(siteId: string, invId: string) {
    await api.delete(`/sites/${siteId}/invitations/${invId}`);
  },

  // === 接受 ===
  async acceptInvitation(token: string) {
    const r = await api.post<APIResponse<AcceptResult>>('/invitations/accept', { token });
    return r.data.data!;
  },

  async listMyInvitations() {
    const r = await api.get<APIResponse<Invitation[]>>('/invitations/mine');
    return r.data.data!;
  },
};
