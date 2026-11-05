import Constants from 'expo-constants';
import type {
  GatheringGroupDetail,
  GatheringGroupSummary,
  GatheringInviteCreated,
  GatheringInvitePreview,
  GatheringMemberView,
  GatheringSessionResponse,
} from '@member/contracts';
import { tokenStorage } from '../storage/secure';

const extra = Constants.expoConfig?.extra as { apiBaseUrl?: string } | undefined;
export const API_BASE = extra?.apiBaseUrl || 'http://localhost:3001';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
  }
}

type ErrorBody = { error?: { code?: string; message?: string } };

async function request<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const accessToken = await tokenStorage.getAccessToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init.headers as Record<string, string> | undefined),
  };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  const response = await fetch(`${API_BASE}${path}`, { ...init, headers });
  if (response.status === 401 && retry && !path.includes('/auth/login')) {
    const refreshed = await refreshTokens();
    if (refreshed) return request<T>(path, init, false);
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as ErrorBody;
    throw new ApiError(
      body.error?.message ?? `요청 실패 (${response.status})`,
      response.status,
      body.error?.code,
    );
  }
  return response.json() as Promise<T>;
}

async function refreshTokens() {
  const refreshToken = await tokenStorage.getRefreshToken();
  if (!refreshToken) return false;
  const response = await fetch(`${API_BASE}/api/gathering/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  });
  if (!response.ok) {
    await tokenStorage.clear();
    return false;
  }
  const data = (await response.json()) as { tokens: { accessToken: string; refreshToken: string } };
  await tokenStorage.save(data.tokens);
  return true;
}

export const api = {
  register(body: unknown) {
    return request<GatheringSessionResponse>(
      '/api/gathering/auth/register',
      {
        method: 'POST',
        body: JSON.stringify(body),
      },
      false,
    );
  },
  login(phone: string, password: string) {
    return request<GatheringSessionResponse>(
      '/api/gathering/auth/login',
      {
        method: 'POST',
        body: JSON.stringify({ phone, password }),
      },
      false,
    );
  },
  logout(refreshToken: string | null) {
    return request<{ ok: boolean }>(
      '/api/gathering/auth/logout',
      {
        method: 'POST',
        body: JSON.stringify({ refreshToken }),
      },
      false,
    );
  },
  me() {
    return request<Pick<GatheringSessionResponse, 'user' | 'profile' | 'identityLimitation'>>(
      '/api/gathering/auth/me',
    );
  },
  completeProfile(body: unknown) {
    return request<
      Pick<GatheringSessionResponse, 'user' | 'profile' | 'identityLimitation' | 'recoveryCodes'>
    >('/api/gathering/auth/profile', { method: 'POST', body: JSON.stringify(body) });
  },
  redeemRecovery(body: unknown) {
    return request<{ ok: boolean }>(
      '/api/gathering/auth/recovery/redeem',
      {
        method: 'POST',
        body: JSON.stringify(body),
      },
      false,
    );
  },
  requestRecovery(body: unknown) {
    return request<{ accepted: boolean; message: string }>(
      '/api/gathering/auth/recovery/request',
      {
        method: 'POST',
        body: JSON.stringify(body),
      },
      false,
    );
  },
  groups(q?: string) {
    const query = q ? `?q=${encodeURIComponent(q)}` : '';
    return request<{ items: GatheringGroupSummary[] }>(`/api/gathering/groups${query}`);
  },
  createGroup(body: { name: string; description?: string }) {
    return request<GatheringGroupDetail>('/api/gathering/groups', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },
  group(groupId: string) {
    return request<GatheringGroupDetail>(`/api/gathering/groups/${groupId}`);
  },
  updateGroup(groupId: string, body: { inviteRequiresApproval?: boolean; name?: string }) {
    return request<GatheringGroupDetail>(`/api/gathering/groups/${groupId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
  },
  members(groupId: string, status: 'ACTIVE' | 'PENDING' = 'ACTIVE', q?: string) {
    const params = new URLSearchParams({ status });
    if (q) params.set('q', q);
    return request<{ items: GatheringMemberView[] }>(
      `/api/gathering/groups/${groupId}/members?${params}`,
    );
  },
  decideMember(groupId: string, membershipId: string, decision: 'APPROVE' | 'REJECT') {
    return request<{ status: string }>(
      `/api/gathering/groups/${groupId}/members/${membershipId}/decision`,
      {
        method: 'POST',
        body: JSON.stringify({ decision }),
      },
    );
  },
  createInvite(groupId: string) {
    return request<GatheringInviteCreated>(`/api/gathering/groups/${groupId}/invites`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
  },
  previewInvite(token: string) {
    return request<GatheringInvitePreview>(
      `/api/gathering/invites/${encodeURIComponent(token)}`,
      {},
      false,
    );
  },
  acceptInvite(token: string) {
    return request<{ groupId: string; status: string }>(
      `/api/gathering/invites/${encodeURIComponent(token)}/accept`,
      {
        method: 'POST',
        body: JSON.stringify({ directoryConsent: true }),
      },
    );
  },
};
