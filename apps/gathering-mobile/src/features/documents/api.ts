import { request } from '../../api/client';

export type DocumentLocation = { folderId: string | null; eventId: string | null };
export type DocumentFile = DocumentLocation & {
  id: string;
  name: string;
  originalName: string;
  extension: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  uploadedBy: string;
  canDelete: boolean;
};
export type DocumentFolder = { id: string; name: string; fileCount: number; canManage?: boolean };
export type DocumentEvent = { id: string; title: string; startsAt: string; archived: boolean };
type Target = { url: string; headers: Record<string, string> };

export function documentApi(groupId: string) {
  const base = `/api/gathering/groups/${encodeURIComponent(groupId)}/documents`;
  function change<T>(path: string, method: string, data?: object) {
    return request<T>(base + path, { method, ...(data ? { body: JSON.stringify(data) } : {}) });
  }
  return {
    list(location: DocumentLocation, q = '', sort = 'recent', offset = 0) {
      const params = new URLSearchParams({ offset: String(offset), sort, q });
      if (location.folderId) params.set('folderId', location.folderId);
      if (location.eventId) params.set('eventId', location.eventId);
      return request<{
        breadcrumbs: { id: string; name: string }[]; files: DocumentFile[]; folders: DocumentFolder[];
        folder: { name: string; parentId: string | null } | null;
        canManage: boolean; canCreateFolder: boolean; maxBytes: number; nextOffset: number | null;
      }>(`${base}?${params}`);
    },
    events: (offset = 0) => request<{ events: DocumentEvent[]; nextOffset: number | null }>(`${base}/events?offset=${offset}`),
    saveFolder: (id: string | null, data: { name?: string; parentId?: string | null; eventId?: string | null }) =>
      change<{ id: string }>(id ? `/folders/${id}` : '/folders', id ? 'PATCH' : 'POST', data),
    deleteFolder: (id: string) => change(`/folders/${id}`, 'DELETE'),
    reserve: (data: DocumentLocation & { name: string; mimeType?: string; sizeBytes: number }) =>
      change<{ id: string; target: Target }>('/uploads', 'POST', data),
    complete: (id: string) => change<DocumentFile>(`/files/${id}/complete`, 'POST'),
    download: (id: string) => request<{ url: string }>(`${base}/files/${id}/download`),
    updateFile: (id: string, data: { name?: string; location?: DocumentLocation }) =>
      change(`/files/${id}`, 'PATCH', data),
    deleteFile: (id: string) => change(`/files/${id}`, 'DELETE'),
  };
}
