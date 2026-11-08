import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import type { Express } from 'express';
import type { Pool } from 'pg';
import request, { type Response as SupertestResponse } from 'supertest';
import { afterAll, beforeAll, beforeEach } from 'vitest';
import { createApp } from '../src/app';
import { loadConfig, type AppConfig } from '../src/config';
import { createContext, type AppContext } from '../src/context';
import { createPool } from '../src/db/pool';
import { runMigrations } from '../src/db/migrate';
import type { UserRow } from '../src/db/rows';
import { hashPassword } from '../src/lib/password';
import { UserService } from '../src/services/users';

export interface TestHarness {
  config: AppConfig;
  pool: Pool;
  ctx: AppContext;
  app: Express;
}

export const ADMIN_EMAIL = 'admin@example.com';
export const ADMIN_PASSWORD = 'admin-password-123';
export const USER_PASSWORD = 'user-password-123';

export function useTestHarness(): TestHarness {
  const config = loadConfig();
  const pool = createPool(config);
  const ctx = createContext(config, pool);
  const app = createApp(ctx);

  beforeAll(async () => {
    await runMigrations(pool);
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE audit_events, sessions, invitations, users CASCADE');
  });

  afterAll(async () => {
    await pool.end();
  });

  return { config, pool, ctx, app };
}

export async function seedAdmin(
  harness: TestHarness,
  email = ADMIN_EMAIL,
  password = ADMIN_PASSWORD,
): Promise<UserRow> {
  return UserService.createAdmin(harness.pool, {
    name: 'Administrator',
    email,
    passwordHash: await hashPassword(password),
    emailVerified: true,
  });
}

export async function login(
  app: Express,
  email: string,
  password: string,
): Promise<SupertestResponse> {
  return request(app).post('/auth/login').send({ email, password });
}

export async function loginToken(
  app: Express,
  email: string,
  password: string,
): Promise<string> {
  const response = await login(app, email, password);
  if (response.status !== 200) {
    throw new Error(`Login failed for ${email}: ${response.status} ${JSON.stringify(response.body)}`);
  }
  return response.body.data.token as string;
}

export async function invite(
  app: Express,
  adminToken: string,
  email: string,
): Promise<{ invitation: { id: string; email: string }; token: string }> {
  const response = await request(app)
    .post('/admin/invitations')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ email });
  if (response.status !== 201) {
    throw new Error(`Invitation failed: ${response.status} ${JSON.stringify(response.body)}`);
  }
  return response.body.data;
}

export async function register(
  app: Express,
  token: string,
  name = 'Test User',
  password = USER_PASSWORD,
): Promise<SupertestResponse> {
  return request(app).post('/auth/register').send({ token, name, password });
}

export async function approveUser(
  app: Express,
  adminToken: string,
  userId: string,
): Promise<void> {
  const response = await request(app)
    .post(`/admin/users/${userId}/approve`)
    .set('Authorization', `Bearer ${adminToken}`);
  if (response.status !== 200) {
    throw new Error(`Approval failed: ${response.status} ${JSON.stringify(response.body)}`);
  }
}

export interface ActiveUser {
  user: UserRow;
  token: string;
  password: string;
}

export async function createActiveUser(
  harness: TestHarness,
  adminToken: string,
  email: string,
  password = USER_PASSWORD,
): Promise<ActiveUser> {
  const { token: invitationToken } = await invite(harness.app, adminToken, email);
  const registration = await register(harness.app, invitationToken, 'Regular User', password);
  if (registration.status !== 201) {
    throw new Error(
      `Registration failed: ${registration.status} ${JSON.stringify(registration.body)}`,
    );
  }
  const userId = registration.body.data.user.id as string;
  await approveUser(harness.app, adminToken, userId);
  const token = await loginToken(harness.app, email, password);
  const user = await harness.ctx.users.findById(userId);
  if (!user) throw new Error('Expected user to exist after registration');
  return { user, token, password };
}

export function bearer(token: string): string {
  return `Bearer ${token}`;
}

export interface TestDeviceKey {
  publicKey: string;
  privateKey: KeyObject;
  sign(challenge: string): string;
}

export function createDeviceKey(): TestDeviceKey {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const publicKeyDer = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  return {
    publicKey: publicKeyDer,
    privateKey,
    sign(challenge: string): string {
      return sign('sha256', Buffer.from(challenge, 'utf8'), {
        key: privateKey,
        dsaEncoding: 'der',
      }).toString('base64');
    },
  };
}

export async function registerDevice(
  app: Express,
  token: string,
  deviceName = 'Test Device',
  key: TestDeviceKey = createDeviceKey(),
): Promise<{
  device: { id: string; status: string; proofVerifiedAt: string | null };
  challenge: { id: string; challenge: string; purpose: string; expiresAt: string };
  key: TestDeviceKey;
}> {
  const response = await request(app)
    .post('/devices/register')
    .set('Authorization', bearer(token))
    .send({ deviceName, publicKey: key.publicKey });
  if (response.status !== 201) {
    throw new Error(
      `Device registration failed: ${response.status} ${JSON.stringify(response.body)}`,
    );
  }
  return { ...response.body.data, key };
}

export async function verifyDevice(
  app: Express,
  token: string,
  deviceId: string,
  challenge: { id: string; challenge: string },
  key: TestDeviceKey,
): Promise<SupertestResponse> {
  return request(app)
    .post('/devices/verify')
    .set('Authorization', bearer(token))
    .send({
      deviceId,
      challengeId: challenge.id,
      signature: key.sign(challenge.challenge),
    });
}

export async function approveDevice(
  app: Express,
  adminToken: string,
  deviceId: string,
): Promise<SupertestResponse> {
  return request(app)
    .post(`/admin/devices/${deviceId}/approve`)
    .set('Authorization', bearer(adminToken));
}
