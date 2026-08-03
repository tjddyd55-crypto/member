import Constants from 'expo-constants';
import type { AuthMeResponse, MemberDetail, MemberListItem } from '@member/contracts';
import { tokenStorage } from '../storage/token-storage';

const extra = Constants.expoConfig?.extra as { apiBaseUrl?: string } | undefined;
const API_BASE =
  extra?.apiBaseUrl ||
  (Constants.expoConfig?.hostUri
    ? `http://${Constants.expoConfig.hostUri.split(':')[0]}:3001`
    : 'http://localhost:3001');

type ApiErrorBody = { error?: { code?: string; message?: string } };

async function request<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const accessToken = await tokenStorage.getAccessToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init.headers as Record<string, string> | undefined),
  };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  if (res.status === 401 && retry) {
    const refreshToken = await tokenStorage.getRefreshToken();
    if (refreshToken) {
      const refreshed = await fetch(`${API_BASE}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      if (refreshed.ok) {
        const data = (await refreshed.json()) as {
          tokens: { accessToken: string; refreshToken: string };
        };
        await tokenStorage.save(data.tokens);
        return request<T>(path, init, false);
      }
    }
  }

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as ApiErrorBody;
    throw new Error(body.error?.message ?? `요청 실패 (${res.status})`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  login(identifier: string, password: string) {
    return request<{
      tokens: { accessToken: string; refreshToken: string; expiresIn: number };
      membership: AuthMeResponse['membership'];
      user: AuthMeResponse['user'];
    }>(
      '/api/auth/login',
      {
        method: 'POST',
        body: JSON.stringify({ identifier, password }),
      },
      false,
    );
  },
  logout(refreshToken: string | null) {
    return request<{ ok: boolean }>(
      '/api/auth/logout',
      { method: 'POST', body: JSON.stringify({ refreshToken }) },
      false,
    );
  },
  me() {
    return request<AuthMeResponse>('/api/auth/me');
  },
  members(q?: string) {
    const qs = q ? `?q=${encodeURIComponent(q)}` : '';
    return request<{ items: MemberListItem[]; nextCursor: string | null }>(`/api/members${qs}`);
  },
  member(id: string) {
    return request<MemberDetail>(`/api/members/${id}`);
  },
  localCurrent() {
    return request<{
      id: string;
      name: string;
      slogan: string | null;
      primaryColor: string;
    }>('/api/local/current');
  },
};
