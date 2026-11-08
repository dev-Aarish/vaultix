import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { UserRole, UserRow, UserStatus } from '../db/rows';
import { conflict } from '../lib/errors';

export interface PublicUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  emailVerifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateUserInput {
  name: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  status: UserStatus;
  emailVerified: boolean;
}

export interface UserFilters {
  status?: UserStatus;
  role?: UserRole;
  email?: string;
  limit: number;
  offset: number;
}

export function toPublicUser(row: UserRow): PublicUser {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    status: row.status,
    emailVerifiedAt: row.email_verified_at ? row.email_verified_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export class UserService {
  constructor(private readonly pool: Pool) {}

  async findById(id: string): Promise<UserRow | null> {
    const result = await this.pool.query<UserRow>('SELECT * FROM users WHERE id = $1', [id]);
    return result.rows[0] ?? null;
  }

  async findByEmail(email: string): Promise<UserRow | null> {
    const result = await this.pool.query<UserRow>(
      'SELECT * FROM users WHERE lower(email) = lower($1)',
      [email],
    );
    return result.rows[0] ?? null;
  }

  async create(input: CreateUserInput): Promise<UserRow> {
    const result = await this.pool.query<UserRow>(
      `INSERT INTO users (id, name, email, password_hash, role, status, email_verified_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        randomUUID(),
        input.name,
        input.email,
        input.passwordHash,
        input.role,
        input.status,
        input.emailVerified ? new Date() : null,
      ],
    );
    const user = result.rows[0];
    if (!user) throw new Error('Failed to create user');
    return user;
  }

  async approve(id: string): Promise<UserRow | null> {
    return this.updateStatus(id, 'ACTIVE', ['PENDING'], false);
  }

  async suspend(id: string): Promise<UserRow | null> {
    return this.updateStatus(id, 'SUSPENDED', ['PENDING', 'ACTIVE'], true);
  }

  async disable(id: string): Promise<UserRow | null> {
    return this.updateStatus(id, 'DISABLED', ['PENDING', 'ACTIVE', 'SUSPENDED'], true);
  }

  private async updateStatus(
    id: string,
    status: UserStatus,
    allowedFrom: UserStatus[],
    revokeSessions: boolean,
  ): Promise<UserRow | null> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const updated = await client.query<UserRow>(
        `UPDATE users
         SET status = $2, updated_at = now()
         WHERE id = $1 AND status = ANY($3::text[])
         RETURNING *`,
        [id, status, allowedFrom],
      );
      const user = updated.rows[0] ?? null;
      if (!user) {
        await client.query('ROLLBACK');
        return null;
      }
      if (revokeSessions) {
        await client.query(
          'UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL',
          [id],
        );
      }
      await client.query('COMMIT');
      return user;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async list(filters: UserFilters): Promise<{ items: UserRow[]; total: number }> {
    const conditions: string[] = [];
    const values: unknown[] = [];

    const add = (sql: string, value: unknown): void => {
      values.push(value);
      conditions.push(sql.replace('$?', `$${values.length}`));
    };

    if (filters.status) add('status = $?', filters.status);
    if (filters.role) add('role = $?', filters.role);
    if (filters.email) add('email ILIKE $?', `%${filters.email}%`);

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await this.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM users ${where}`,
      values,
    );

    values.push(filters.limit, filters.offset);
    const itemsResult = await this.pool.query<UserRow>(
      `SELECT * FROM users ${where}
       ORDER BY created_at DESC, id DESC
       LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values,
    );

    return {
      items: itemsResult.rows,
      total: Number(countResult.rows[0]?.count ?? 0),
    };
  }

  static async createAdmin(pool: Pool, input: Omit<CreateUserInput, 'role' | 'status'>): Promise<UserRow> {
    const existing = await pool.query<UserRow>(
      'SELECT * FROM users WHERE lower(email) = lower($1)',
      [input.email],
    );
    if (existing.rows[0]) {
      const updated = await pool.query<UserRow>(
        `UPDATE users
         SET name = $2, password_hash = $3, role = 'ADMIN', status = 'ACTIVE',
             email_verified_at = COALESCE(email_verified_at, now()), updated_at = now()
         WHERE id = $1
         RETURNING *`,
        [existing.rows[0].id, input.name, input.passwordHash],
      );
      const user = updated.rows[0];
      if (!user) throw conflict('USER_UPDATE_FAILED', 'Failed to update administrator');
      return user;
    }

    return new UserService(pool).create({
      ...input,
      role: 'ADMIN',
      status: 'ACTIVE',
      emailVerified: true,
    });
  }
}
