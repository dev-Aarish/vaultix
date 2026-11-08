import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { AppConfig } from '../config';
import type { InvitationRow, UserRow } from '../db/rows';

export type RegistrationFailure =
  | 'INVALID_INVITATION'
  | 'INVITATION_USED'
  | 'INVITATION_EXPIRED'
  | 'EMAIL_IN_USE';

export type RegistrationResult =
  | { ok: true; user: UserRow; invitation: InvitationRow }
  | { ok: false; reason: RegistrationFailure; invitation: InvitationRow | null };

export interface RegisterInput {
  tokenHash: string;
  name: string;
  passwordHash: string;
}

export class RegistrationService {
  constructor(
    private readonly pool: Pool,
    private readonly config: AppConfig,
  ) {}

  async register(input: RegisterInput): Promise<RegistrationResult> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const invitationResult = await client.query<InvitationRow>(
        'SELECT * FROM invitations WHERE token_hash = $1 FOR UPDATE',
        [input.tokenHash],
      );
      const invitation = invitationResult.rows[0] ?? null;

      if (!invitation || invitation.revoked_at !== null) {
        await client.query('ROLLBACK');
        return { ok: false, reason: 'INVALID_INVITATION', invitation };
      }
      if (invitation.used_at !== null) {
        await client.query('ROLLBACK');
        return { ok: false, reason: 'INVITATION_USED', invitation };
      }
      if (invitation.expires_at.getTime() <= Date.now()) {
        await client.query('ROLLBACK');
        return { ok: false, reason: 'INVITATION_EXPIRED', invitation };
      }

      const existing = await client.query('SELECT 1 FROM users WHERE lower(email) = lower($1)', [
        invitation.email,
      ]);
      if ((existing.rowCount ?? 0) > 0) {
        await client.query('ROLLBACK');
        return { ok: false, reason: 'EMAIL_IN_USE', invitation };
      }

      const status = this.config.requireAdminApproval ? 'PENDING' : 'ACTIVE';
      const userResult = await client.query<UserRow>(
        `INSERT INTO users (id, name, email, password_hash, role, status, email_verified_at)
         VALUES ($1, $2, $3, $4, $5, $6, now())
         RETURNING *`,
        [randomUUID(), input.name, invitation.email, input.passwordHash, invitation.role, status],
      );
      const user = userResult.rows[0];
      if (!user) throw new Error('Failed to create user');

      await client.query('UPDATE invitations SET used_at = now() WHERE id = $1', [invitation.id]);
      await client.query('COMMIT');

      return { ok: true, user, invitation };
    } catch (error) {
      await client.query('ROLLBACK');
      if (isUniqueViolation(error)) {
        return { ok: false, reason: 'EMAIL_IN_USE', invitation: null };
      }
      throw error;
    } finally {
      client.release();
    }
  }
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}
