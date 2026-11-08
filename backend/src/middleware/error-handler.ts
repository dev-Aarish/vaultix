import { randomUUID } from 'node:crypto';
import type { ErrorRequestHandler, RequestHandler } from 'express';
import pinoHttp from 'pino-http';
import type { AppContext } from '../context';
import { AppError } from '../lib/errors';

export function requestLogger(ctx: AppContext): RequestHandler {
  return pinoHttp({
    logger: ctx.logger,
    genReqId: (req, res) => {
      const header = req.headers['x-request-id'];
      const id = Array.isArray(header) ? header[0] : header;
      const requestId = id && id.length > 0 ? id : randomUUID();
      res.setHeader('x-request-id', requestId);
      return requestId;
    },
    customLogLevel: (_req, res, error) => {
      if (error || res.statusCode >= 500) return 'error';
      if (res.statusCode >= 400) return 'warn';
      return 'info';
    },
    autoLogging: {
      ignore: (req) => req.url === '/health',
    },
  });
}

export const notFoundHandler: RequestHandler = (_req, res) => {
  res.status(404).json({
    error: { code: 'NOT_FOUND', message: 'Route not found' },
  });
};

export function errorHandler(ctx: AppContext): ErrorRequestHandler {
  return (error, req, res, next) => {
    if (res.headersSent) {
      next(error);
      return;
    }

    if (error instanceof AppError) {
      const body: { error: { code: string; message: string; details?: unknown } } = {
        error: { code: error.code, message: error.message },
      };
      if (error.details !== undefined) body.error.details = error.details;
      res.status(error.statusCode).json(body);
      return;
    }

    const parserError = asBodyParserError(error);
    if (parserError) {
      res.status(parserError.status).json({
        error: { code: parserError.code, message: parserError.message },
      });
      return;
    }

    ctx.logger.error({ err: error, requestId: req.id }, 'unhandled request error');
    res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
    });
  };
}

function asBodyParserError(
  error: unknown,
): { status: number; code: string; message: string } | null {
  if (typeof error !== 'object' || error === null || !('type' in error)) return null;
  const type = (error as { type?: unknown }).type;

  if (type === 'entity.parse.failed') {
    return { status: 400, code: 'INVALID_JSON', message: 'Request body is not valid JSON' };
  }
  if (type === 'entity.too.large') {
    return { status: 413, code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large' };
  }
  return null;
}
