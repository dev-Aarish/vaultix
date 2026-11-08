import type {
  AuditEvent,
  Device,
  DeviceStatus,
  Invitation,
  Paginated,
  Permission,
  Single,
  User,
  UserStatus,
} from './types';

const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? 'http://localhost:3000';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  token?: string;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers = new Headers({ Accept: 'application/json' });
  if (options.token) headers.set('Authorization', `Bearer ${options.token}`);
  if (options.body !== undefined) headers.set('Content-Type', 'application/json');

  const response = await fetch(`${API_BASE}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  if (response.status === 204) return undefined as T;

  const payload = (await response.json().catch(() => null)) as
    | { error?: { code?: string; message?: string } }
    | null;

  if (!response.ok) {
    throw new ApiError(
      response.status,
      payload?.error?.code ?? 'REQUEST_FAILED',
      payload?.error?.message ?? `Request failed (${response.status})`,
    );
  }

  return payload as T;
}

function query(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

export const api = {
  login(email: string, password: string) {
    return request<Single<{ token: string; expiresAt: string; user: User }>>('/auth/login', {
      method: 'POST',
      body: { email, password },
    });
  },

  me(token: string) {
    return request<Single<{ user: User }>>('/auth/me', { token });
  },

  listUsers(token: string, status?: UserStatus) {
    return request<Paginated<User>>(`/admin/users${query({ status, limit: 50 })}`, { token });
  },

  approveUser(token: string, id: string) {
    return request<Single<{ user: User }>>(`/admin/users/${id}/approve`, {
      method: 'POST',
      token,
    });
  },

  suspendUser(token: string, id: string) {
    return request<Single<{ user: User }>>(`/admin/users/${id}/suspend`, {
      method: 'POST',
      token,
    });
  },

  disableUser(token: string, id: string) {
    return request<Single<{ user: User }>>(`/admin/users/${id}/disable`, {
      method: 'POST',
      token,
    });
  },

  revokeUserSessions(token: string, id: string) {
    return request<Single<{ revokedSessions: number }>>(`/admin/users/${id}/sessions/revoke`, {
      method: 'POST',
      token,
    });
  },

  revokeSessions(token: string, body: { userId?: string; sessionId?: string }) {
    return request<Single<{ revokedCount: number }>>('/admin/sessions/revoke', {
      method: 'POST',
      token,
      body,
    });
  },

  listPermissions(token: string, status?: 'ACTIVE' | 'REVOKED') {
    return request<Paginated<Permission>>(
      `/admin/permissions${query({ status, limit: 100 })}`,
      { token },
    );
  },

  revokePermission(token: string, id: string) {
    return request<Single<{ permission: Permission }>>(`/admin/permissions/${id}`, {
      method: 'DELETE',
      token,
    });
  },

  listAuditEvents(token: string, filters?: { result?: 'SUCCESS' | 'DENIED'; eventType?: string; limit?: number }) {
    return request<Paginated<AuditEvent>>(
      `/admin/audit-events${query({
        result: filters?.result,
        eventType: filters?.eventType,
        limit: filters?.limit ?? 50,
      })}`,
      { token },
    );
  },

  listDevices(token: string, status?: DeviceStatus) {
    return request<Paginated<Device>>(`/admin/devices${query({ status, limit: 100 })}`, { token });
  },

  approveDevice(token: string, id: string) {
    return request<Single<{ device: Device }>>(`/admin/devices/${id}/approve`, {
      method: 'POST',
      token,
    });
  },

  revokeDevice(token: string, id: string) {
    return request<Single<{ device: Device; revokedSessions: number }>>(
      `/admin/devices/${id}/revoke`,
      { method: 'POST', token },
    );
  },

  listInvitations(token: string, status = 'pending') {
    return request<Paginated<Invitation>>(
      `/admin/invitations${query({ status, limit: 50 })}`,
      { token },
    );
  },

  createInvitation(token: string, email: string) {
    return request<Single<{ invitation: Invitation; token: string }>>('/admin/invitations', {
      method: 'POST',
      token,
      body: { email },
    });
  },

  revokeInvitation(token: string, id: string) {
    return request<Single<{ invitation: Invitation }>>(`/admin/invitations/${id}`, {
      method: 'DELETE',
      token,
    });
  },
};
