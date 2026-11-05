import Constants from 'expo-constants';
import { SharedRefreshGate } from '@member/gathering-domain';
import type {
  GatheringEventView,
  GatheringGroupDetail,
  GatheringGroupSummary,
  GatheringInviteCreated,
  GatheringInvitePreview,
  GatheringMemberView,
  GatheringOfficerTermView,
  GatheringOfficerView,
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

async function performRefresh() {
  const refreshToken = await tokenStorage.getRefreshToken();
  if (!refreshToken) {
    await clearStoredSession();
    return false;
  }
  const response = await fetch(`${API_BASE}/api/gathering/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  });
  if (!response.ok) {
    await clearStoredSession();
    return false;
  }
  const data = (await response.json()) as { tokens: { accessToken: string; refreshToken: string } };
  await tokenStorage.save(data.tokens);
  return true;
}

const refreshGate = new SharedRefreshGate(performRefresh);

export function onSessionCleared(listener: () => void) {
  return refreshGate.subscribe(listener);
}

function refreshTokens() {
  return refreshGate.run();
}

async function clearStoredSession() {
  await tokenStorage.clear();
  refreshGate.notifyCleared();
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
  events(groupId: string, from: string, to: string) {
    const params = new URLSearchParams({ from, to });
    return request<{ items: GatheringEventView[] }>(
      `/api/gathering/groups/${groupId}/events?${params}`,
    );
  },
  calendar(from: string, to: string) {
    const params = new URLSearchParams({ from, to });
    return request<{ items: GatheringEventView[] }>(`/api/gathering/calendar?${params}`);
  },
  createEvent(groupId: string, body: unknown) {
    return request<GatheringEventView>(`/api/gathering/groups/${groupId}/events`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },
  updateEvent(groupId: string, eventId: string, body: unknown) {
    return request<GatheringEventView>(`/api/gathering/groups/${groupId}/events/${eventId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
  },
  event(groupId: string, eventId: string) {
    return request<GatheringEventView>(`/api/gathering/groups/${groupId}/events/${eventId}`);
  },
  setAttendance(groupId: string, eventId: string, status: 'ATTENDING' | 'DECLINED' | 'UNDECIDED') {
    return request<GatheringEventView>(
      `/api/gathering/groups/${groupId}/events/${eventId}/attendance`,
      { method: 'PUT', body: JSON.stringify({ status }) },
    );
  },
  officers(groupId: string) {
    return request<{ current: GatheringOfficerView[]; history: GatheringOfficerTermView[] }>(
      `/api/gathering/groups/${groupId}/officers`,
    );
  },
  assignOfficer(groupId: string, body: { userId: string; role: 'SECRETARY' | 'TREASURER' | 'EXECUTIVE'; title?: string }) {
    return request<{ assignmentId: string }>(`/api/gathering/groups/${groupId}/officers`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },
  revokeOfficer(groupId: string, assignmentId: string) {
    return request<{ ok: boolean }>(
      `/api/gathering/groups/${groupId}/officers/${assignmentId}/revoke`,
      { method: 'POST', body: JSON.stringify({}) },
    );
  },
  registerPush(body: { permission: 'granted' | 'denied'; platform: 'IOS' | 'ANDROID'; token?: string }) {
    return request<{ ok: boolean }>('/api/gathering/push/tokens', {
      method: 'POST',
      body: JSON.stringify(body),
    });
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
