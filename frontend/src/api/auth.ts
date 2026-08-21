import { api, API_BASE } from './client';
import type { APIResponse } from '@/lib/utils';

export interface User {
  id: string;
  email: string;
  name: string;
  avatar: string | null;
  is_active: boolean;
  is_super_admin: boolean;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface LoginPayload {
  email: string;
  password: string;
}

export interface RegisterPayload {
  email: string;
  password: string;
  name: string;
}

export interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  token_type: string;
  expires_in?: number;
  user?: User;
  // P5.4 2FA: 如果返这些字段, 需走 verify 步骇
  requires_2fa?: boolean;
  challenge_token?: string;
}

export const authApi = {
  async login(payload: LoginPayload) {
    const r = await api.post<APIResponse<TokenResponse>>('/auth/login', payload);
    return r.data.data!;
  },

  // P5.4 2FA: login 第二步
  async verify2FA(challengeToken: string, code: string) {
    const r = await axios_unauth.post<APIResponse<TokenResponse>>(
      '/api/v1/auth/2fa/verify',
      { challenge_token: challengeToken, code }
    );
    return r.data.data!;
  },

  async recover2FA(challengeToken: string, recoveryCode: string) {
    const r = await axios_unauth.post<APIResponse<TokenResponse & { recovery_codes_remaining: number }>>(
      '/api/v1/auth/2fa/recover',
      { challenge_token: challengeToken, recovery_code: recoveryCode }
    );
    return r.data.data!;
  },

  // P5.4 2FA: setup / status / disable (走带 token 的 api)
  async setup2FA() {
    const r = await api.post<APIResponse<{ secret: string; provisioning_uri: string; recovery_codes: string[] }>>(
      '/auth/2fa/setup'
    );
    return r.data.data!;
  },

  async verify2FASetup(code: string) {
    const r = await api.post<APIResponse<{ message: string; is_enabled: boolean }>>(
      '/auth/2fa/verify-setup',
      { code }
    );
    return r.data.data!;
  },

  async get2FAStatus() {
    const r = await api.get<APIResponse<{ is_enabled: boolean; enabled_at: string | null; recovery_codes_remaining: number }>>(
      '/auth/2fa/status'
    );
    return r.data.data!;
  },

  async disable2FA(payload: { code?: string; password?: string }) {
    const r = await api.post<APIResponse<{ message: string; is_enabled: boolean }>>(
      '/auth/2fa/disable',
      payload
    );
    return r.data.data!;
  },

  async regenerateRecoveryCodes() {
    const r = await api.post<APIResponse<{ recovery_codes: string[] }>>(
      '/auth/2fa/regenerate-recovery-codes'
    );
    return r.data.data!;
  },

  async register(payload: RegisterPayload) {
    const r = await api.post<APIResponse<{ user: User; is_first_user: boolean }>>(
      '/auth/register',
      payload
    );
    return r.data.data!;
  },

  async me() {
    const r = await api.get<APIResponse<{ user: User }>>('/auth/me');
    return r.data.data!.user;
  },

  async logout() {
    await api.post('/auth/logout');
  },

  async health() {
    // 简单健康检查 (不走 /api/v1)
    const r = await axios_unauth.get('/healthz');
    return r.data;
  },

  // === P5.2 自助找回密码 ===
  async forgotPassword(email: string) {
    // 后端返 { message, reset_url (dev only) }
    const r = await axios_unauth.post<APIResponse<{ message: string; reset_url: string | null }>>(
      '/api/v1/auth/forgot-password',
      { email }
    );
    return r.data.data!;
  },

  async passwordResetTokenInfo(token: string) {
    const r = await axios_unauth.get<APIResponse<{
      valid: boolean;
      expired: boolean;
      used: boolean;
      email_hint: string | null;
    }>>(`/api/v1/auth/password-reset-token-info?token=${encodeURIComponent(token)}`);
    return r.data.data!;
  },

  async resetPassword(token: string, newPassword: string) {
    const r = await axios_unauth.post<APIResponse<{ message: string }>>(
      '/api/v1/auth/reset-password',
      { token, new_password: newPassword }
    );
    return r.data.data!;
  },
};

import axios from 'axios';
const axios_unauth = axios.create({
  baseURL: API_BASE.replace('/api/v1', ''),
  timeout: 5000,
});
