import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { AuditEventRow, AuditResult } from '../db/rows';
import type { Logger } from '../lib/logger';

export interface AuditEventInput {
  actorUserId?: string | null;
  deviceId?: string | null;
  eventType: string;
  resourceType?: string | null;
  resourceId?: string | null;
  result: AuditResult;
  reasonCode?: string | null;
  ipAddress?: string | null;
  metadata?: Record<string, unknown>;
}

export interface PublicAuditEvent {
  id: string;
  actorUserId: string | null;
  deviceId: string | null;
  eventType: string;
  resourceType: string | null;
  resourceId: string | null;
  result: AuditResult;
  reasonCode: string | null;
  ipAddress: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export function toPublicAuditEvent(row: AuditEventRow): PublicAuditEvent {
  return {
    id: row.id,
    actorUserId: row.actor_user_id,
    deviceId: row.device_id,
    eventType: row.event_type,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    result: row.result,
    reasonCode: row.reason_code,
    ipAddress: row.ip_address,
    metadata: row.metadata,
    createdAt: row.created_at.toISOString(),
  };
}

export interface AuditEventFilters {
  actorUserId?: string;
  eventType?: string;
  result?: AuditResult;
  resourceType?: string;
  resourceId?: string;
  from?: Date;
  to?: Date;
  limit: number;
  offset: number;
}

export class AuditService {
  constructor(
    private readonly pool: Pool,
    private readonly logger: Logger,
  ) {}

  async record(input: AuditEventInput): Promise<void> {
    try {
      await this.pool.query(
        `INSERT INTO audit_events
           (id, actor_user_id, device_id, event_type, resource_type, resource_id, result, reason_code, ip_address, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)`,
        [
          randomUUID(),
          input.actorUserId ?? null,
          input.deviceId ?? null,
          input.eventType,
          input.resourceType ?? null,
          input.resourceId ?? null,
          input.result,
          input.reasonCode ?? null,
          input.ipAddress ?? null,
          JSON.stringify(input.metadata ?? {}),
        ],
      );
    } catch (error) {
      this.logger.error(
        { err: error, eventType: input.eventType, result: input.result },
        'failed to record audit event',
      );
    }
  }

  async list(filters: AuditEventFilters): Promise<{ items: AuditEventRow[]; total: number }> {
    const conditions: string[] = [];
    const values: unknown[] = [];

    const add = (sql: string, value: unknown): void => {
      values.push(value);
      conditions.push(sql.replace('$?', `$${values.length}`));
    };

    if (filters.actorUserId) add('actor_user_id = $?', filters.actorUserId);
    if (filters.eventType) add('event_type = $?', filters.eventType);
    if (filters.result) add('result = $?', filters.result);
    if (filters.resourceType) add('resource_type = $?', filters.resourceType);
    if (filters.resourceId) add('resource_id = $?', filters.resourceId);
    if (filters.from) add('created_at >= $?', filters.from);
    if (filters.to) add('created_at <= $?', filters.to);

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await this.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM audit_events ${where}`,
      values,
    );

    values.push(filters.limit, filters.offset);
    const limitPlaceholder = `$${values.length - 1}`;
    const offsetPlaceholder = `$${values.length}`;

    const itemsResult = await this.pool.query<AuditEventRow>(
      `SELECT * FROM audit_events ${where}
       ORDER BY created_at DESC, id DESC
       LIMIT ${limitPlaceholder} OFFSET ${offsetPlaceholder}`,
      values,
    );

    return {
      items: itemsResult.rows,
      total: Number(countResult.rows[0]?.count ?? 0),
    };
  }
}
