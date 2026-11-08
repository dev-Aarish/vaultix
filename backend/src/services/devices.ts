import { randomBytes, randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type {
  DeviceAttestationStatus,
  DeviceChallengePurpose,
  DeviceChallengeRow,
  DeviceRow,
  DeviceStatus,
} from '../db/rows';
import { conflict } from '../lib/errors';

export interface PublicDevice {
  id: string;
  userId: string;
  deviceName: string;
  keyFingerprint: string;
  attestationStatus: DeviceAttestationStatus;
  status: DeviceStatus;
  proofVerifiedAt: string | null;
  createdAt: string;
  lastSeenAt: string | null;
  revokedAt: string | null;
}

export interface AdminDevice extends PublicDevice {
  userEmail: string;
  userName: string;
}

export interface CreateDeviceInput {
  userId: string;
  deviceName: string;
  publicKeyPem: string;
  keyFingerprint: string;
}

export interface DeviceFilters {
  status?: DeviceStatus;
  userId?: string;
  limit: number;
  offset: number;
}

interface DeviceWithUserRow extends DeviceRow {
  user_email: string;
  user_name: string;
}

export function toPublicDevice(row: DeviceRow): PublicDevice {
  return {
    id: row.id,
    userId: row.user_id,
    deviceName: row.device_name,
    keyFingerprint: row.key_fingerprint,
    attestationStatus: row.attestation_status,
    status: row.status,
    proofVerifiedAt: row.proof_verified_at ? row.proof_verified_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
    lastSeenAt: row.last_seen_at ? row.last_seen_at.toISOString() : null,
    revokedAt: row.revoked_at ? row.revoked_at.toISOString() : null,
  };
}

export function toAdminDevice(row: DeviceWithUserRow): AdminDevice {
  return {
    ...toPublicDevice(row),
    userEmail: row.user_email,
    userName: row.user_name,
  };
}

export class DeviceService {
  constructor(private readonly pool: Pool) {}

  async create(input: CreateDeviceInput): Promise<DeviceRow> {
    try {
      const result = await this.pool.query<DeviceRow>(
        `INSERT INTO devices (id, user_id, device_name, public_key, key_fingerprint, attestation_status, status)
         VALUES ($1, $2, $3, $4, $5, 'UNVERIFIED', 'PENDING')
         RETURNING *`,
        [randomUUID(), input.userId, input.deviceName, input.publicKeyPem, input.keyFingerprint],
      );
      const device = result.rows[0];
      if (!device) throw new Error('Failed to create device');
      return device;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw conflict(
          'DEVICE_ALREADY_REGISTERED',
          'A device with this public key has already been registered',
        );
      }
      throw error;
    }
  }

  async findById(id: string): Promise<DeviceRow | null> {
    const result = await this.pool.query<DeviceRow>('SELECT * FROM devices WHERE id = $1', [id]);
    return result.rows[0] ?? null;
  }

  async findByIdForUser(id: string, userId: string): Promise<DeviceRow | null> {
    const result = await this.pool.query<DeviceRow>(
      'SELECT * FROM devices WHERE id = $1 AND user_id = $2',
      [id, userId],
    );
    return result.rows[0] ?? null;
  }

  async listForUser(userId: string): Promise<DeviceRow[]> {
    const result = await this.pool.query<DeviceRow>(
      'SELECT * FROM devices WHERE user_id = $1 ORDER BY created_at DESC, id DESC',
      [userId],
    );
    return result.rows;
  }

  async list(filters: DeviceFilters): Promise<{ items: DeviceWithUserRow[]; total: number }> {
    const conditions: string[] = [];
    const values: unknown[] = [];

    const add = (sql: string, value: unknown): void => {
      values.push(value);
      conditions.push(sql.replace('$?', `$${values.length}`));
    };

    if (filters.status) add('d.status = $?', filters.status);
    if (filters.userId) add('d.user_id = $?', filters.userId);

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await this.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM devices d ${where}`,
      values,
    );

    values.push(filters.limit, filters.offset);
    const itemsResult = await this.pool.query<DeviceWithUserRow>(
      `SELECT d.*, u.email AS user_email, u.name AS user_name
       FROM devices d
       JOIN users u ON u.id = d.user_id
       ${where}
       ORDER BY d.created_at DESC, d.id DESC
       LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values,
    );

    return {
      items: itemsResult.rows,
      total: Number(countResult.rows[0]?.count ?? 0),
    };
  }

  async createChallenge(
    deviceId: string,
    purpose: DeviceChallengePurpose,
    ttlMinutes: number,
  ): Promise<DeviceChallengeRow> {
    const challenge = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE device_challenges SET used_at = now()
         WHERE device_id = $1 AND purpose = $2 AND used_at IS NULL`,
        [deviceId, purpose],
      );
      const result = await client.query<DeviceChallengeRow>(
        `INSERT INTO device_challenges (id, device_id, challenge, purpose, expires_at)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [randomUUID(), deviceId, challenge, purpose, expiresAt],
      );
      const row = result.rows[0];
      if (!row) throw new Error('Failed to create device challenge');
      await client.query('COMMIT');
      return row;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async consumeChallenge(
    challengeId: string,
    deviceId: string,
  ): Promise<DeviceChallengeRow | null> {
    const result = await this.pool.query<DeviceChallengeRow>(
      `UPDATE device_challenges SET used_at = now()
       WHERE id = $1 AND device_id = $2 AND used_at IS NULL AND expires_at > now()
       RETURNING *`,
      [challengeId, deviceId],
    );
    return result.rows[0] ?? null;
  }

  async markProofVerified(id: string): Promise<DeviceRow | null> {
    const result = await this.pool.query<DeviceRow>(
      `UPDATE devices SET proof_verified_at = COALESCE(proof_verified_at, now()), last_seen_at = now()
       WHERE id = $1 AND status <> 'REVOKED'
       RETURNING *`,
      [id],
    );
    return result.rows[0] ?? null;
  }

  async approve(id: string): Promise<DeviceRow | null> {
    const result = await this.pool.query<DeviceRow>(
      `UPDATE devices SET status = 'APPROVED', last_seen_at = now()
       WHERE id = $1 AND status = 'PENDING' AND proof_verified_at IS NOT NULL
       RETURNING *`,
      [id],
    );
    return result.rows[0] ?? null;
  }

  async revoke(id: string): Promise<{ device: DeviceRow | null; revokedSessions: number }> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const updated = await client.query<DeviceRow>(
        `UPDATE devices SET status = 'REVOKED', revoked_at = now()
         WHERE id = $1 AND status <> 'REVOKED'
         RETURNING *`,
        [id],
      );
      const device = updated.rows[0] ?? null;
      if (!device) {
        await client.query('ROLLBACK');
        return { device: null, revokedSessions: 0 };
      }
      const sessions = await client.query(
        `UPDATE sessions SET revoked_at = now()
         WHERE device_id = $1 AND revoked_at IS NULL`,
        [id],
      );
      await client.query('COMMIT');
      return { device, revokedSessions: sessions.rowCount ?? 0 };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async bindSession(sessionId: string, deviceId: string): Promise<void> {
    await this.pool.query('UPDATE sessions SET device_id = $2 WHERE id = $1', [
      sessionId,
      deviceId,
    ]);
  }
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}
