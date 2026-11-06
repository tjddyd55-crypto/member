export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

let csrf = '';

export function rememberCsrf(token: string | undefined) {
  if (token) csrf = token;
}

function csrfFromCookie() {
  if (typeof document === 'undefined') return '';
  const match = document.cookie.match(/(?:^|; )gathering_admin_csrf=([^;]*)/);
  return match ? decodeURIComponent(match[1]) : '';
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body) headers.set('content-type', 'application/json');
  const method = (options.method ?? 'GET').toUpperCase();
  const token = csrf || csrfFromCookie();
  if (method !== 'GET' && token) headers.set('x-gathering-admin-csrf', token);
  const base = import.meta.env.VITE_API_BASE_URL ?? '';
  const response = await fetch(`${base}${path}`, { ...options, headers, credentials: 'include' });
  const text = await response.text();
  const data = text ? (JSON.parse(text) as T & { error?: { message?: string }; csrfToken?: string }) : ({} as T);
  if (!response.ok) {
    const message = (data as { error?: { message?: string } }).error?.message ?? '요청이 실패했습니다.';
    throw new ApiError(message, response.status);
  }
  rememberCsrf((data as { csrfToken?: string }).csrfToken);
  return data;
}
