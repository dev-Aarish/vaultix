import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import type { AppContext } from './context';
import { errorHandler, notFoundHandler, requestLogger } from './middleware/error-handler';
import { adminFilesRouter } from './routes/admin-files';
import { adminPermissionsRouter } from './routes/admin-permissions';
import { adminRouter } from './routes/admin';
import { authRouter } from './routes/auth';
import { deviceRouter } from './routes/devices';
import { fileRouter } from './routes/files';
import { healthRouter } from './routes/health';
import { meRouter } from './routes/me';

export function createApp(ctx: AppContext): Express {
  const app = express();

  app.disable('x-powered-by');
  if (ctx.config.trustProxy !== false) {
    app.set('trust proxy', ctx.config.trustProxy);
  }

  app.use(requestLogger(ctx));
  app.use(helmet());
  app.use(
    cors({
      origin: ctx.config.corsOrigins,
      methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
      maxAge: 600,
    }),
  );
  app.use(express.json({ limit: '100kb' }));

  app.use('/health', healthRouter(ctx));
  app.use('/auth', authRouter(ctx));
  app.use('/devices', deviceRouter(ctx));
  app.use('/me', meRouter(ctx));
  app.use('/files', fileRouter(ctx));
  app.use('/admin', adminRouter(ctx));
  app.use('/admin', adminFilesRouter(ctx));
  app.use('/admin', adminPermissionsRouter(ctx));

  app.use(notFoundHandler);
  app.use(errorHandler(ctx));

  return app;
}
