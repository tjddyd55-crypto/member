import Constants from 'expo-constants';
import { SharedRefreshGate } from '@member/gathering-domain';
import type {
  GatheringAlbumEvent,
  GatheringAlbumYear,
  GatheringEventView,
  GatheringFinanceSummary,
  GatheringReceiptView,
  GatheringTransactionView,
  GatheringGroupDetail,
  GatheringGroupSummary,
  GatheringInviteCreated,
  GatheringInviteView,
  GatheringInvitePreview,
  GatheringMediaUploadItem,
  GatheringMediaView,
  GatheringMemberView,
  GatheringOfficerTermView,
  GatheringOfficerView,
  GatheringSessionResponse,
  GatheringStorageUsage,
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
  deleteAccount(password: string) {
    return request<{ ok: boolean; memberBookKept: boolean }>('/api/gathering/auth/account/delete', {
      method: 'POST',
      body: JSON.stringify({ password, confirm: true }),
    });
  },
  blockMember(groupId: string, userId: string) {
    return request<{ ok: boolean }>(`/api/gathering/groups/${groupId}/blocks`, {
      method: 'POST',
      body: JSON.stringify({ userId }),
    });
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
  updateGroup(
    groupId: string,
    body: { inviteRequiresApproval?: boolean; name?: string; fiscalStartMonth?: number; fiscalStartDay?: number },
  ) {
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
  invites(groupId: string) {
    return request<{ items: GatheringInviteView[] }>(`/api/gathering/groups/${groupId}/invites`);
  },
  revokeInvite(groupId: string, inviteId: string) {
    return request<{ ok: true }>(`/api/gathering/groups/${groupId}/invites/${inviteId}/revoke`, {
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
  events(
    groupId: string,
    from: string,
    to: string,
    options?: { order?: 'asc' | 'desc'; status?: 'SCHEDULED' | 'CANCELLED' },
  ) {
    const params = new URLSearchParams({ from, to });
    if (options?.order) params.set('order', options.order);
    if (options?.status) params.set('status', options.status);
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
  subscription(groupId: string) {
    return request<{
      status: 'ACTIVE' | 'EXPIRED' | 'NONE' | string;
      expiresAt: string | null;
      uploadsAllowed: boolean;
      usedBytes: number;
      quotaBytes: number;
    }>(`/api/gathering/groups/${groupId}/subscription`);
  },
  storage(groupId: string) {
    return request<GatheringStorageUsage>(`/api/gathering/groups/${groupId}/storage`);
  },
  albums(groupId: string, year?: number) {
    const query = year ? `?year=${year}` : '';
    return request<{
      years: GatheringAlbumYear[];
      events: GatheringAlbumEvent[];
      folders?: Array<{ folderId: string; title: string; photoCount: number; videoCount: number }>;
    }>(
      `/api/gathering/groups/${groupId}/albums${query}`,
    );
  },
  createFolder(groupId: string, title: string) {
    return request<{ id: string; title: string }>(`/api/gathering/groups/${groupId}/folders`, {
      method: 'POST',
      body: JSON.stringify({ title }),
    });
  },
  createUploadLink(groupId: string, body: { eventId?: string; folderId?: string }) {
    return request<{ id: string; token: string; expiresAt: string }>(`/api/gathering/groups/${groupId}/upload-links`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },
  folderMedia(groupId: string, folderId: string, cursor?: string) {
    const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
    return request<{
      folder: { id: string; title: string };
      items: GatheringMediaView[];
      nextCursor: string | null;
    }>(`/api/gathering/groups/${groupId}/folders/${folderId}/media${query}`);
  },
  eventMedia(groupId: string, eventId: string, cursor?: string) {
    const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
    return request<{ items: GatheringMediaView[]; nextCursor: string | null }>(
      `/api/gathering/groups/${groupId}/events/${eventId}/media${query}`,
    );
  },
  createFolderUploads(
    groupId: string,
    folderId: string,
    items: Array<{
      kind: 'PHOTO' | 'VIDEO';
      mimeType: string;
      sizeBytes: number;
      durationMs?: number;
      width?: number;
      height?: number;
      originalName?: string;
    }>,
  ) {
    return request<{ items: GatheringMediaUploadItem[] }>(
      `/api/gathering/groups/${groupId}/folders/${folderId}/media/uploads`,
      { method: 'POST', body: JSON.stringify({ items }) },
    );
  },
  resumeFolderMedia(groupId: string, folderId: string, assetId: string) {
    return request<
      | { status: 'READY'; media: GatheringMediaView }
      | { status: 'PENDING'; id: string; uploadUrl: string; expiresAt: string; headers: Record<string, string> }
    >(`/api/gathering/groups/${groupId}/folders/${folderId}/media/${assetId}/resume`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
  },
  completeFolderMedia(groupId: string, folderId: string, assetId: string, sizeBytes: number) {
    return request<{ media: GatheringMediaView }>(
      `/api/gathering/groups/${groupId}/folders/${folderId}/media/${assetId}/complete`,
      { method: 'POST', body: JSON.stringify({ sizeBytes }) },
    );
  },
  createMediaUploads(
    groupId: string,
    eventId: string,
    items: Array<{
      kind: 'PHOTO' | 'VIDEO';
      mimeType: string;
      sizeBytes: number;
      durationMs?: number;
      width?: number;
      height?: number;
      originalName?: string;
    }>,
  ) {
    return request<{ items: GatheringMediaUploadItem[] }>(
      `/api/gathering/groups/${groupId}/events/${eventId}/media/uploads`,
      { method: 'POST', body: JSON.stringify({ items }) },
    );
  },
  resumeMedia(groupId: string, eventId: string, assetId: string) {
    return request<
      | { status: 'READY'; media: GatheringMediaView }
      | {
          status: 'PENDING';
          id: string;
          uploadUrl: string;
          expiresAt: string;
          headers: Record<string, string>;
        }
    >(`/api/gathering/groups/${groupId}/events/${eventId}/media/${assetId}/resume`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
  },
  completeMedia(groupId: string, eventId: string, assetId: string, sizeBytes: number) {
    return request<{ media: GatheringMediaView }>(
      `/api/gathering/groups/${groupId}/events/${eventId}/media/${assetId}/complete`,
      { method: 'POST', body: JSON.stringify({ sizeBytes }) },
    );
  },
  downloadMedia(groupId: string, assetId: string) {
    return request<{ url: string; expiresAt: string; mimeType: string; kind: 'PHOTO' | 'VIDEO' }>(
      `/api/gathering/groups/${groupId}/media/${assetId}/download`,
    );
  },
  deleteMedia(groupId: string, assetId: string) {
    return request<{ ok: boolean }>(`/api/gathering/groups/${groupId}/media/${assetId}`, {
      method: 'DELETE',
    });
  },
  finance(groupId: string, year?: number) {
    const query = year ? `?year=${year}` : '';
    return request<GatheringFinanceSummary>(`/api/gathering/groups/${groupId}/finance${query}`);
  },
  eventTransactions(groupId: string, eventId: string) {
    return request<{ items: GatheringTransactionView[] }>(
      `/api/gathering/groups/${groupId}/events/${eventId}/transactions`,
    );
  },
  createTransaction(groupId: string, eventId: string, body: unknown) {
    return request<GatheringTransactionView>(
      `/api/gathering/groups/${groupId}/events/${eventId}/transactions`,
      { method: 'POST', body: JSON.stringify(body) },
    );
  },
  saveDue(groupId: string, body: unknown) {
    return request<{ id: string; status: string }>(`/api/gathering/groups/${groupId}/finance/dues`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },
  eventReceipts(groupId: string, eventId: string) {
    return request<{ items: GatheringReceiptView[] }>(
      `/api/gathering/groups/${groupId}/events/${eventId}/receipts`,
    );
  },
  createReceiptUploads(
    groupId: string,
    eventId: string,
    items: Array<{ mimeType: string; sizeBytes: number; originalName?: string }>,
  ) {
    return request<{ items: Array<{ id: string; uploadUrl: string; headers: Record<string, string> }> }>(
      `/api/gathering/groups/${groupId}/events/${eventId}/receipts/uploads`,
      { method: 'POST', body: JSON.stringify({ items }) },
    );
  },
  completeReceipt(groupId: string, eventId: string, receiptId: string, sizeBytes: number) {
    return request<GatheringReceiptView>(
      `/api/gathering/groups/${groupId}/events/${eventId}/receipts/${receiptId}/complete`,
      { method: 'POST', body: JSON.stringify({ sizeBytes }) },
    );
  },
  downloadReceipt(groupId: string, receiptId: string) {
    return request<{ url: string; mimeType: string }>(
      `/api/gathering/groups/${groupId}/receipts/${receiptId}/download`,
    );
  },
  handover(groupId: string) {
    return request<{
      preview: {
        incomeWon: number;
        expenseWon: number;
        balanceWon: number;
        dueCount: number;
        receiptCount: number;
      } | null;
      handover: { id: string; status: string; toUserId: string } | null;
      actions: {
        nominate: boolean;
        accept: boolean;
        confirm: boolean;
        finalize: boolean;
        cancel: boolean;
      };
    }>(`/api/gathering/groups/${groupId}/handover`);
  },
  nominateHandover(groupId: string, toUserId: string, idempotencyKey: string) {
    return request<{ id: string }>(`/api/gathering/groups/${groupId}/handover`, {
      method: 'POST',
      body: JSON.stringify({ toUserId, idempotencyKey }),
    });
  },
  acceptHandover(groupId: string, handoverId: string) {
    return request<{ status: string }>(`/api/gathering/groups/${groupId}/handover/${handoverId}/accept`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
  },
  confirmHandover(groupId: string, handoverId: string, preview: {
    incomeWon: number;
    expenseWon: number;
    balanceWon: number;
    dueCount: number;
    receiptCount: number;
  }) {
    return request<{ status: string }>(`/api/gathering/groups/${groupId}/handover/${handoverId}/confirm`, {
      method: 'POST',
      body: JSON.stringify(preview),
    });
  },
  cancelHandover(groupId: string, handoverId: string) {
    return request<{ status: string }>(`/api/gathering/groups/${groupId}/handover/${handoverId}/cancel`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
  },
  finalizeHandover(groupId: string, handoverId: string) {
    return request<{ balanceWon: number }>(`/api/gathering/groups/${groupId}/handover/${handoverId}/finalize`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
  },
  reportMedia(groupId: string, assetId: string, reason: string) {
    return request<{ id: string }>(`/api/gathering/groups/${groupId}/media/${assetId}/reports`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
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
