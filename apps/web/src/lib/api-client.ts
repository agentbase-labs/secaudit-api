/**
 * Minimal fetch-based API client with in-memory access token storage +
 * silent-refresh-on-401. The refresh token lives in an HttpOnly cookie set
 * by the API (`/auth/login` + `/auth/refresh`).
 */

let accessToken: string | null = null;
let refreshInFlight: Promise<string | null> | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}
export function getAccessToken(): string | null {
  return accessToken;
}

export function apiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001/api/v1';
}

export interface ApiError extends Error {
  status: number;
  code?: string;
  details?: unknown;
}

function toApiError(status: number, body: unknown): ApiError {
  const b = (body ?? {}) as { error?: string; message?: string; details?: unknown };
  const err = new Error(b.message ?? `HTTP ${status}`) as ApiError;
  err.status = status;
  err.code = b.error;
  err.details = b.details;
  return err;
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  credentials?: RequestCredentials;
  signal?: AbortSignal;
  skipAuth?: boolean;
  retried?: boolean;
}

export async function apiFetch<T = unknown>(path: string, opts: RequestOptions = {}): Promise<T> {
  const url = path.startsWith('http') ? path : `${apiBaseUrl()}${path}`;
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...opts.headers };
  if (!opts.skipAuth && accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }
  const init: RequestInit = {
    method: opts.method ?? 'GET',
    headers,
    credentials: opts.credentials ?? 'include',
    signal: opts.signal,
  };
  if (opts.body !== undefined) {
    init.body = typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body);
  }
  const res = await fetch(url, init);

  if (res.status === 401 && !opts.retried && !opts.skipAuth) {
    const newToken = await refreshAccessToken();
    if (newToken) {
      return apiFetch<T>(path, { ...opts, retried: true });
    }
  }

  const isJson = res.headers.get('content-type')?.includes('application/json');
  const payload: unknown = isJson ? await res.json().catch(() => null) : await res.text();
  if (!res.ok) throw toApiError(res.status, payload);
  return payload as T;
}

async function refreshAccessToken(): Promise<string | null> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    try {
      const res = await fetch(`${apiBaseUrl()}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) {
        setAccessToken(null);
        return null;
      }
      const body = (await res.json()) as { accessToken?: string };
      if (body.accessToken) {
        setAccessToken(body.accessToken);
        return body.accessToken;
      }
      return null;
    } catch {
      setAccessToken(null);
      return null;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}
