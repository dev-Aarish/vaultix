import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type {
  PermissionAction,
  PermissionResourceType,
  PermissionRow,
  PermissionStatus,
  PermissionSubjectType,
} from '../db/rows';
import { badRequest, conflict, notFound } from '../lib/errors';

export const PERMISSION_ACTIONS: PermissionAction[] = ['VIEW', 'DOWNLOAD', 'EDIT'];

export interface PublicPermission {
  id: string;
  subjectType: PermissionSubjectType;
  subjectId: string;
  resourceType: PermissionResourceType;
  resourceId: string;
  actions: PermissionAction[];
  deviceIds: string[] | null;
  status: PermissionStatus;
  expiresAt: string | null;
  createdBy: string | null;
  createdAt: string;
  revokedAt: string | null;
}

export interface GrantPermissionInput {
  subjectType: PermissionSubjectType;
  subjectId: string;
  resourceType: PermissionResourceType;
  resourceId: string;
  actions: PermissionAction[];
  deviceIds?: string[] | null;
  expiresAt?: Date | null;
  createdBy: string;
}

export interface PermissionFilters {
  subjectType?: PermissionSubjectType;
  subjectId?: string;
  resourceType?: PermissionResourceType;
  resourceId?: string;
  status?: PermissionStatus;
  limit: number;
  offset: number;
}

export function toPublicPermission(row: PermissionRow): PublicPermission {
  return {
    id: row.id,
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    actions: row.actions,
    deviceIds: row.device_ids,
    status: row.status,
    expiresAt: row.expires_at ? row.expires_at.toISOString() : null,
    createdBy: row.created_by,
    createdAt: row.created_at.toISOString(),
    revokedAt: row.revoked_at ? row.revoked_at.toISOString() : null,
  };
}

export class PermissionService {
  constructor(private readonly pool: Pool) {}

  async grant(input: GrantPermissionInput): Promise<PermissionRow> {
    if (input.expiresAt && input.expiresAt.getTime() <= Date.now()) {
      throw badRequest('INVALID_EXPIRY', 'Permission expiry must be in the future');
    }

    await this.validateSubject(input.subjectType, input.subjectId);
    await this.validateResource(input.resourceType, input.resourceId);
    const deviceIds = await this.validateDeviceScope(
      input.subjectType,
      input.subjectId,
      input.deviceIds ?? null,
    );

    const actions = [...new Set(input.actions)];
    if (actions.length === 0) {
      throw badRequest('INVALID_ACTIONS', 'At least one permission action is required');
    }

    const result = await this.pool.query<PermissionRow>(
      `INSERT INTO permissions
         (id, subject_type, subject_id, resource_type, resource_id, actions, device_ids, status, expires_at, created_by)
       VALUES ($1, $2, $3, $4, $5, $6::text[], $7::uuid[], 'ACTIVE', $8, $9)
       ON CONFLICT (subject_type, subject_id, resource_type, resource_id) WHERE status = 'ACTIVE'
       DO UPDATE SET
         actions = EXCLUDED.actions,
         device_ids = EXCLUDED.device_ids,
         expires_at = EXCLUDED.expires_at,
         created_by = EXCLUDED.created_by,
         created_at = now(),
         revoked_at = NULL
       RETURNING *`,
      [
        randomUUID(),
        input.subjectType,
        input.subjectId,
        input.resourceType,
        input.resourceId,
        actions,
        deviceIds,
        input.expiresAt ?? null,
        input.createdBy,
      ],
    );

    const permission = result.rows[0];
    if (!permission) throw new Error('Failed to grant permission');
    return permission;
  }

  async findById(id: string): Promise<PermissionRow | null> {
    const result = await this.pool.query<PermissionRow>('SELECT * FROM permissions WHERE id = $1', [
      id,
    ]);
    return result.rows[0] ?? null;
  }

  async revoke(id: string): Promise<PermissionRow | null> {
    const result = await this.pool.query<PermissionRow>(
      `UPDATE permissions
       SET status = 'REVOKED', revoked_at = now()
       WHERE id = $1 AND status = 'ACTIVE'
       RETURNING *`,
      [id],
    );
    return result.rows[0] ?? null;
  }

  async list(filters: PermissionFilters): Promise<{ items: PermissionRow[]; total: number }> {
    const conditions: string[] = [];
    const values: unknown[] = [];

    const add = (sql: string, value: unknown): void => {
      values.push(value);
      conditions.push(sql.replace('$?', `$${values.length}`));
    };

    if (filters.subjectType) add('subject_type = $?', filters.subjectType);
    if (filters.subjectId) add('subject_id = $?', filters.subjectId);
    if (filters.resourceType) add('resource_type = $?', filters.resourceType);
    if (filters.resourceId) add('resource_id = $?', filters.resourceId);
    if (filters.status) add('status = $?', filters.status);

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await this.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM permissions ${where}`,
      values,
    );

    values.push(filters.limit, filters.offset);
    const itemsResult = await this.pool.query<PermissionRow>(
      `SELECT * FROM permissions ${where}
       ORDER BY created_at DESC, id DESC
       LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values,
    );

    return {
      items: itemsResult.rows,
      total: Number(countResult.rows[0]?.count ?? 0),
    };
  }

  private async validateSubject(subjectType: PermissionSubjectType, subjectId: string): Promise<void> {
    if (subjectType === 'USER') {
      const result = await this.pool.query(
        `SELECT 1 FROM users WHERE id = $1 AND status = 'ACTIVE'`,
        [subjectId],
      );
      if ((result.rowCount ?? 0) === 0) throw notFound('Subject user not found');
      return;
    }

    const result = await this.pool.query(
      `SELECT 1 FROM devices WHERE id = $1 AND status = 'APPROVED'`,
      [subjectId],
    );
    if ((result.rowCount ?? 0) === 0) throw notFound('Subject device not found');
  }

  private async validateResource(
    resourceType: PermissionResourceType,
    resourceId: string,
  ): Promise<void> {
    const table = resourceType === 'FILE' ? 'files' : 'folders';
    const result = await this.pool.query(
      `SELECT 1 FROM ${table} WHERE id = $1 AND status = 'ACTIVE'`,
      [resourceId],
    );
    if ((result.rowCount ?? 0) === 0) throw notFound('Resource not found');
  }

  private async validateDeviceScope(
    subjectType: PermissionSubjectType,
    subjectId: string,
    deviceIds: string[] | null,
  ): Promise<string[] | null> {
    if (deviceIds === null) return null;
    if (subjectType !== 'USER') {
      throw conflict('INVALID_DEVICE_SCOPE', 'Device scope only applies to user permissions');
    }

    const unique = [...new Set(deviceIds)];
    if (unique.length === 0) return null;

    const result = await this.pool.query<{ id: string }>(
      `SELECT id FROM devices
       WHERE id = ANY($1::uuid[]) AND user_id = $2 AND status = 'APPROVED'`,
      [unique, subjectId],
    );
    if (result.rowCount !== unique.length) {
      throw badRequest(
        'INVALID_DEVICE_SCOPE',
        'Every scoped device must belong to the user and be approved',
      );
    }
    return unique;
  }
}
