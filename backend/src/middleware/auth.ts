import type { NextFunction, Request, Response } from 'express';
import type { AppContext } from '../context';
import { AppError, forbidden, unauthenticated } from '../lib/errors';
import type { RequestAuth } from '../types';

export function requireAuth(ctx: AppContext) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      next(unauthenticated());
      return;
    }

    const token = header.slice('Bearer '.length).trim();
    if (!token) {
      next(unauthenticated());
      return;
    }

    const session = await ctx.sessions.findValidByToken(token);
    if (!session) {
      next(unauthenticated('Session is invalid or has expired'));
      return;
    }

    const user = await ctx.users.findById(session.user_id);
    if (!user) {
      next(unauthenticated('Session is invalid or has expired'));
      return;
    }

    if (user.status !== 'ACTIVE') {
      next(
        new AppError(
          403,
          'ACCOUNT_NOT_ACTIVE',
          `Account is ${user.status.toLowerCase()}`,
        ),
      );
      return;
    }

    req.auth = { user, session };
    await ctx.sessions.touch(session.id);
    next();
  };
}

export function requireAdmin(ctx: AppContext) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    const auth = req.auth;
    if (!auth) {
      next(unauthenticated());
      return;
    }

    if (auth.user.role !== 'ADMIN') {
      await ctx.audit.record({
        actorUserId: auth.user.id,
        eventType: 'ADMIN_ACCESS',
        result: 'DENIED',
        reasonCode: 'NOT_ADMIN',
        ipAddress: req.ip ?? null,
        metadata: { method: req.method, path: req.originalUrl },
      });
      next(forbidden('Administrator access required'));
      return;
    }

    next();
  };
}

export function getAuth(req: Request): RequestAuth {
  if (!req.auth) throw unauthenticated();
  return req.auth;
}
