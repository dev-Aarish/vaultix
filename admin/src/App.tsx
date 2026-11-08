import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ApiError, api } from './api';
import type { Device, DeviceStatus, Invitation, User } from './types';

const TOKEN_KEY = 'vaultix.admin.token';

type DeviceFilter = DeviceStatus | 'ALL';

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

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loginBusy, setLoginBusy] = useState(false);

  const [pendingUsers, setPendingUsers] = useState<User[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [deviceFilter, setDeviceFilter] = useState<DeviceFilter>('PENDING');
  const [inviteEmail, setInviteEmail] = useState('');
  const [createdInvite, setCreatedInvite] = useState<{ email: string; token: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const logout = useCallback(() => {
    sessionStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setAdmin(null);
    setPendingUsers([]);
    setDevices([]);
    setInvitations([]);
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
  }, [token, admin, deviceFilter, logout]);

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
            <h1>Access control</h1>
            <p className="muted">Approve accounts and bind access to registered devices.</p>
          </div>
          <button type="button" className="ghost" onClick={() => void refresh()} disabled={loading}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </section>

        {error && <div className="alert">{error}</div>}

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
                        <div className="muted small-text">{device.attestationStatus}</div>
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
                                  `Revoke ${device.deviceName}? All sessions bound to it will be terminated.`,
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
      </main>
    </div>
  );
}
