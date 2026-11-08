import { Router } from 'express';
import type { AppContext } from '../context';
import { getAuth, requireAuth } from '../middleware/auth';
import { toPublicDevice } from '../services/devices';

export function meRouter(ctx: AppContext): Router {
  const router = Router();
  router.use(requireAuth(ctx));

  router.get('/devices', async (req, res) => {
    const devices = await ctx.devices.listForUser(getAuth(req).user.id);
    res.json({ data: devices.map(toPublicDevice) });
  });

  return router;
}
