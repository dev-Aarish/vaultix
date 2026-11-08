import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
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
const { app, pool, ctx } = harness;

async function setupAdmin(): Promise<string> {
  await seedAdmin(harness);
  return loginToken(app, ADMIN_EMAIL, ADMIN_PASSWORD);
}

describe('admin authorization', () => {
  it('rejects anonymous and non-administrator access', async () => {
    const adminToken = await setupAdmin();
    const { token: userToken } = await createActiveUser(harness, adminToken, 'plain@example.com');

    const anonymous = await request(app).get('/admin/users');
    expect(anonymous.status).toBe(401);

    const nonAdmin = await request(app)
      .get('/admin/users')
      .set('Authorization', `Bearer ${userToken}`);
    expect(nonAdmin.status).toBe(403);
    expect(nonAdmin.body.error.code).toBe('FORBIDDEN');

    const deniedEvents = await pool.query(
      `SELECT * FROM audit_events WHERE event_type = 'ADMIN_ACCESS' AND result = 'DENIED'`,
    );
    expect(deniedEvents.rowCount).toBe(1);
    expect(deniedEvents.rows[0].actor_user_id).toBeTypeOf('string');
  });
});

describe('admin invitations', () => {
  it('creates, lists and revokes invitations', async () => {
    const adminToken = await setupAdmin();
    const created = await request(app)
      .post('/admin/invitations')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ email: 'Invited@Example.com' });

    expect(created.status).toBe(201);
    expect(created.body.data.invitation.email).toBe('invited@example.com');
    expect(created.body.data.token).toBeTypeOf('string');

    const listed = await request(app)
      .get('/admin/invitations?status=pending')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(listed.status).toBe(200);
    expect(listed.body.data).toHaveLength(1);
    expect(listed.body.data[0]).not.toHaveProperty('token');
    expect(listed.body.data[0]).not.toHaveProperty('tokenHash');

    const invitationId = created.body.data.invitation.id as string;
    const revoked = await request(app)
      .delete(`/admin/invitations/${invitationId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(revoked.status).toBe(200);
    expect(revoked.body.data.invitation.revokedAt).toBeTypeOf('string');

    const pendingAfterRevoke = await request(app)
      .get('/admin/invitations?status=pending')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(pendingAfterRevoke.body.data).toHaveLength(0);

    const revokedAgain = await request(app)
      .delete(`/admin/invitations/${invitationId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(revokedAgain.status).toBe(409);

    const registration = await register(app, created.body.data.token as string);
    expect(registration.status).toBe(400);
    expect(registration.body.error.code).toBe('INVALID_INVITATION');
  });

  it('refuses to invite an email that already has an account', async () => {
    const adminToken = await setupAdmin();
    await createActiveUser(harness, adminToken, 'existing@example.com');

    const response = await request(app)
      .post('/admin/invitations')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ email: 'existing@example.com' });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('EMAIL_IN_USE');
  });

  it('returns 404 for an unknown invitation', async () => {
    const adminToken = await setupAdmin();
    const response = await request(app)
      .delete(`/admin/invitations/${randomUUID()}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(response.status).toBe(404);
  });
});

describe('admin user management', () => {
  it('rejects approving a user that is not pending', async () => {
    const adminToken = await setupAdmin();
    const { user } = await createActiveUser(harness, adminToken, 'already-active@example.com');

    const response = await request(app)
      .post(`/admin/users/${user.id}/approve`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('INVALID_STATUS_TRANSITION');
  });

  it('suspends and disables users and blocks further logins', async () => {
    const adminToken = await setupAdmin();
    const { user } = await createActiveUser(harness, adminToken, 'moderate@example.com');

    const suspension = await request(app)
      .post(`/admin/users/${user.id}/suspend`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(suspension.status).toBe(200);

    const suspendedLogin = await login(app, 'moderate@example.com', USER_PASSWORD);
    expect(suspendedLogin.status).toBe(403);

    const disabled = await request(app)
      .post(`/admin/users/${user.id}/disable`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(disabled.status).toBe(200);
    expect(disabled.body.data.user.status).toBe('DISABLED');

    const disabledLogin = await login(app, 'moderate@example.com', USER_PASSWORD);
    expect(disabledLogin.status).toBe(403);

    const disableAgain = await request(app)
      .post(`/admin/users/${user.id}/disable`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(disableAgain.status).toBe(409);
  });

  it('revokes every active session for a user', async () => {
    const adminToken = await setupAdmin();
    const { user } = await createActiveUser(harness, adminToken, 'multi-session@example.com');
    const secondToken = await loginToken(app, 'multi-session@example.com', USER_PASSWORD);

    const revocation = await request(app)
      .post(`/admin/users/${user.id}/sessions/revoke`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(revocation.status).toBe(200);
    expect(revocation.body.data.revokedSessions).toBe(2);

    for (const token of [secondToken]) {
      const response = await request(app)
        .get('/auth/me')
        .set('Authorization', `Bearer ${token}`);
      expect(response.status).toBe(401);
    }

    const sessions = await pool.query(
      'SELECT count(*)::int AS count FROM sessions WHERE user_id = $1 AND revoked_at IS NULL',
      [user.id],
    );
    expect(sessions.rows[0].count).toBe(0);
  });

  it('returns 404 for an unknown user', async () => {
    const adminToken = await setupAdmin();
    const response = await request(app)
      .post(`/admin/users/${randomUUID()}/approve`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(response.status).toBe(404);
  });
});

describe('admin audit log', () => {
  it('records authentication outcomes and filters by event type and result', async () => {
    const adminToken = await setupAdmin();
    await login(app, ADMIN_EMAIL, 'wrong-password');

    const successes = await request(app)
      .get('/admin/audit-events?eventType=AUTH_LOGIN&result=SUCCESS')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(successes.status).toBe(200);
    expect(successes.body.data).toHaveLength(1);
    expect(
      successes.body.data.every(
        (event: { eventType: string; result: string }) =>
          event.eventType === 'AUTH_LOGIN' && event.result === 'SUCCESS',
      ),
    ).toBe(true);

    const denials = await request(app)
      .get('/admin/audit-events?eventType=AUTH_LOGIN&result=DENIED')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(denials.status).toBe(200);
    expect(denials.body.data).toHaveLength(1);
    expect(denials.body.data[0].reasonCode).toBe('INVALID_CREDENTIALS');
    expect(denials.body.data[0].ipAddress).toBeTypeOf('string');
  });

  it('never stores passwords or session tokens in audit metadata', async () => {
    const adminToken = await setupAdmin();
    const { user } = await createActiveUser(harness, adminToken, 'audit@example.com');

    const events = await pool.query('SELECT * FROM audit_events');
    const serialised = JSON.stringify(events.rows);
    const userPasswordHash = (
      await pool.query('SELECT password_hash FROM users WHERE id = $1', [user.id])
    ).rows[0].password_hash as string;

    expect(serialised).not.toContain(USER_PASSWORD);
    expect(serialised).not.toContain(userPasswordHash);
    expect(serialised).not.toContain('password_hash');
    expect(serialised).not.toContain(adminToken);
  });
});
