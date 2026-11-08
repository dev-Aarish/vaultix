import { Router } from 'express';
import { z } from 'zod';
import type { AppContext } from '../context';
import { conflict, notFound } from '../lib/errors';
import { getAuth, requireAdmin, requireAuth } from '../middleware/auth';
import { getClientIp, parse, parseBody, parseQuery } from '../middleware/validate';
import { toPublicAuditEvent } from '../services/audit';
import { toAdminDevice, toPublicDevice } from '../services/devices';
import { toPublicInvitation } from '../services/invitations';
import { toPublicUser } from '../services/users';

const paginationFields = {
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
};

const createInvitationSchema = z.strictObject({
  email: z.email().transform((value) => value.trim().toLowerCase()),
  role: z.enum(['ADMIN', 'USER']).default('USER'),
});

const invitationListSchema = z.object({
  status: z.enum(['pending', 'used', 'revoked', 'expired', 'all']).default('all'),
  email: z.string().trim().min(1).max(320).optional(),
  ...paginationFields,
});

const userListSchema = z.object({
  status: z.enum(['PENDING', 'ACTIVE', 'SUSPENDED', 'DISABLED']).optional(),
  role: z.enum(['ADMIN', 'USER']).optional(),
  email: z.string().trim().min(1).max(320).optional(),
  ...paginationFields,
});

const deviceListSchema = z.object({
  status: z.enum(['PENDING', 'APPROVED', 'REVOKED']).optional(),
  userId: z.uuid().optional(),
  ...paginationFields,
});

const auditListSchema = z.object({
  actorUserId: z.uuid().optional(),
  eventType: z.string().trim().min(1).max(100).optional(),
  result: z.enum(['SUCCESS', 'DENIED']).optional(),
  resourceType: z.string().trim().min(1).max(100).optional(),
  resourceId: z.string().trim().min(1).max(200).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  ...paginationFields,
});

const idSchema = z.uuid();

const revokeSessionsBodySchema = z
  .strictObject({
    userId: z.uuid().optional(),
    sessionId: z.uuid().optional(),
  })
  .refine((data) => data.userId !== undefined || data.sessionId !== undefined, {
    message: 'Either userId or sessionId must be provided',
  });

export function adminRouter(ctx: AppContext): Router {
  const router = Router();
  router.use(requireAuth(ctx), requireAdmin(ctx));

  router.post('/invitations', async (req, res) => {
    const body = parseBody(createInvitationSchema, req);

    const existingUser = await ctx.users.findByEmail(body.email);
    if (existingUser) {
      throw conflict('EMAIL_IN_USE', 'An account already exists for this email address');
    }

    const { invitation, token } = await ctx.invitations.create({
      email: body.email,
      role: body.role,
      createdBy: getAuth(req).user.id,
    });

    await ctx.audit.record({
      actorUserId: getAuth(req).user.id,
      eventType: 'ADMIN_INVITATION_CREATE',
      result: 'SUCCESS',
      resourceType: 'INVITATION',
      resourceId: invitation.id,
      ipAddress: getClientIp(req),
      metadata: { email: invitation.email, role: invitation.role },
    });

    res.status(201).json({
      data: {
        invitation: toPublicInvitation(invitation),
        token,
      },
    });
  });

  router.get('/invitations', async (req, res) => {
    const filters = parseQuery(invitationListSchema, req);
    const { items, total } = await ctx.invitations.list(filters);
    res.json({
      data: items.map(toPublicInvitation),
      pagination: { total, limit: filters.limit, offset: filters.offset },
    });
  });

  router.delete('/invitations/:id', async (req, res) => {
    const id = parse(idSchema, req.params.id);
    const invitation = await ctx.invitations.findById(id);
    if (!invitation) throw notFound('Invitation not found');
    if (invitation.used_at !== null || invitation.revoked_at !== null) {
      throw conflict('INVITATION_NOT_REVOCABLE', 'Invitation has already been used or revoked');
    }

    const revoked = await ctx.invitations.revoke(id);
    if (!revoked) {
      throw conflict('INVITATION_NOT_REVOCABLE', 'Invitation has already been used or revoked');
    }

    await ctx.audit.record({
      actorUserId: getAuth(req).user.id,
      eventType: 'ADMIN_INVITATION_REVOKE',
      result: 'SUCCESS',
      resourceType: 'INVITATION',
      resourceId: id,
      ipAddress: getClientIp(req),
      metadata: { email: invitation.email },
    });

    res.json({ data: { invitation: toPublicInvitation(revoked) } });
  });

  router.get('/users', async (req, res) => {
    const filters = parseQuery(userListSchema, req);
    const { items, total } = await ctx.users.list(filters);
    res.json({
      data: items.map(toPublicUser),
      pagination: { total, limit: filters.limit, offset: filters.offset },
    });
  });

  router.post('/users/:id/approve', async (req, res) => {
    const id = parse(idSchema, req.params.id);
    const user = await ctx.users.findById(id);
    if (!user) throw notFound('User not found');

    const updated = await ctx.users.approve(id);
    if (!updated) {
      throw conflict('INVALID_STATUS_TRANSITION', `Cannot approve a user in ${user.status} state`);
    }

    await ctx.audit.record({
      actorUserId: getAuth(req).user.id,
      eventType: 'ADMIN_USER_APPROVE',
      result: 'SUCCESS',
      resourceType: 'USER',
      resourceId: id,
      ipAddress: getClientIp(req),
      metadata: { previousStatus: user.status },
    });

    res.json({ data: { user: toPublicUser(updated) } });
  });

  router.post('/users/:id/suspend', async (req, res) => {
    const id = parse(idSchema, req.params.id);
    const user = await ctx.users.findById(id);
    if (!user) throw notFound('User not found');

    const updated = await ctx.users.suspend(id);
    if (!updated) {
      throw conflict('INVALID_STATUS_TRANSITION', `Cannot suspend a user in ${user.status} state`);
    }

    await ctx.audit.record({
      actorUserId: getAuth(req).user.id,
      eventType: 'ADMIN_USER_SUSPEND',
      result: 'SUCCESS',
      resourceType: 'USER',
      resourceId: id,
      ipAddress: getClientIp(req),
      metadata: { previousStatus: user.status },
    });

    res.json({ data: { user: toPublicUser(updated) } });
  });

  router.post('/users/:id/disable', async (req, res) => {
    const id = parse(idSchema, req.params.id);
    const user = await ctx.users.findById(id);
    if (!user) throw notFound('User not found');

    const updated = await ctx.users.disable(id);
    if (!updated) {
      throw conflict('INVALID_STATUS_TRANSITION', `Cannot disable a user in ${user.status} state`);
    }

    await ctx.audit.record({
      actorUserId: getAuth(req).user.id,
      eventType: 'ADMIN_USER_DISABLE',
      result: 'SUCCESS',
      resourceType: 'USER',
      resourceId: id,
      ipAddress: getClientIp(req),
      metadata: { previousStatus: user.status },
    });

    res.json({ data: { user: toPublicUser(updated) } });
  });

  router.post('/users/:id/sessions/revoke', async (req, res) => {
    const id = parse(idSchema, req.params.id);
    const user = await ctx.users.findById(id);
    if (!user) throw notFound('User not found');

    const revokedSessions = await ctx.sessions.revokeAllForUser(id);

    await ctx.audit.record({
      actorUserId: getAuth(req).user.id,
      eventType: 'ADMIN_SESSIONS_REVOKE',
      result: 'SUCCESS',
      resourceType: 'USER',
      resourceId: id,
      ipAddress: getClientIp(req),
      metadata: { revokedSessions },
    });

    res.json({ data: { revokedSessions } });
  });

  router.post('/sessions/revoke', async (req, res) => {
    const body = parseBody(revokeSessionsBodySchema, req);
    let revokedCount = 0;

    if (body.sessionId) {
      const success = await ctx.sessions.revoke(body.sessionId);
      if (success) revokedCount = 1;
    } else if (body.userId) {
      revokedCount = await ctx.sessions.revokeAllForUser(body.userId);
    }

    await ctx.audit.record({
      actorUserId: getAuth(req).user.id,
      eventType: 'ADMIN_SESSIONS_REVOKE',
      result: 'SUCCESS',
      resourceType: body.sessionId ? 'SESSION' : 'USER',
      resourceId: body.sessionId ?? body.userId ?? null,
      ipAddress: getClientIp(req),
      metadata: { revokedCount, ...body },
    });

    res.json({ data: { revokedCount } });
  });

  router.get('/users/:id/sessions', async (req, res) => {
    const id = parse(idSchema, req.params.id);
    const user = await ctx.users.findById(id);
    if (!user) throw notFound('User not found');

    const sessions = await ctx.sessions.listActiveForUser(id);
    res.json({
      data: sessions.map((s) => ({
        id: s.id,
        userId: s.user_id,
        deviceId: s.device_id,
        createdAt: s.created_at.toISOString(),
        expiresAt: s.expires_at.toISOString(),
        lastActivityAt: s.last_activity_at ? s.last_activity_at.toISOString() : null,
        ipAddress: s.ip_address,
        userAgent: s.user_agent,
      })),
    });
  });

  router.get('/devices', async (req, res) => {
    const filters = parseQuery(deviceListSchema, req);
    const { items, total } = await ctx.devices.list(filters);
    res.json({
      data: items.map(toAdminDevice),
      pagination: { total, limit: filters.limit, offset: filters.offset },
    });
  });

  router.post('/devices/:id/approve', async (req, res) => {
    const id = parse(idSchema, req.params.id);
    const device = await ctx.devices.findById(id);
    if (!device) throw notFound('Device not found');
    if (!device.proof_verified_at) {
      throw conflict('DEVICE_PROOF_REQUIRED', 'Device key proof has not been verified');
    }

    const updated = await ctx.devices.approve(id);
    if (!updated) {
      throw conflict('INVALID_STATUS_TRANSITION', `Cannot approve a device in ${device.status} state`);
    }

    await ctx.audit.record({
      actorUserId: getAuth(req).user.id,
      deviceId: id,
      eventType: 'ADMIN_DEVICE_APPROVE',
      result: 'SUCCESS',
      resourceType: 'DEVICE',
      resourceId: id,
      ipAddress: getClientIp(req),
      metadata: { previousStatus: device.status, userId: device.user_id },
    });

    res.json({ data: { device: toPublicDevice(updated) } });
  });

  router.post('/devices/:id/revoke', async (req, res) => {
    const id = parse(idSchema, req.params.id);
    const device = await ctx.devices.findById(id);
    if (!device) throw notFound('Device not found');

    const { device: revoked, revokedSessions } = await ctx.devices.revoke(id);
    if (!revoked) {
      throw conflict('INVALID_STATUS_TRANSITION', 'Device is already revoked');
    }

    await ctx.audit.record({
      actorUserId: getAuth(req).user.id,
      deviceId: id,
      eventType: 'ADMIN_DEVICE_REVOKE',
      result: 'SUCCESS',
      resourceType: 'DEVICE',
      resourceId: id,
      ipAddress: getClientIp(req),
      metadata: { revokedSessions, userId: device.user_id },
    });

    res.json({
      data: { device: toPublicDevice(revoked), revokedSessions },
    });
  });

  router.get('/audit-events', async (req, res) => {
    const filters = parseQuery(auditListSchema, req);
    const { items, total } = await ctx.audit.list(filters);
    res.json({
      data: items.map(toPublicAuditEvent),
      pagination: { total, limit: filters.limit, offset: filters.offset },
    });
  });

  return router;
}

