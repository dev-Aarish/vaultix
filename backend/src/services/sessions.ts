import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { AppConfig } from '../config';
import type { SessionRow } from '../db/rows';
import { generateToken, hashToken } from '../lib/tokens';

export interface CreateSessionInput {
  userId: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface CreatedSession {
  token: string;
  session: SessionRow;
}

export class SessionService {
  constructor(
    private readonly pool: Pool,
    private readonly config: AppConfig,
  ) {}

  async create(input: CreateSessionInput): Promise<CreatedSession> {
    const { token, tokenHash } = generateToken();
    const expiresAt = new Date(Date.now() + this.config.sessionTtlHours * 60 * 60 * 1000);

    const result = await this.pool.query<SessionRow>(
      `INSERT INTO sessions (id, user_id, token_hash, expires_at, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        randomUUID(),
        input.userId,
        tokenHash,
        expiresAt,
        input.ipAddress ?? null,
        input.userAgent ?? null,
      ],
    );

    const session = result.rows[0];
    if (!session) throw new Error('Failed to create session');
    return { token, session };
  }

  async findValidByToken(token: string): Promise<SessionRow | null> {
    const result = await this.pool.query<SessionRow>(
      `SELECT * FROM sessions
       WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now()`,
      [hashToken(token)],
    );
    return result.rows[0] ?? null;
  }

  async touch(sessionId: string): Promise<void> {
    await this.pool.query('UPDATE sessions SET last_activity_at = now() WHERE id = $1', [sessionId]);
  }

  async revoke(sessionId: string): Promise<boolean> {
    const result = await this.pool.query(
      'UPDATE sessions SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL',
      [sessionId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async revokeAllForUser(userId: string, exceptSessionId?: string): Promise<number> {
    const result = await this.pool.query(
      `UPDATE sessions SET revoked_at = now()
       WHERE user_id = $1 AND revoked_at IS NULL AND ($2::uuid IS NULL OR id <> $2)`,
      [userId, exceptSessionId ?? null],
    );
    return result.rowCount ?? 0;
  }

  async listActiveForUser(userId: string): Promise<SessionRow[]> {
    const result = await this.pool.query<SessionRow>(
      `SELECT * FROM sessions
       WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now()
       ORDER BY last_activity_at DESC`,
      [userId],
    );
    return result.rows;
  }
}
