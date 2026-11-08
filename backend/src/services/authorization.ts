import type { Pool } from 'pg';
import type {
  PermissionAction,
  PermissionResourceType,
  PermissionRow,
  PermissionSubjectType,
} from '../db/rows';

export type DenialReason =
  | 'NO_PERMISSION'
  | 'PERMISSION_REVOKED'
  | 'PERMISSION_EXPIRED'
  | 'ACTION_NOT_PERMITTED'
  | 'DEVICE_NOT_PERMITTED';

export interface ResourceRef {
  type: PermissionResourceType;
  id: string;
}

export interface AccessDecision {
  allowed: boolean;
  actions: Set<PermissionAction>;
  reason: DenialReason | null;
  grantId: string | null;
}

export type PermissionDecisions = Map<string, PermissionRow>;

function decisionKey(
  subjectType: PermissionSubjectType,
  resourceType: PermissionResourceType,
  resourceId: string,
): string {
  return `${subjectType}:${resourceType}:${resourceId}`;
}

export class AuthorizationService {
  constructor(private readonly pool: Pool) {}

  async loadDecisions(userId: string, deviceId: string | null): Promise<PermissionDecisions> {
    const result = await this.pool.query<PermissionRow>(
      `SELECT * FROM permissions
       WHERE (subject_type = 'USER' AND subject_id = $1)
          OR ($2::uuid IS NOT NULL AND subject_type = 'DEVICE' AND subject_id = $2)
       ORDER BY created_at DESC, id DESC`,
      [userId, deviceId],
    );

    const decisions: PermissionDecisions = new Map();
    for (const row of result.rows) {
      const key = decisionKey(row.subject_type, row.resource_type, row.resource_id);
      if (!decisions.has(key)) decisions.set(key, row);
    }
    return decisions;
  }

  resolve(
    decisions: PermissionDecisions,
    chain: ResourceRef[],
    deviceId: string | null,
  ): AccessDecision {
    const userGrant = this.firstDecision(decisions, 'USER', chain);
    if (!userGrant) {
      return { allowed: false, actions: new Set(), reason: 'NO_PERMISSION', grantId: null };
    }

    const userEvaluation = evaluate(userGrant, deviceId);
    if (!userEvaluation.allowed) {
      return {
        allowed: false,
        actions: new Set(),
        reason: userEvaluation.reason,
        grantId: userGrant.id,
      };
    }

    let actions = new Set(userEvaluation.actions);
    const deviceGrant = this.firstDecision(decisions, 'DEVICE', chain);
    if (deviceGrant) {
      const deviceEvaluation = evaluate(deviceGrant, deviceId);
      if (!deviceEvaluation.allowed) {
        return {
          allowed: false,
          actions: new Set(),
          reason: deviceEvaluation.reason,
          grantId: deviceGrant.id,
        };
      }
      actions = new Set(
        [...actions].filter((action) => deviceEvaluation.actions.has(action)),
      );
    }

    if (actions.size === 0) {
      return {
        allowed: false,
        actions,
        reason: 'ACTION_NOT_PERMITTED',
        grantId: userGrant.id,
      };
    }

    return { allowed: true, actions, reason: null, grantId: userGrant.id };
  }

  private firstDecision(
    decisions: PermissionDecisions,
    subjectType: PermissionSubjectType,
    chain: ResourceRef[],
  ): PermissionRow | null {
    for (const resource of chain) {
      const row = decisions.get(decisionKey(subjectType, resource.type, resource.id));
      if (row) return row;
    }
    return null;
  }
}

function evaluate(
  row: PermissionRow,
  deviceId: string | null,
): { allowed: boolean; actions: Set<PermissionAction>; reason: DenialReason | null } {
  if (row.status === 'REVOKED') {
    return { allowed: false, actions: new Set(), reason: 'PERMISSION_REVOKED' };
  }
  if (row.expires_at && row.expires_at.getTime() <= Date.now()) {
    return { allowed: false, actions: new Set(), reason: 'PERMISSION_EXPIRED' };
  }
  if (
    row.subject_type === 'USER' &&
    row.device_ids !== null &&
    (deviceId === null || !row.device_ids.includes(deviceId))
  ) {
    return { allowed: false, actions: new Set(), reason: 'DEVICE_NOT_PERMITTED' };
  }

  const actions = new Set<PermissionAction>(row.actions);
  if (actions.size === 0) {
    return { allowed: false, actions, reason: 'ACTION_NOT_PERMITTED' };
  }
  return { allowed: true, actions, reason: null };
}

export function allows(decision: AccessDecision, actions: PermissionAction[]): boolean {
  return decision.allowed && actions.every((action) => decision.actions.has(action));
}

export function allowedActions(decision: AccessDecision): PermissionAction[] {
  return decision.allowed ? [...decision.actions] : [];
}
