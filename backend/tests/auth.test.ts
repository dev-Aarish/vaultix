import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { hashToken } from '../src/lib/tokens';
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  USER_PASSWORD,
  createActiveUser,
  invite,
  login,
  loginToken,
  register,
  seedAdmin,
  useTestHarness,
} from './helpers';

const harness = useTestHarness();
const { app, pool } = harness;

describe('authentication', () => {
  it('registers a pending account from an invitation and allows login after approval', async () => {
    await seedAdmin(harness);
    const adminToken = await loginToken(app, ADMIN_EMAIL, ADMIN_PASSWORD);
    const { invitation, token } = await invite(app, adminToken, 'Person.A@Example.com');

    expect(invitation.email).toBe('person.a@example.com');
    expect(token).toBeTypeOf('string');
    expect(token.length).toBeGreaterThan(30);

    const registration = await register(app, token, 'Person A');
    expect(registration.status).toBe(201);
    expect(registration.body.data.user).toMatchObject({
      email: 'person.a@example.com',
      status: 'PENDING',
      role: 'USER',
    });
    expect(JSON.stringify(registration.body)).not.toContain('password_hash');
    expect(registration.body.data.user).not.toHaveProperty('passwordHash');

    const pendingLogin = await login(app, 'person.a@example.com', USER_PASSWORD);
    expect(pendingLogin.status).toBe(403);
    expect(pendingLogin.body.error.code).toBe('ACCOUNT_NOT_ACTIVE');

    const userId = registration.body.data.user.id as string;
    const approval = await request(app)
      .post(`/admin/users/${userId}/approve`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(approval.status).toBe(200);
    expect(approval.body.data.user.status).toBe('ACTIVE');

    const activeLogin = await login(app, 'person.a@example.com', USER_PASSWORD);
    expect(activeLogin.status).toBe(200);
    expect(activeLogin.body.data.token).toBeTypeOf('string');
    expect(activeLogin.body.data.expiresAt).toBeTypeOf('string');
    expect(activeLogin.body.data.user.status).toBe('ACTIVE');

    const me = await request(app)
      .get('/auth/me')
      .set('Authorization', `Bearer ${activeLogin.body.data.token as string}`);
    expect(me.status).toBe(200);
    expect(me.body.data.user.email).toBe('person.a@example.com');
  });

  it('rejects an invalid invitation token', async () => {
    const response = await register(app, 'invalid-invitation-token-000000', 'Nobody');
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_INVITATION');
  });

  it('rejects a re-used invitation token', async () => {
    await seedAdmin(harness);
    const adminToken = await loginToken(app, ADMIN_EMAIL, ADMIN_PASSWORD);
    const { token } = await invite(app, adminToken, 'reuse@example.com');

    expect((await register(app, token)).status).toBe(201);

    const second = await register(app, token);
    expect(second.status).toBe(400);
    expect(second.body.error.code).toBe('INVITATION_USED');
  });

  it('rejects an expired invitation token', async () => {
    const token = 'expired-invitation-token-1234567890';
    await pool.query(
      `INSERT INTO invitations (id, email, token_hash, role, expires_at)
       VALUES ($1, $2, $3, 'USER', now() - interval '1 hour')`,
      [randomUUID(), 'expired@example.com', hashToken(token)],
    );

    const response = await register(app, token);
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVITATION_EXPIRED');
  });

  it('enforces the configured password policy', async () => {
    await seedAdmin(harness);
    const adminToken = await loginToken(app, ADMIN_EMAIL, ADMIN_PASSWORD);
    const { token } = await invite(app, adminToken, 'weak@example.com');

    const response = await register(app, token, 'Weak Password', 'too-short');
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns the same generic error for unknown email and wrong password', async () => {
    await seedAdmin(harness);
    const adminToken = await loginToken(app, ADMIN_EMAIL, ADMIN_PASSWORD);
    await createActiveUser(harness, adminToken, 'known@example.com');

    const unknown = await login(app, 'unknown@example.com', USER_PASSWORD);
    const wrong = await login(app, 'known@example.com', 'not-the-right-password');

    expect(unknown.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(unknown.body.error.message).toBe('Invalid email or password');
    expect(wrong.body.error.message).toBe('Invalid email or password');
  });

  it('invalidates the session on logout', async () => {
    await seedAdmin(harness);
    const adminToken = await loginToken(app, ADMIN_EMAIL, ADMIN_PASSWORD);
    const { token } = await createActiveUser(harness, adminToken, 'logout@example.com');

    const me = await request(app).get('/auth/me').set('Authorization', `Bearer ${token}`);
    expect(me.status).toBe(200);

    const logout = await request(app)
      .post('/auth/logout')
      .set('Authorization', `Bearer ${token}`);
    expect(logout.status).toBe(204);

    const afterLogout = await request(app)
      .get('/auth/me')
      .set('Authorization', `Bearer ${token}`);
    expect(afterLogout.status).toBe(401);
    expect(afterLogout.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('rejects expired sessions', async () => {
    await seedAdmin(harness);
    const adminToken = await loginToken(app, ADMIN_EMAIL, ADMIN_PASSWORD);
    const { token, user } = await createActiveUser(harness, adminToken, 'expiring@example.com');

    await pool.query(
      `UPDATE sessions SET expires_at = now() - interval '1 minute' WHERE user_id = $1`,
      [user.id],
    );

    const response = await request(app)
      .get('/auth/me')
      .set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(401);
  });

  it('requires a bearer token for protected routes', async () => {
    const response = await request(app).get('/auth/me');
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('blocks revoked sessions after a user is suspended', async () => {
    await seedAdmin(harness);
    const adminToken = await loginToken(app, ADMIN_EMAIL, ADMIN_PASSWORD);
    const { token, user } = await createActiveUser(harness, adminToken, 'suspended@example.com');

    const suspension = await request(app)
      .post(`/admin/users/${user.id}/suspend`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(suspension.status).toBe(200);
    expect(suspension.body.data.user.status).toBe('SUSPENDED');

    const afterSuspension = await request(app)
      .get('/auth/me')
      .set('Authorization', `Bearer ${token}`);
    expect(afterSuspension.status).toBe(401);

    const loginAttempt = await login(app, 'suspended@example.com', USER_PASSWORD);
    expect(loginAttempt.status).toBe(403);
    expect(loginAttempt.body.error.code).toBe('ACCOUNT_NOT_ACTIVE');
  });
});
