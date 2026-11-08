import { Router } from 'express';
import type { AppContext } from '../context';

export function healthRouter(ctx: AppContext): Router {
  const router = Router();

  router.get('/', async (_req, res) => {
    try {
      await ctx.pool.query('SELECT 1');
      res.json({ status: 'ok' });
    } catch (error) {
      ctx.logger.error({ err: error }, 'health check failed');
      res.status(503).json({ status: 'unavailable' });
    }
  });

  return router;
}
