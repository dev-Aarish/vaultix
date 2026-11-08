import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  bearer,
  createBoundUser,
  createDeviceKey,
  grantPermission,
  loginToken,
  seedAdmin,
  uploadFile,
  useTestHarness,
} from './helpers';

const harness = useTestHarness();
const { app, pool } = harness;

async function setupAdmin(): Promise<string> {
  await seedAdmin(harness);
  return loginToken(app, ADMIN_EMAIL, ADMIN_PASSWORD);
}

describe('Phase 5: Audit, revocation and hardening', () => {
  it('revokes a specific session via POST /admin/sessions/revoke and blocks subsequent access', async () => {
    const adminToken = await setupAdmin();
    const { token, user } = await createBoundUser(harness, adminToken, 'target@example.com');

    // User can access /auth/me
    const before = await request(app).get('/auth/me').set('Authorization', bearer(token));
    expect(before.status).toBe(200);

    // List user sessions
    const sessionsRes = await request(app)
      .get(`/admin/users/${user.id}/sessions`)
      .set('Authorization', bearer(adminToken));
    expect(sessionsRes.status).toBe(200);
    expect(sessionsRes.body.data.length).toBeGreaterThan(0);
    const targetSessionId = sessionsRes.body.data[0].id;

    // Admin revokes session by sessionId
    const revokeRes = await request(app)
      .post('/admin/sessions/revoke')
      .set('Authorization', bearer(adminToken))
      .send({ sessionId: targetSessionId });
    expect(revokeRes.status).toBe(200);
    expect(revokeRes.body.data.revokedCount).toBe(1);

    // Subsequent call with that session token is rejected
    const after = await request(app).get('/auth/me').set('Authorization', bearer(token));
    expect(after.status).toBe(401);
    expect(after.body.error.code).toBe('UNAUTHENTICATED');

    // Verify audit event
    const audit = await pool.query(
      `SELECT * FROM audit_events WHERE event_type = 'ADMIN_SESSIONS_REVOKE' AND resource_id = $1`,
      [targetSessionId],
    );
    expect(audit.rowCount).toBeGreaterThan(0);
    expect(audit.rows[0].result).toBe('SUCCESS');
  });

  it('revokes all sessions for a user via POST /admin/sessions/revoke with userId', async () => {
    const adminToken = await setupAdmin();
    const { token, user } = await createBoundUser(harness, adminToken, 'multisession@example.com');

    // Admin revokes by userId
    const revokeRes = await request(app)
      .post('/admin/sessions/revoke')
      .set('Authorization', bearer(adminToken))
      .send({ userId: user.id });
    expect(revokeRes.status).toBe(200);
    expect(revokeRes.body.data.revokedCount).toBeGreaterThanOrEqual(1);

    const check = await request(app).get('/auth/me').set('Authorization', bearer(token));
    expect(check.status).toBe(401);
  });

  it('immediately blocks file viewing and downloading when permission is revoked', async () => {
    const adminToken = await setupAdmin();
    const file = await uploadFile(app, adminToken, {
      name: 'confidential.pdf',
      data: '%PDF-1.4 confidential data',
      mimeType: 'application/pdf',
    });
    const { token, user } = await createBoundUser(harness, adminToken, 'reader5@example.com');

    const perm = await grantPermission(app, adminToken, {
      subjectType: 'USER',
      subjectId: user.id,
      resourceType: 'FILE',
      resourceId: file.id,
      actions: ['VIEW', 'DOWNLOAD'],
    });

    // Content is accessible initially
    const openBefore = await request(app)
      .post(`/files/${file.id}/open`)
      .set('Authorization', bearer(token));
    expect(openBefore.status).toBe(200);

    const streamBefore = await request(app)
      .get(`/files/${file.id}/content`)
      .set('Authorization', bearer(token));
    expect(streamBefore.status).toBe(200);

    // Admin revokes permission
    const deletePerm = await request(app)
      .delete(`/admin/permissions/${perm.id}`)
      .set('Authorization', bearer(adminToken));
    expect(deletePerm.status).toBe(200);

    // Content is immediately blocked on next request
    const openAfter = await request(app)
      .post(`/files/${file.id}/open`)
      .set('Authorization', bearer(token));
    expect(openAfter.status).toBe(404);

    const streamAfter = await request(app)
      .get(`/files/${file.id}/content`)
      .set('Authorization', bearer(token));
    expect(streamAfter.status).toBe(404);

    // Denied audit event recorded
    const deniedAudit = await pool.query(
      `SELECT * FROM audit_events WHERE event_type = 'FILE_ACCESS' AND result = 'DENIED' AND actor_user_id = $1`,
      [user.id],
    );
    expect(deniedAudit.rowCount).toBeGreaterThan(0);
  });

  it('records device attestation status during registration and exposes it to admin', async () => {
    const adminToken = await setupAdmin();
    const { token, user } = await createBoundUser(harness, adminToken, 'attested@example.com');
    const deviceKey = createDeviceKey();

    // Register a new device with attestationStatus 'VERIFIED'
    const regRes = await request(app)
      .post('/devices/register')
      .set('Authorization', bearer(token))
      .send({
        deviceName: 'Pixel 9 Pro',
        publicKey: deviceKey.publicKey,
        attestationStatus: 'VERIFIED',
      });
    expect(regRes.status).toBe(201);
    expect(regRes.body.data.device.attestationStatus).toBe('VERIFIED');

    // Admin lists devices and sees attestation status
    const adminDevices = await request(app)
      .get(`/admin/devices?userId=${user.id}`)
      .set('Authorization', bearer(adminToken));
    expect(adminDevices.status).toBe(200);
    const found = adminDevices.body.data.find(
      (d: { id: string }) => d.id === regRes.body.data.device.id,
    );
    expect(found).toBeDefined();
    expect(found.attestationStatus).toBe('VERIFIED');
  });

  it('enforces rate limits and records RATE_LIMIT_EXCEEDED audit event when enabled', async () => {
    // Dynamically test rate limiter middleware directly
    const { createRateLimiter } = await import('../src/middleware/rate-limit');
    const customCtx = {
      ...harness.ctx,
      config: { ...harness.ctx.config, rateLimitEnabled: true },
    };

    const limiter = createRateLimiter(customCtx, {
      windowMs: 10_000,
      max: 2,
      recordAudit: true,
      keyGenerator: () => 'test-ip-1.2.3.4',
    });

    const mockReq: any = {
      path: '/test',
      method: 'POST',
      auth: null,
      headers: {},
      ip: '1.2.3.4',
    };
    const headersSet: Record<string, string> = {};
    const mockRes: any = {
      setHeader: (k: string, v: string) => {
        headersSet[k] = v;
      },
    };

    let nextCalls = 0;
    let nextError: any = null;

    // Call 1: pass
    await limiter(mockReq, mockRes, (err) => {
      if (err) nextError = err;
      else nextCalls++;
    });
    expect(nextCalls).toBe(1);
    expect(headersSet['X-RateLimit-Remaining']).toBe('1');

    // Call 2: pass
    await limiter(mockReq, mockRes, (err) => {
      if (err) nextError = err;
      else nextCalls++;
    });
    expect(nextCalls).toBe(2);
    expect(headersSet['X-RateLimit-Remaining']).toBe('0');

    // Call 3: blocked (exceeds max: 2)
    await limiter(mockReq, mockRes, (err) => {
      nextError = err;
    });
    expect(nextError).toBeDefined();
    expect(nextError.statusCode).toBe(429);
    expect(nextError.code).toBe('RATE_LIMIT_EXCEEDED');
    expect(headersSet['Retry-After']).toBeDefined();

    // Verify audit event
    const audit = await pool.query(
      `SELECT * FROM audit_events WHERE event_type = 'RATE_LIMIT_EXCEEDED' AND result = 'DENIED'`,
    );
    expect(audit.rowCount).toBeGreaterThan(0);
  });
});
