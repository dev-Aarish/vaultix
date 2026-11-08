import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ApiError, api } from './api';
import type {
  AuditEvent,
  Device,
  DeviceStatus,
  Invitation,
  Permission,
  User,
} from './types';

const TOKEN_KEY = 'vaultix.admin.token';

type AdminTab = 'access' | 'users' | 'permissions' | 'audit';
type DeviceFilter = DeviceStatus | 'ALL';
type AuditFilter = 'ALL' | 'SUCCESS' | 'DENIED';

function errorMessage(error: unknown): string {
  if (error instanceof ApiError || error instanceof Error) return error.message;
  return 'Something went wrong';
}

function formatDate(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function shortFingerprint(fingerprint: string): string {
  if (fingerprint.length <= 22) return fingerprint;
  return `${fingerprint.slice(0, 11)}…${fingerprint.slice(-11)}`;
}

export default function App() {
  const [token, setToken] = useState<string | null>(() => sessionStorage.getItem(TOKEN_KEY));
  const [admin, setAdmin] = useState<User | null>(null);
  const [booting, setBooting] = useState(Boolean(token));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [activeTab, setActiveTab] = useState<AdminTab>('access');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loginBusy, setLoginBusy] = useState(false);

  // Access control data
  const [pendingUsers, setPendingUsers] = useState<User[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [deviceFilter, setDeviceFilter] = useState<DeviceFilter>('PENDING');
  const [inviteEmail, setInviteEmail] = useState('');
  const [createdInvite, setCreatedInvite] = useState<{ email: string; token: string } | null>(null);
  const [copied, setCopied] = useState(false);

  // Users data
  const [allUsers, setAllUsers] = useState<User[]>([]);

  // Permissions data
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [permissionFilter, setPermissionFilter] = useState<'ACTIVE' | 'REVOKED'>('ACTIVE');

  // Audit data
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [auditResultFilter, setAuditResultFilter] = useState<AuditFilter>('ALL');
  const [auditEventTypeQuery, setAuditEventTypeQuery] = useState('');

  const logout = useCallback(() => {
    sessionStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setAdmin(null);
    setPendingUsers([]);
    setDevices([]);
    setInvitations([]);
    setAllUsers([]);
    setPermissions([]);
    setAuditEvents([]);
  }, []);

  useEffect(() => {
    if (!token) {
      setBooting(false);
      return;
    }
    let cancelled = false;
    api
      .me(token)
      .then((response) => {
        if (!cancelled) setAdmin(response.data.user);
      })
      .catch(() => {
        if (!cancelled) logout();
      })
      .finally(() => {
        if (!cancelled) setBooting(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, logout]);

  const refresh = useCallback(async () => {
    if (!token || !admin) return;
    setLoading(true);
    try {
      const [usersResponse, devicesResponse, invitationsResponse] = await Promise.all([
        api.listUsers(token, 'PENDING'),
        api.listDevices(token, deviceFilter === 'ALL' ? undefined : deviceFilter),
        api.listInvitations(token, 'pending'),
      ]);
      setPendingUsers(usersResponse.data);
      setDevices(devicesResponse.data);
      setInvitations(invitationsResponse.data);

      if (activeTab === 'users') {
        const usersAll = await api.listUsers(token);
        setAllUsers(usersAll.data);
      } else if (activeTab === 'permissions') {
        const perms = await api.listPermissions(token, permissionFilter);
        setPermissions(perms.data);
      } else if (activeTab === 'audit') {
        const audits = await api.listAuditEvents(token, {
          result: auditResultFilter === 'ALL' ? undefined : auditResultFilter,
          eventType: auditEventTypeQuery.trim() || undefined,
          limit: 100,
        });
        setAuditEvents(audits.data);
      }
      setError(null);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        logout();
        return;
      }
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, [token, admin, deviceFilter, activeTab, permissionFilter, auditResultFilter, auditEventTypeQuery, logout]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const run = useCallback(
    async (key: string, action: () => Promise<unknown>) => {
      setBusy(key);
      setError(null);
      try {
        await action();
        await refresh();
      } catch (caught) {
        if (caught instanceof ApiError && caught.status === 401) {
          logout();
          return;
        }
        setError(errorMessage(caught));
      } finally {
        setBusy(null);
      }
    },
    [refresh, logout],
  );

  async function handleLogin(event: FormEvent) {
    event.preventDefault();
    setLoginBusy(true);
    setError(null);
    try {
      const response = await api.login(email.trim(), password);
      if (response.data.user.role !== 'ADMIN') {
        throw new Error('This account is not an administrator');
      }
      sessionStorage.setItem(TOKEN_KEY, response.data.token);
      setToken(response.data.token);
      setAdmin(response.data.user);
      setPassword('');
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoginBusy(false);
    }
  }

  async function handleCreateInvitation(event: FormEvent) {
    event.preventDefault();
    if (!token || !inviteEmail.trim()) return;
    const targetEmail = inviteEmail.trim();
    setBusy('invite-create');
    setError(null);
    try {
      const response = await api.createInvitation(token, targetEmail);
      setCreatedInvite({ email: targetEmail, token: response.data.token });
      setInviteEmail('');
      await refresh();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  async function copyInviteToken() {
    if (!createdInvite) return;
    await navigator.clipboard.writeText(createdInvite.token);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function exportAuditCsv() {
    if (auditEvents.length === 0) return;
    const headers = ['Timestamp', 'Event Type', 'Result', 'Reason Code', 'Actor User ID', 'Device ID', 'IP Address', 'Metadata'];
    const rows = auditEvents.map((e) => [
      e.createdAt,
      e.eventType,
      e.result,
      e.reasonCode ?? '',
      e.actorUserId ?? '',
      e.deviceId ?? '',
      e.ipAddress ?? '',
      JSON.stringify(e.metadata || {}).replace(/"/g, '""'),
    ]);
    const csvContent = [headers.join(','), ...rows.map((r) => r.map((c) => `"${c}"`).join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `vaultix_audit_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  if (booting) {
    return (
      <div className="center-screen">
        <div className="spinner" aria-label="Loading" />
      </div>
    );
  }

  if (!admin || !token) {
    return (
      <div className="login-shell">
        <form className="login-card" onSubmit={handleLogin}>
          <div className="brand">
            <span className="brand-mark">V</span>
            <span>Vaultix</span>
          </div>
          <h1>Administration</h1>
          <p className="muted">Sign in with an administrator account.</p>
          {error && <div className="alert">{error}</div>}
          <label>
            Email
            <input
              type="email"
              autoComplete="username"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </label>
          <label>
            Password
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>
          <button type="submit" className="primary" disabled={loginBusy}>
            {loginBusy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">V</span>
          <span>Vaultix Admin</span>
        </div>
        <div className="topbar-actions">
          <span className="muted">{admin.email}</span>
          <button type="button" className="ghost" onClick={logout}>
            Sign out
          </button>
        </div>
      </header>

      <main>
        <section className="page-heading">
          <div>
            <h1>Security & Operations</h1>
            <p className="muted">Manage accounts, device binding, permission revocations, and audit logs.</p>
          </div>
          <button type="button" className="ghost" onClick={() => void refresh()} disabled={loading}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </section>

        {error && <div className="alert">{error}</div>}

        <nav className="nav-tabs" aria-label="Admin sections">
          <button
            type="button"
            className={`nav-tab ${activeTab === 'access' ? 'active' : ''}`}
            onClick={() => setActiveTab('access')}
          >
            Access Control
          </button>
          <button
            type="button"
            className={`nav-tab ${activeTab === 'users' ? 'active' : ''}`}
            onClick={() => setActiveTab('users')}
          >
            Users & Revocation
          </button>
          <button
            type="button"
            className={`nav-tab ${activeTab === 'permissions' ? 'active' : ''}`}
            onClick={() => setActiveTab('permissions')}
          >
            Permissions
          </button>
          <button
            type="button"
            className={`nav-tab ${activeTab === 'audit' ? 'active' : ''}`}
            onClick={() => setActiveTab('audit')}
          >
            Audit Trail
          </button>
        </nav>

        {/* Tab 1: Access Control */}
        {activeTab === 'access' && (
          <>
            <section className="panel">
              <div className="panel-heading">
                <h2>Pending accounts</h2>
                <span className="count">{pendingUsers.length}</span>
              </div>
              {pendingUsers.length === 0 ? (
                <p className="empty">No accounts are waiting for approval.</p>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Email</th>
                        <th>Invited</th>
                        <th aria-label="Actions" />
                      </tr>
                    </thead>
                    <tbody>
                      {pendingUsers.map((user) => (
                        <tr key={user.id}>
                          <td>{user.name}</td>
                          <td className="mono">{user.email}</td>
                          <td className="muted">{formatDate(user.createdAt)}</td>
                          <td className="actions">
                            <button
                              type="button"
                              className="primary small"
                              disabled={busy === `user-${user.id}`}
                              onClick={() =>
                                void run(`user-${user.id}`, () => api.approveUser(token, user.id))
                              }
                            >
                              Approve
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section className="panel">
              <div className="panel-heading">
                <h2>Devices</h2>
                <div className="segmented" role="group" aria-label="Device status filter">
                  {(['PENDING', 'APPROVED', 'REVOKED', 'ALL'] as DeviceFilter[]).map((filter) => (
                    <button
                      key={filter}
                      type="button"
                      className={deviceFilter === filter ? 'active' : ''}
                      onClick={() => setDeviceFilter(filter)}
                    >
                      {filter === 'ALL' ? 'All' : filter.charAt(0) + filter.slice(1).toLowerCase()}
                    </button>
                  ))}
                </div>
              </div>
              {devices.length === 0 ? (
                <p className="empty">No devices in this state.</p>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Device</th>
                        <th>User</th>
                        <th>Key fingerprint</th>
                        <th>Key proof</th>
                        <th>Attestation</th>
                        <th>Status</th>
                        <th>Registered</th>
                        <th aria-label="Actions" />
                      </tr>
                    </thead>
                    <tbody>
                      {devices.map((device) => (
                        <tr key={device.id}>
                          <td>
                            <div>{device.deviceName}</div>
                          </td>
                          <td className="mono">{device.userEmail ?? device.userId}</td>
                          <td className="mono small-text" title={device.keyFingerprint}>
                            {shortFingerprint(device.keyFingerprint)}
                          </td>
                          <td>
                            <span className={device.proofVerifiedAt ? 'badge ok' : 'badge warn'}>
                              {device.proofVerifiedAt ? 'Verified' : 'Missing'}
                            </span>
                          </td>
                          <td>
                            <span
                              className={`badge ${
                                device.attestationStatus === 'VERIFIED'
                                  ? 'ok'
                                  : device.attestationStatus === 'FAILED'
                                    ? 'status-revoked'
                                    : 'warn'
                              }`}
                            >
                              {device.attestationStatus}
                            </span>
                          </td>
                          <td>
                            <span className={`badge status-${device.status.toLowerCase()}`}>
                              {device.status}
                            </span>
                          </td>
                          <td className="muted">{formatDate(device.createdAt)}</td>
                          <td className="actions">
                            {device.status === 'PENDING' && (
                              <button
                                type="button"
                                className="primary small"
                                disabled={!device.proofVerifiedAt || busy === `device-${device.id}`}
                                title={
                                  device.proofVerifiedAt
                                    ? 'Approve this device'
                                    : 'The app must prove possession of the device key first'
                                }
                                onClick={() =>
                                  void run(`device-${device.id}`, () =>
                                    api.approveDevice(token, device.id),
                                  )
                                }
                              >
                                Approve
                              </button>
                            )}
                            {device.status !== 'REVOKED' && (
                              <button
                                type="button"
                                className="danger small"
                                disabled={busy === `device-${device.id}`}
                                onClick={() => {
                                  if (
                                    window.confirm(
                                      `Revoke ${device.deviceName}? All sessions bound to it will be terminated immediately.`,
                                    )
                                  ) {
                                    void run(`device-${device.id}`, () =>
                                      api.revokeDevice(token, device.id),
                                    );
                                  }
                                }}
                              >
                                Revoke
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section className="panel">
              <div className="panel-heading">
                <h2>Invitations</h2>
                <span className="count">{invitations.length}</span>
              </div>

              <form className="inline-form" onSubmit={handleCreateInvitation}>
                <input
                  type="email"
                  placeholder="person@example.com"
                  value={inviteEmail}
                  onChange={(event) => setInviteEmail(event.target.value)}
                  required
                />
                <button type="submit" className="primary" disabled={busy === 'invite-create'}>
                  {busy === 'invite-create' ? 'Creating…' : 'Create invitation'}
                </button>
              </form>

              {createdInvite && (
                <div className="token-card">
                  <div className="token-heading">
                    <strong>Invitation for {createdInvite.email}</strong>
                    <button type="button" className="ghost small" onClick={() => void copyInviteToken()}>
                      {copied ? 'Copied' : 'Copy token'}
                    </button>
                  </div>
                  <code>{createdInvite.token}</code>
                  <p className="muted small-text">
                    This token is shown once. Send it to the recipient for the Android registration
                    screen.
                  </p>
                </div>
              )}

              {invitations.length === 0 ? (
                <p className="empty">No pending invitations.</p>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Email</th>
                        <th>Expires</th>
                        <th aria-label="Actions" />
                      </tr>
                    </thead>
                    <tbody>
                      {invitations.map((invitation) => (
                        <tr key={invitation.id}>
                          <td className="mono">{invitation.email}</td>
                          <td className="muted">{formatDate(invitation.expiresAt)}</td>
                          <td className="actions">
                            <button
                              type="button"
                              className="danger small"
                              disabled={busy === `invite-${invitation.id}`}
                              onClick={() =>
                                void run(`invite-${invitation.id}`, () =>
                                  api.revokeInvitation(token, invitation.id),
                                )
                              }
                            >
                              Revoke
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}

        {/* Tab 2: Users & Session Revocation */}
        {activeTab === 'users' && (
          <section className="panel">
            <div className="panel-heading">
              <h2>User Accounts</h2>
              <span className="count">{allUsers.length}</span>
            </div>
            {allUsers.length === 0 ? (
              <p className="empty">No users found.</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Email</th>
                      <th>Role</th>
                      <th>Status</th>
                      <th>Created</th>
                      <th aria-label="Actions" />
                    </tr>
                  </thead>
                  <tbody>
                    {allUsers.map((u) => (
                      <tr key={u.id}>
                        <td>{u.name}</td>
                        <td className="mono">{u.email}</td>
                        <td>
                          <span className="badge">{u.role}</span>
                        </td>
                        <td>
                          <span className={`badge status-${u.status.toLowerCase()}`}>{u.status}</span>
                        </td>
                        <td className="muted">{formatDate(u.createdAt)}</td>
                        <td className="actions">
                          {u.status === 'ACTIVE' && u.role !== 'ADMIN' && (
                            <>
                              <button
                                type="button"
                                className="ghost small"
                                disabled={busy === `suspend-${u.id}`}
                                onClick={() => {
                                  if (window.confirm(`Suspend account for ${u.name}?`)) {
                                    void run(`suspend-${u.id}`, () => api.suspendUser(token, u.id));
                                  }
                                }}
                              >
                                Suspend
                              </button>
                              <button
                                type="button"
                                className="danger small"
                                disabled={busy === `disable-${u.id}`}
                                onClick={() => {
                                  if (window.confirm(`Disable account for ${u.name}?`)) {
                                    void run(`disable-${u.id}`, () => api.disableUser(token, u.id));
                                  }
                                }}
                              >
                                Disable
                              </button>
                            </>
                          )}
                          <button
                            type="button"
                            className="danger small"
                            disabled={busy === `sessions-${u.id}`}
                            title="Revoke all active sessions for this user"
                            onClick={() => {
                              if (window.confirm(`Terminate all active sessions for ${u.name}?`)) {
                                void run(`sessions-${u.id}`, () => api.revokeUserSessions(token, u.id));
                              }
                            }}
                          >
                            Revoke Sessions
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {/* Tab 3: Permissions Management */}
        {activeTab === 'permissions' && (
          <section className="panel">
            <div className="panel-heading">
              <h2>Permissions</h2>
              <div className="segmented" role="group" aria-label="Permission status filter">
                {(['ACTIVE', 'REVOKED'] as const).map((filter) => (
                  <button
                    key={filter}
                    type="button"
                    className={permissionFilter === filter ? 'active' : ''}
                    onClick={() => setPermissionFilter(filter)}
                  >
                    {filter === 'ACTIVE' ? 'Active grants' : 'Revoked grants'}
                  </button>
                ))}
              </div>
            </div>
            {permissions.length === 0 ? (
              <p className="empty">No permissions in this state.</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Subject</th>
                      <th>Resource</th>
                      <th>Actions Granted</th>
                      <th>Device Constraint</th>
                      <th>Expires</th>
                      <th>Status</th>
                      <th aria-label="Actions" />
                    </tr>
                  </thead>
                  <tbody>
                    {permissions.map((perm) => (
                      <tr key={perm.id}>
                        <td>
                          <div className="mono small-text">{perm.subjectId}</div>
                          <div className="muted small-text">{perm.subjectType}</div>
                        </td>
                        <td>
                          <div className="mono small-text">{perm.resourceId}</div>
                          <div className="muted small-text">{perm.resourceType}</div>
                        </td>
                        <td>
                          {perm.actions.map((act) => (
                            <span key={act} className="badge ok" style={{ marginRight: '4px' }}>
                              {act}
                            </span>
                          ))}
                        </td>
                        <td className="muted small-text">
                          {perm.deviceIds && perm.deviceIds.length > 0
                            ? `${perm.deviceIds.length} device(s)`
                            : 'All user devices'}
                        </td>
                        <td className="muted">{formatDate(perm.expiresAt)}</td>
                        <td>
                          <span className={`badge status-${perm.status.toLowerCase()}`}>
                            {perm.status}
                          </span>
                        </td>
                        <td className="actions">
                          {perm.status === 'ACTIVE' && (
                            <button
                              type="button"
                              className="danger small"
                              disabled={busy === `perm-${perm.id}`}
                              onClick={() => {
                                if (window.confirm('Revoke this permission? Access will cease immediately.')) {
                                  void run(`perm-${perm.id}`, () => api.revokePermission(token, perm.id));
                                }
                              }}
                            >
                              Revoke
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {/* Tab 4: Audit Trail */}
        {activeTab === 'audit' && (
          <section className="panel">
            <div className="panel-heading">
              <div>
                <h2>Audit Log</h2>
                <p className="muted small-text">Immutable record of security events, auth, device proofs, and denials.</p>
              </div>
              <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                <div className="segmented" role="group" aria-label="Audit result filter">
                  {(['ALL', 'SUCCESS', 'DENIED'] as AuditFilter[]).map((filter) => (
                    <button
                      key={filter}
                      type="button"
                      className={auditResultFilter === filter ? 'active' : ''}
                      onClick={() => setAuditResultFilter(filter)}
                    >
                      {filter === 'ALL' ? 'All' : filter}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  className="ghost small"
                  onClick={exportAuditCsv}
                  disabled={auditEvents.length === 0}
                >
                  Export CSV
                </button>
              </div>
            </div>

            <div className="inline-form" style={{ padding: '0.75rem 1.35rem' }}>
              <input
                type="text"
                placeholder="Filter by event type (e.g. FILE_ACCESS, AUTH_LOGIN, RATE_LIMIT_EXCEEDED)..."
                value={auditEventTypeQuery}
                onChange={(e) => setAuditEventTypeQuery(e.target.value)}
              />
            </div>

            {auditEvents.length === 0 ? (
              <p className="empty">No audit events match the current filter.</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Timestamp</th>
                      <th>Event Type</th>
                      <th>Result</th>
                      <th>Reason</th>
                      <th>Actor / Device</th>
                      <th>IP Address</th>
                      <th>Metadata</th>
                    </tr>
                  </thead>
                  <tbody>
                    {auditEvents.map((event) => (
                      <tr key={event.id}>
                        <td className="muted small-text" style={{ whiteSpace: 'nowrap' }}>
                          {formatDate(event.createdAt)}
                        </td>
                        <td>
                          <span className="mono" style={{ fontWeight: 600 }}>{event.eventType}</span>
                        </td>
                        <td>
                          <span className={`badge result-${event.result.toLowerCase()}`}>
                            {event.result}
                          </span>
                        </td>
                        <td className="mono small-text">{event.reasonCode ?? '—'}</td>
                        <td className="mono small-text">
                          {event.actorUserId && <div>User: {shortFingerprint(event.actorUserId)}</div>}
                          {event.deviceId && <div className="muted">Dev: {shortFingerprint(event.deviceId)}</div>}
                          {!event.actorUserId && !event.deviceId && '—'}
                        </td>
                        <td className="mono small-text">{event.ipAddress ?? '—'}</td>
                        <td className="mono small-text" title={JSON.stringify(event.metadata)}>
                          {Object.keys(event.metadata || {}).length > 0
                            ? JSON.stringify(event.metadata).slice(0, 36) + '…'
                            : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
