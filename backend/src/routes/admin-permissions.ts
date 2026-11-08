import { Router } from 'express';
import { z } from 'zod';
import type { AppContext } from '../context';
import { conflict, notFound } from '../lib/errors';
import { getAuth, requireAdmin, requireAuth } from '../middleware/auth';
import { getClientIp, parse, parseBody, parseQuery } from '../middleware/validate';
import {
  PERMISSION_ACTIONS,
  toPublicPermission,
} from '../services/permissions';

const paginationFields = {
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
};

const actionSchema = z.enum(PERMISSION_ACTIONS);

const grantSchema = z.strictObject({
  subjectType: z.enum(['USER', 'DEVICE']),
  subjectId: z.uuid(),
  resourceType: z.enum(['FILE', 'FOLDER']),
  resourceId: z.uuid(),
  actions: z.array(actionSchema).min(1).max(PERMISSION_ACTIONS.length),
  deviceIds: z.array(z.uuid()).max(100).nullable().optional(),
  expiresAt: z.coerce.date().nullable().optional(),
});

const permissionListSchema = z.object({
  subjectType: z.enum(['USER', 'DEVICE']).optional(),
  subjectId: z.uuid().optional(),
  resourceType: z.enum(['FILE', 'FOLDER']).optional(),
  resourceId: z.uuid().optional(),
  status: z.enum(['ACTIVE', 'REVOKED']).optional(),
  ...paginationFields,
});

const idSchema = z.uuid();

export function adminPermissionsRouter(ctx: AppContext): Router {
  const router = Router();
  router.use(requireAuth(ctx), requireAdmin(ctx));

  router.post('/permissions', async (req, res) => {
    const body = parseBody(grantSchema, req);
    const permission = await ctx.permissions.grant({
      subjectType: body.subjectType,
      subjectId: body.subjectId,
      resourceType: body.resourceType,
      resourceId: body.resourceId,
      actions: body.actions,
      deviceIds: body.deviceIds ?? null,
      expiresAt: body.expiresAt ?? null,
      createdBy: getAuth(req).user.id,
    });

    await ctx.audit.record({
      actorUserId: getAuth(req).user.id,
      eventType: 'PERMISSION_GRANT',
      result: 'SUCCESS',
      resourceType: permission.resource_type,
      resourceId: permission.resource_id,
      ipAddress: getClientIp(req),
      metadata: {
        permissionId: permission.id,
        subjectType: permission.subject_type,
        subjectId: permission.subject_id,
        actions: permission.actions,
        deviceIds: permission.device_ids,
        expiresAt: permission.expires_at?.toISOString() ?? null,
      },
    });

    res.status(201).json({ data: { permission: toPublicPermission(permission) } });
  });

  router.get('/permissions', async (req, res) => {
    const filters = parseQuery(permissionListSchema, req);
    const { items, total } = await ctx.permissions.list(filters);
    res.json({
      data: items.map(toPublicPermission),
      pagination: { total, limit: filters.limit, offset: filters.offset },
    });
  });

  router.delete('/permissions/:id', async (req, res) => {
    const id = parse(idSchema, req.params.id);
    const permission = await ctx.permissions.findById(id);
    if (!permission) throw notFound('Permission not found');

    const revoked = await ctx.permissions.revoke(id);
    if (!revoked) {
      throw conflict('PERMISSION_NOT_REVOCABLE', 'Permission is already revoked');
    }

    await ctx.audit.record({
      actorUserId: getAuth(req).user.id,
      eventType: 'PERMISSION_REVOKE',
      result: 'SUCCESS',
      resourceType: revoked.resource_type,
      resourceId: revoked.resource_id,
      ipAddress: getClientIp(req),
      metadata: {
        permissionId: revoked.id,
        subjectType: revoked.subject_type,
        subjectId: revoked.subject_id,
      },
    });

    res.json({ data: { permission: toPublicPermission(revoked) } });
  });

  return router;
}
