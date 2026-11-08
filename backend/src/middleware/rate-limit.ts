import type { NextFunction, Request, Response } from 'express';
import type { AppContext } from '../context';
import { AppError } from '../lib/errors';
import { getClientIp } from './validate';

interface WindowEntry {
  count: number;
  resetAt: number;
}

export interface RateLimitOptions {
  windowMs: number;
  max: number;
  keyGenerator?: (req: Request) => string;
  message?: string;
  recordAudit?: boolean;
}

export function createRateLimiter(ctx: AppContext, options: RateLimitOptions) {
  const hits = new Map<string, WindowEntry>();
  const windowMs = options.windowMs;
  const max = options.max;
  const message = options.message ?? 'Too many requests. Please try again later.';

  // Periodic cleanup of expired entries
  const interval = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits.entries()) {
      if (entry.resetAt <= now) {
        hits.delete(key);
      }
    }
  }, 60_000);
  if (interval.unref) interval.unref();

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!ctx.config.rateLimitEnabled) {
      next();
      return;
    }

    const key = (options.keyGenerator ? options.keyGenerator(req) : getClientIp(req)) ?? 'unknown';
    const now = Date.now();
    let entry = hits.get(key);

    if (!entry || entry.resetAt <= now) {
      entry = { count: 1, resetAt: now + windowMs };
      hits.set(key, entry);
    } else {
      entry.count += 1;
    }

    const remaining = Math.max(0, max - entry.count);
    const resetSeconds = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));

    res.setHeader('X-RateLimit-Limit', String(max));
    res.setHeader('X-RateLimit-Remaining', String(remaining));
    res.setHeader('X-RateLimit-Reset', String(resetSeconds));

    if (entry.count > max) {
      res.setHeader('Retry-After', String(resetSeconds));

      if (options.recordAudit) {
        await ctx.audit.record({
          actorUserId: req.auth?.user.id ?? null,
          deviceId: req.auth?.session.device_id ?? null,
          eventType: 'RATE_LIMIT_EXCEEDED',
          result: 'DENIED',
          reasonCode: 'TOO_MANY_REQUESTS',
          ipAddress: getClientIp(req),
          metadata: { path: req.path, method: req.method, key },
        });
      }

      next(new AppError(429, 'RATE_LIMIT_EXCEEDED', message));
      return;
    }

    next();
  };
}
