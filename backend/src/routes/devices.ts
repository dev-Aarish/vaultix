import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import type { AppContext } from '../context';
import { AppError, badRequest, conflict, notFound } from '../lib/errors';
import { parseDevicePublicKey, verifyDeviceSignature } from '../lib/device-keys';
import { requireAuth } from '../middleware/auth';
import { createRateLimiter } from '../middleware/rate-limit';
import { getClientIp, parse, parseBody } from '../middleware/validate';
import { toPublicDevice } from '../services/devices';

const registerSchema = z.strictObject({
  deviceName: z.string().trim().min(1).max(200),
  publicKey: z.string().min(1).max(4096),
  attestationStatus: z.enum(['VERIFIED', 'UNVERIFIED', 'FAILED', 'NOT_SUPPORTED']).optional(),
});

const challengeSchema = z.strictObject({
  deviceId: z.uuid(),
  purpose: z.enum(['REGISTRATION', 'SESSION']),
});

const verifySchema = z.strictObject({
  deviceId: z.uuid(),
  challengeId: z.uuid(),
  signature: z.string().min(1).max(2048),
});

const idSchema = z.uuid();

export function deviceRouter(ctx: AppContext): Router {
  const router = Router();
  router.use(requireAuth(ctx));

  router.post('/register', async (req, res) => {
    const body = parseBody(registerSchema, req);
    const auth = req.auth;
    if (!auth) throw notFound('Session not found');

    const key = parseDevicePublicKey(body.publicKey);
    const device = await ctx.devices.create({
      userId: auth.user.id,
      deviceName: body.deviceName,
      publicKeyPem: key.pem,
      keyFingerprint: key.fingerprint,
      attestationStatus: body.attestationStatus,
    });

    const challenge = await ctx.devices.createChallenge(
      device.id,
      'REGISTRATION',
      ctx.config.deviceChallengeTtlMinutes,
    );

    await ctx.audit.record({
      actorUserId: auth.user.id,
      deviceId: device.id,
      eventType: 'DEVICE_REGISTER',
      result: 'SUCCESS',
      resourceType: 'DEVICE',
      resourceId: device.id,
      ipAddress: getClientIp(req),
      metadata: { fingerprint: device.key_fingerprint, deviceName: device.device_name },
    });

    res.status(201).json({
      data: {
        device: toPublicDevice(device),
        challenge: {
          id: challenge.id,
          challenge: challenge.challenge,
          purpose: challenge.purpose,
          expiresAt: challenge.expires_at.toISOString(),
        },
      },
    });
  });

  const challengeLimiter = createRateLimiter(ctx, {
    windowMs: 60_000,
    max: 20,
    recordAudit: true,
    message: 'Too many device verification attempts. Please wait before trying again.',
  });

  router.post('/challenge', challengeLimiter, async (req, res) => {
    const body = parseBody(challengeSchema, req);
    const auth = req.auth;
    if (!auth) throw notFound('Session not found');

    const device = await ctx.devices.findByIdForUser(body.deviceId, auth.user.id);
    if (!device) throw notFound('Device not found');
    if (device.status === 'REVOKED') {
      throw conflict('DEVICE_REVOKED', 'Device has been revoked');
    }
    if (body.purpose === 'SESSION' && (device.status !== 'APPROVED' || !device.proof_verified_at)) {
      throw conflict('DEVICE_NOT_APPROVED', 'Device is not approved yet');
    }

    const challenge = await ctx.devices.createChallenge(
      device.id,
      body.purpose,
      ctx.config.deviceChallengeTtlMinutes,
    );

    res.json({
      data: {
        challenge: {
          id: challenge.id,
          challenge: challenge.challenge,
          purpose: challenge.purpose,
          expiresAt: challenge.expires_at.toISOString(),
        },
      },
    });
  });

  router.post('/verify', challengeLimiter, async (req, res) => {
    const body = parseBody(verifySchema, req);
    const auth = req.auth;
    if (!auth) throw notFound('Session not found');

    const device = await ctx.devices.findByIdForUser(body.deviceId, auth.user.id);
    if (!device) throw notFound('Device not found');
    if (device.status === 'REVOKED') {
      throw conflict('DEVICE_REVOKED', 'Device has been revoked');
    }

    const challenge = await ctx.devices.consumeChallenge(body.challengeId, device.id);
    if (!challenge) {
      await ctx.audit.record({
        actorUserId: auth.user.id,
        deviceId: device.id,
        eventType: 'DEVICE_VERIFY',
        result: 'DENIED',
        reasonCode: 'INVALID_CHALLENGE',
        resourceType: 'DEVICE',
        resourceId: device.id,
        ipAddress: getClientIp(req),
      });
      throw badRequest('INVALID_CHALLENGE', 'Challenge is invalid, expired or already used');
    }

    if (!verifyDeviceSignature(device.public_key, challenge.challenge, body.signature)) {
      await ctx.audit.record({
        actorUserId: auth.user.id,
        deviceId: device.id,
        eventType: 'DEVICE_VERIFY',
        result: 'DENIED',
        reasonCode: 'INVALID_SIGNATURE',
        resourceType: 'DEVICE',
        resourceId: device.id,
        ipAddress: getClientIp(req),
      });
      throw badRequest('INVALID_SIGNATURE', 'Device signature is invalid');
    }

    if (challenge.purpose === 'REGISTRATION') {
      const updated = await ctx.devices.markProofVerified(device.id);
      if (!updated) throw conflict('DEVICE_REVOKED', 'Device has been revoked');

      await ctx.audit.record({
        actorUserId: auth.user.id,
        deviceId: device.id,
        eventType: 'DEVICE_VERIFY',
        result: 'SUCCESS',
        resourceType: 'DEVICE',
        resourceId: device.id,
        ipAddress: getClientIp(req),
        metadata: { purpose: challenge.purpose, status: updated.status },
      });

      res.json({ data: { device: toPublicDevice(updated) } });
      return;
    }

    if (device.status !== 'APPROVED' || !device.proof_verified_at) {
      throw conflict('DEVICE_NOT_APPROVED', 'Device is not approved yet');
    }

    const updated = await ctx.devices.markProofVerified(device.id);
    if (!updated) throw conflict('DEVICE_REVOKED', 'Device has been revoked');

    await ctx.devices.bindSession(auth.session.id, device.id);

    await ctx.audit.record({
      actorUserId: auth.user.id,
      deviceId: device.id,
      eventType: 'DEVICE_SESSION_BIND',
      result: 'SUCCESS',
      resourceType: 'DEVICE',
      resourceId: device.id,
      ipAddress: getClientIp(req),
      metadata: { sessionId: auth.session.id, purpose: challenge.purpose },
    });

    res.json({ data: { device: toPublicDevice(updated), deviceBound: true } });
  });

  router.get('/status/:id', async (req, res) => {
    const id = parse(idSchema, req.params.id);
    const auth = req.auth;
    if (!auth) throw notFound('Session not found');

    const device = await ctx.devices.findByIdForUser(id, auth.user.id);
    if (!device) throw notFound('Device not found');

    res.json({ data: { device: toPublicDevice(device) } });
  });

  return router;
}

export function requireDeviceBound(ctx: AppContext) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    const auth = req.auth;
    if (!auth) {
      next(new AppError(401, 'UNAUTHENTICATED', 'Authentication is required'));
      return;
    }
    if (!auth.session.device_id) {
      next(new AppError(403, 'DEVICE_PROOF_REQUIRED', 'A verified approved device is required'));
      return;
    }
    const device = await ctx.devices.findById(auth.session.device_id);
    if (!device || device.status !== 'APPROVED' || !device.proof_verified_at) {
      next(new AppError(403, 'DEVICE_PROOF_REQUIRED', 'A verified approved device is required'));
      return;
    }
    next();
  };
}
