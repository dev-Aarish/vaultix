import { Router } from 'express';
import { z } from 'zod';
import type { AppContext } from '../context';
import { AppError, badRequest, conflict, unauthenticated } from '../lib/errors';
import { burnPasswordVerification, hashPassword, verifyPassword } from '../lib/password';
import { hashToken } from '../lib/tokens';
import { getAuth, requireAuth } from '../middleware/auth';
import { getClientIp, parseBody } from '../middleware/validate';
import { toPublicDevice } from '../services/devices';
import { toPublicUser } from '../services/users';

export function authRouter(ctx: AppContext): Router {
  const router = Router();

  const registerSchema = z.strictObject({
    token: z.string().min(16).max(512),
    name: z.string().trim().min(1).max(200),
    password: z.string().min(ctx.config.passwordMinLength).max(1024),
  });

  const loginSchema = z.strictObject({
    email: z.email().transform((value) => value.trim().toLowerCase()),
    password: z.string().min(1).max(1024),
  });

  router.post('/register', async (req, res) => {
    const body = parseBody(registerSchema, req);
    const ipAddress = getClientIp(req);

    const passwordHash = await hashPassword(body.password);
    const result = await ctx.registration.register({
      tokenHash: hashToken(body.token),
      name: body.name,
      passwordHash,
    });

    if (!result.ok) {
      await ctx.audit.record({
        eventType: 'AUTH_REGISTER',
        result: 'DENIED',
        reasonCode: result.reason,
        resourceType: 'INVITATION',
        resourceId: result.invitation?.id ?? null,
        ipAddress,
        metadata: result.invitation ? { email: result.invitation.email } : {},
      });

      switch (result.reason) {
        case 'INVALID_INVITATION':
          throw badRequest('INVALID_INVITATION', 'Invitation is invalid');
        case 'INVITATION_USED':
          throw badRequest('INVITATION_USED', 'Invitation has already been used');
        case 'INVITATION_EXPIRED':
          throw badRequest('INVITATION_EXPIRED', 'Invitation has expired');
        case 'EMAIL_IN_USE':
          throw conflict('EMAIL_IN_USE', 'An account already exists for this email address');
      }
    }

    await ctx.audit.record({
      actorUserId: result.user.id,
      eventType: 'AUTH_REGISTER',
      result: 'SUCCESS',
      resourceType: 'INVITATION',
      resourceId: result.invitation.id,
      ipAddress,
      metadata: { status: result.user.status },
    });

    res.status(201).json({ data: { user: toPublicUser(result.user) } });
  });

  router.post('/login', async (req, res) => {
    const body = parseBody(loginSchema, req);
    const ipAddress = getClientIp(req);
    const user = await ctx.users.findByEmail(body.email);

    if (!user) {
      await burnPasswordVerification(body.password);
      await ctx.audit.record({
        eventType: 'AUTH_LOGIN',
        result: 'DENIED',
        reasonCode: 'INVALID_CREDENTIALS',
        ipAddress,
      });
      throw unauthenticated('Invalid email or password');
    }

    const passwordValid = await verifyPassword(user.password_hash, body.password);
    if (!passwordValid) {
      await ctx.audit.record({
        actorUserId: user.id,
        eventType: 'AUTH_LOGIN',
        result: 'DENIED',
        reasonCode: 'INVALID_CREDENTIALS',
        ipAddress,
      });
      throw unauthenticated('Invalid email or password');
    }

    if (user.status !== 'ACTIVE') {
      await ctx.audit.record({
        actorUserId: user.id,
        eventType: 'AUTH_LOGIN',
        result: 'DENIED',
        reasonCode: `ACCOUNT_${user.status}`,
        ipAddress,
      });
      throw new AppError(403, 'ACCOUNT_NOT_ACTIVE', `Account is ${user.status.toLowerCase()}`);
    }

    const { token, session } = await ctx.sessions.create({
      userId: user.id,
      ipAddress,
      userAgent: req.get('user-agent') ?? null,
    });

    await ctx.audit.record({
      actorUserId: user.id,
      eventType: 'AUTH_LOGIN',
      result: 'SUCCESS',
      ipAddress,
      metadata: { sessionId: session.id },
    });

    res.json({
      data: {
        token,
        expiresAt: session.expires_at.toISOString(),
        user: toPublicUser(user),
      },
    });
  });

  router.post('/logout', requireAuth(ctx), async (req, res) => {
    const auth = getAuth(req);
    await ctx.sessions.revoke(auth.session.id);
    await ctx.audit.record({
      actorUserId: auth.user.id,
      eventType: 'AUTH_LOGOUT',
      result: 'SUCCESS',
      ipAddress: getClientIp(req),
      metadata: { sessionId: auth.session.id },
    });
    res.status(204).send();
  });

  router.get('/me', requireAuth(ctx), async (req, res) => {
    const auth = getAuth(req);
    const device = auth.session.device_id
      ? await ctx.devices.findById(auth.session.device_id)
      : null;
    res.json({
      data: {
        user: toPublicUser(auth.user),
        device: device ? toPublicDevice(device) : null,
      },
    });
  });

  return router;
}
