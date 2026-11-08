import type { z } from 'zod';
import type { Request } from 'express';
import { badRequest } from '../lib/errors';

export function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw badRequest(
      'VALIDATION_ERROR',
      'Request validation failed',
      result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    );
  }
  return result.data;
}

export function parseBody<T>(schema: z.ZodType<T>, req: Request): T {
  return parse(schema, req.body);
}

export function parseQuery<T>(schema: z.ZodType<T>, req: Request): T {
  return parse(schema, req.query);
}

export function getClientIp(req: Request): string | null {
  return req.ip ?? null;
}
