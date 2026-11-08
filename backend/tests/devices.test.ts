import { generateKeyPairSync } from 'node:crypto';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import type { UserRow } from '../src/db/rows';
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  approveDevice,
  bearer,
  createActiveUser,
  createDeviceKey,
  loginToken,
  registerDevice,
  seedAdmin,
  useTestHarness,
  verifyDevice,
  type TestDeviceKey,
} from './helpers';

const harness = useTestHarness();
const { app, pool, ctx } = harness;

interface Setup {
  adminToken: string;
  userToken: string;
  user: UserRow;
}

async function setupUser(email = 'device-user@example.com'): Promise<Setup> {
  await seedAdmin(harness);
  const adminToken = await loginToken(app, ADMIN_EMAIL, ADMIN_PASSWORD);
  const { token: userToken, user } = await createActiveUser(harness, adminToken, email);
  return { adminToken, userToken, user };
}

async function provisionVerifiedDevice(
  setup: Setup,
  key: TestDeviceKey = createDeviceKey(),
): Promise<{ deviceId: string; key: TestDeviceKey }> {
  const registered = await registerDevice(app, setup.userToken, 'Pixel Test', key);
  const proof = await verifyDevice(
    app,
    setup.userToken,
    registered.device.id,
    registered.challenge,
    key,
  );
  expect(proof.status).toBe(200);
  return { deviceId: registered.device.id, key };
}

describe('device registration', () => {
  it('registers a device and records proof of possession without approving it', async () => {
    const setup = await setupUser();
    const key = createDeviceKey();

    const registered = await registerDevice(app, setup.userToken, 'Pixel Test', key);
    expect(registered.device.status).toBe('PENDING');
    expect(registered.device.proofVerifiedAt).toBeNull();
    expect(registered.challenge.purpose).toBe('REGISTRATION');

    const proof = await verifyDevice(
      app,
      setup.userToken,
      registered.device.id,
      registered.challenge,
      key,
    );
    expect(proof.status).toBe(200);
    expect(proof.body.data.device.status).toBe('PENDING');
    expect(proof.body.data.device.proofVerifiedAt).toBeTypeOf('string');

    const meDevices = await request(app)
      .get('/me/devices')
      .set('Authorization', bearer(setup.userToken));
    expect(meDevices.status).toBe(200);
    expect(meDevices.body.data).toHaveLength(1);
    expect(meDevices.body.data[0].id).toBe(registered.device.id);
    expect(meDevices.body.data[0]).not.toHaveProperty('publicKey');
  });

  it('rejects malformed and non-P-256 public keys', async () => {
    const setup = await setupUser();

    const malformed = await request(app)
      .post('/devices/register')
      .set('Authorization', bearer(setup.userToken))
      .send({ deviceName: 'Bad Key', publicKey: 'not-a-public-key' });
    expect(malformed.status).toBe(400);
    expect(malformed.body.error.code).toBe('INVALID_PUBLIC_KEY');

    const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const rsaDer = rsa.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
    const wrongAlgorithm = await request(app)
      .post('/devices/register')
      .set('Authorization', bearer(setup.userToken))
      .send({ deviceName: 'RSA Key', publicKey: rsaDer });
    expect(wrongAlgorithm.status).toBe(400);
    expect(wrongAlgorithm.body.error.code).toBe('INVALID_PUBLIC_KEY');
  });

  it('rejects a replayed registration challenge', async () => {
    const setup = await setupUser();
    const key = createDeviceKey();
    const registered = await registerDevice(app, setup.userToken, 'Replay Test', key);

    const first = await verifyDevice(
      app,
      setup.userToken,
      registered.device.id,
      registered.challenge,
      key,
    );
    expect(first.status).toBe(200);

    const replay = await verifyDevice(
      app,
      setup.userToken,
      registered.device.id,
      registered.challenge,
      key,
    );
    expect(replay.status).toBe(400);
    expect(replay.body.error.code).toBe('INVALID_CHALLENGE');
  });

  it('rejects a challenge signed by a different key', async () => {
    const setup = await setupUser();
    const registered = await registerDevice(app, setup.userToken, 'Wrong Key', createDeviceKey());
    const attacker = createDeviceKey();

    const response = await verifyDevice(
      app,
      setup.userToken,
      registered.device.id,
      registered.challenge,
      attacker,
    );
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_SIGNATURE');
  });

  it('rejects an expired challenge', async () => {
    const setup = await setupUser();
    const key = createDeviceKey();
    const registered = await registerDevice(app, setup.userToken, 'Expired', key);

    await pool.query(
      `UPDATE device_challenges SET expires_at = now() - interval '1 minute' WHERE id = $1`,
      [registered.challenge.id],
    );

    const response = await verifyDevice(
      app,
      setup.userToken,
      registered.device.id,
      registered.challenge,
      key,
    );
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_CHALLENGE');
  });

  it("does not let a user touch another user's device", async () => {
    const setup = await setupUser('owner@example.com');
    const registered = await registerDevice(app, setup.userToken, 'Owned Device');

    const other = await createActiveUser(harness, setup.adminToken, 'other@example.com');
    const response = await request(app)
      .post('/devices/challenge')
      .set('Authorization', bearer(other.token))
      .send({ deviceId: registered.device.id, purpose: 'REGISTRATION' });

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
  });
});

describe('device approval and session binding', () => {
  it('refuses to approve a device whose key proof is missing', async () => {
    const setup = await setupUser();
    const registered = await registerDevice(app, setup.userToken, 'Unproven');

    const response = await approveDevice(app, setup.adminToken, registered.device.id);
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('DEVICE_PROOF_REQUIRED');
  });

  it('refuses a session challenge before approval', async () => {
    const setup = await setupUser();
    const { deviceId } = await provisionVerifiedDevice(setup);

    const response = await request(app)
      .post('/devices/challenge')
      .set('Authorization', bearer(setup.userToken))
      .send({ deviceId, purpose: 'SESSION' });
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('DEVICE_NOT_APPROVED');
  });

  it('binds the session to an approved device after challenge verification', async () => {
    const setup = await setupUser();
    const { deviceId, key } = await provisionVerifiedDevice(setup);

    const approval = await approveDevice(app, setup.adminToken, deviceId);
    expect(approval.status).toBe(200);
    expect(approval.body.data.device.status).toBe('APPROVED');

    const challengeResponse = await request(app)
      .post('/devices/challenge')
      .set('Authorization', bearer(setup.userToken))
      .send({ deviceId, purpose: 'SESSION' });
    expect(challengeResponse.status).toBe(200);

    const bound = await verifyDevice(
      app,
      setup.userToken,
      deviceId,
      challengeResponse.body.data.challenge,
      key,
    );
    expect(bound.status).toBe(200);
    expect(bound.body.data.deviceBound).toBe(true);

    const me = await request(app)
      .get('/auth/me')
      .set('Authorization', bearer(setup.userToken));
    expect(me.status).toBe(200);
    expect(me.body.data.device).toMatchObject({ id: deviceId, status: 'APPROVED' });

    const sessionRows = await pool.query(
      'SELECT device_id FROM sessions WHERE user_id = $1 AND revoked_at IS NULL',
      [setup.user.id],
    );
    expect(sessionRows.rowCount).toBe(1);
    expect(sessionRows.rows[0].device_id).toBe(deviceId);

    const approveAgain = await approveDevice(app, setup.adminToken, deviceId);
    expect(approveAgain.status).toBe(409);
  });

  it('revokes a device and its bound sessions', async () => {
    const setup = await setupUser();
    const { deviceId, key } = await provisionVerifiedDevice(setup);
    await approveDevice(app, setup.adminToken, deviceId);

    const challengeResponse = await request(app)
      .post('/devices/challenge')
      .set('Authorization', bearer(setup.userToken))
      .send({ deviceId, purpose: 'SESSION' });
    await verifyDevice(
      app,
      setup.userToken,
      deviceId,
      challengeResponse.body.data.challenge,
      key,
    );

    const revocation = await request(app)
      .post(`/admin/devices/${deviceId}/revoke`)
      .set('Authorization', bearer(setup.adminToken));
    expect(revocation.status).toBe(200);
    expect(revocation.body.data.device.status).toBe('REVOKED');
    expect(revocation.body.data.revokedSessions).toBe(1);

    const afterRevocation = await request(app)
      .get('/auth/me')
      .set('Authorization', bearer(setup.userToken));
    expect(afterRevocation.status).toBe(401);

    const freshToken = await loginToken(app, 'device-user@example.com', 'user-password-123');
    const challengeAfterRevocation = await request(app)
      .post('/devices/challenge')
      .set('Authorization', bearer(freshToken))
      .send({ deviceId, purpose: 'SESSION' });
    expect(challengeAfterRevocation.status).toBe(409);
    expect(challengeAfterRevocation.body.error.code).toBe('DEVICE_REVOKED');

    const revokeAgain = await request(app)
      .post(`/admin/devices/${deviceId}/revoke`)
      .set('Authorization', bearer(setup.adminToken));
    expect(revokeAgain.status).toBe(409);
  });

  it('lists devices for administrators with user context', async () => {
    const setup = await setupUser();
    const { deviceId } = await provisionVerifiedDevice(setup);

    const response = await request(app)
      .get('/admin/devices?status=PENDING')
      .set('Authorization', bearer(setup.adminToken));
    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0]).toMatchObject({
      id: deviceId,
      userEmail: 'device-user@example.com',
      status: 'PENDING',
      attestationStatus: 'UNVERIFIED',
    });
  });

  it('records device audit events', async () => {
    const setup = await setupUser();
    const { deviceId, key } = await provisionVerifiedDevice(setup);
    await approveDevice(app, setup.adminToken, deviceId);
    const challengeResponse = await request(app)
      .post('/devices/challenge')
      .set('Authorization', bearer(setup.userToken))
      .send({ deviceId, purpose: 'SESSION' });
    await verifyDevice(
      app,
      setup.userToken,
      deviceId,
      challengeResponse.body.data.challenge,
      key,
    );

    const events = await pool.query(
      `SELECT event_type, result FROM audit_events WHERE device_id = $1 ORDER BY created_at`,
      [deviceId],
    );
    const types = events.rows.map((row) => `${row.event_type}:${row.result}`);
    expect(types).toContain('DEVICE_REGISTER:SUCCESS');
    expect(types).toContain('DEVICE_VERIFY:SUCCESS');
    expect(types).toContain('ADMIN_DEVICE_APPROVE:SUCCESS');
    expect(types).toContain('DEVICE_SESSION_BIND:SUCCESS');

    const denied = await ctx.audit.list({
      eventType: 'DEVICE_VERIFY',
      result: 'DENIED',
      limit: 10,
      offset: 0,
    });
    expect(denied.total).toBe(0);
  });
});
