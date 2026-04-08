import { api } from './client';
import type { UserResponse } from '@shared/types/auth.types';

interface AuthResponse {
  user: UserResponse;
  accessToken: string;
}

interface LoginResponse {
  user?: UserResponse;
  accessToken?: string;
  requires_2fa?: boolean;
  temp_token?: string;
}

interface MeResponse {
  user: UserResponse;
}

interface TwoFASetupResponse {
  secret: string;
  uri: string;
  backup_codes: string[];
}

export const authApi = {
  login: (email: string, password: string) =>
    api.post<LoginResponse>('/auth/login', { email, password }),

  register: (data: { email: string; password: string; name: string; inviteKey: string }) =>
    api.post<AuthResponse>('/auth/register', data),

  refresh: () =>
    api.post<AuthResponse>('/auth/refresh'),

  logout: () =>
    api.post<{ message: string }>('/auth/logout'),

  me: () =>
    api.get<MeResponse>('/auth/me'),

  twoFASetup: (password: string) =>
    api.post<TwoFASetupResponse>('/auth/2fa/setup', { password }),

  twoFAVerifySetup: (token: string) =>
    api.post<{ success: boolean }>('/auth/2fa/verify-setup', { token }),

  twoFAVerify: (token: string, temp_token: string) =>
    api.post<AuthResponse>('/auth/2fa/verify', { token, temp_token }),

  twoFADisable: (password: string) =>
    api.post<{ success: boolean }>('/auth/2fa/disable', { password }),

  twoFABackupVerify: (code: string, temp_token: string) =>
    api.post<AuthResponse>('/auth/2fa/backup-verify', { code, temp_token }),
};
