import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { AppConfig } from '../config';
import type { InvitationRow, UserRole } from '../db/rows';
import { generateToken } from '../lib/tokens';

export interface PublicInvitation {
  id: string;
  email: string;
  role: UserRole;
  createdBy: string | null;
  expiresAt: string;
  usedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export interface CreateInvitationInput {
  email: string;
  role: UserRole;
  createdBy: string;
}

export interface InvitationFilters {
  status?: 'pending' | 'used' | 'revoked' | 'expired' | 'all';
  email?: string;
  limit: number;
  offset: number;
}

export function toPublicInvitation(row: InvitationRow): PublicInvitation {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    createdBy: row.created_by,
    expiresAt: row.expires_at.toISOString(),
    usedAt: row.used_at ? row.used_at.toISOString() : null,
    revokedAt: row.revoked_at ? row.revoked_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
  };
}

export class InvitationService {
  constructor(
    private readonly pool: Pool,
    private readonly config: AppConfig,
  ) {}

  async create(input: CreateInvitationInput): Promise<{ invitation: InvitationRow; token: string }> {
    const { token, tokenHash } = generateToken();
    const expiresAt = new Date(Date.now() + this.config.invitationTtlHours * 60 * 60 * 1000);

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Rotate any outstanding invitation for the same address.
      await client.query(
        `UPDATE invitations SET revoked_at = now()
         WHERE lower(email) = lower($1)
           AND used_at IS NULL AND revoked_at IS NULL AND expires_at > now()`,
        [input.email],
      );

      const result = await client.query<InvitationRow>(
        `INSERT INTO invitations (id, email, token_hash, role, created_by, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [randomUUID(), input.email, tokenHash, input.role, input.createdBy, expiresAt],
      );

      const invitation = result.rows[0];
      if (!invitation) throw new Error('Failed to create invitation');
      await client.query('COMMIT');
      return { invitation, token };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async findById(id: string): Promise<InvitationRow | null> {
    const result = await this.pool.query<InvitationRow>('SELECT * FROM invitations WHERE id = $1', [
      id,
    ]);
    return result.rows[0] ?? null;
  }

  async revoke(id: string): Promise<InvitationRow | null> {
    const result = await this.pool.query<InvitationRow>(
      `UPDATE invitations SET revoked_at = now()
       WHERE id = $1 AND revoked_at IS NULL AND used_at IS NULL
       RETURNING *`,
      [id],
    );
    return result.rows[0] ?? null;
  }

  async list(filters: InvitationFilters): Promise<{ items: InvitationRow[]; total: number }> {
    const conditions: string[] = [];
    const values: unknown[] = [];

    const add = (sql: string, value: unknown): void => {
      values.push(value);
      conditions.push(sql.replace('$?', `$${values.length}`));
    };

    switch (filters.status) {
      case 'pending':
        conditions.push('used_at IS NULL AND revoked_at IS NULL AND expires_at > now()');
        break;
      case 'used':
        conditions.push('used_at IS NOT NULL');
        break;
      case 'revoked':
        conditions.push('revoked_at IS NOT NULL');
        break;
      case 'expired':
        conditions.push('used_at IS NULL AND revoked_at IS NULL AND expires_at <= now()');
        break;
      default:
        break;
    }

    if (filters.email) add('email ILIKE $?', `%${filters.email}%`);

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await this.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM invitations ${where}`,
      values,
    );

    values.push(filters.limit, filters.offset);
    const itemsResult = await this.pool.query<InvitationRow>(
      `SELECT * FROM invitations ${where}
       ORDER BY created_at DESC, id DESC
       LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values,
    );

    return {
      items: itemsResult.rows,
      total: Number(countResult.rows[0]?.count ?? 0),
    };
  }
}
